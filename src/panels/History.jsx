import React, { useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { tsToStr } from '../hooks'

export default function History({activities}){
  const [q,setQ] = useState('')
  const [type,setType] = useState('')
  const [from,setFrom] = useState('')
  const [to,setTo] = useState('')

  const filtered = useMemo(()=>{
    return activities.filter(a=>{
      if(type && a.type!==type) return false
      if(q){
        const hay = [a.type, a.details].join(' ').toLowerCase()
        if(!hay.includes(q.toLowerCase())) return false
      }
      const d = a.createdAt?.toDate ? a.createdAt.toDate() : null
      if(from && d && d < new Date(from+'T00:00:00')) return false
      if(to && d && d > new Date(to+'T23:59:59')) return false
      return true
    })
  }, [activities,q,type,from,to])

  return (
    <>
      <header>
        <div className="toolbar" style={{flex:1}}>
          <div className="search">
            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M11 4a7 7 0 1 1-4.9 11.9l-3.2 3.2-.9-.9 3.2-3.2A7 7 0 0 1 11 4Zm0 2a5 5 0 1 0 .001 10.001A5 5 0 0 0 11 6Z" fill="currentColor"/></svg>
            <input placeholder="Search activities…" value={q} onChange={e=>setQ(e.target.value)} />
          </div>
          <div className="group">
            <select value={type} onChange={e=>setType(e.target.value)}>
              <option value="">All types</option>
              {['Register','Move Item','Update','Add Storage','Remove Storage','Add Drawer','Remove Drawer','Update Room','Remove Room','Note','Delete Item','Update Inventory'].map(t=>(<option key={t}>{t}</option>))}
            </select>
          </div>
          <div className="group">
            <input type="date" className="date-input" value={from} onChange={e=>setFrom(e.target.value)} />
            <span>to</span>
            <input type="date" className="date-input" value={to} onChange={e=>setTo(e.target.value)} />
          </div>
          <div className="group right">
            <button className="btn" onClick={()=>exportCSV(filtered)}>Export CSV</button>
            <button className="btn danger" onClick={clearHistory}>Clear History</button>
          </div>
        </div>
      </header>
      <div className="body">
        <div className="activity-list">
          {filtered.length===0 && <div className="muted">No matching activity.</div>}
          {filtered.map(a=>(
            <div className="activity" key={a.id} style={{display:'grid', gridTemplateColumns:'120px 1fr', gap:10, border:'1px solid var(--border)', borderRadius:12, padding:10, background:'#fff'}}>
              <div className="when">{tsToStr(a.createdAt)}</div>
              <div>
                <div className="type" style={{fontWeight:800}}>{a.type}</div>
                <div className="details" style={{color:'#475569'}}>{a.details||''}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function exportCSV(list){
  const rows = [['When','Type','Details']].concat(list.map(a=>[a.createdAt?.toDate?.().toLocaleString?.()||'', a.type||'', a.details||'']))
  const csv = rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], {type:'text/csv'})
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='history.csv'; a.click()
}

async function clearHistory(){
  if(!confirm('Clear ALL activities? This cannot be undone.')) return
  // Simple approach: fetch a small batch and delete (repeat in UI if needed)
  const qs = await getDocs(query(collection(db,'activities'), limit(200)))
  await Promise.all(qs.docs.map(d=>deleteDoc(doc(db,'activities', d.id))))
  alert('Cleared last 200 entries. Run again if more remain.')
}
