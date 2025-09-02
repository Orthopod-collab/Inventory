// Orders.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'

/* ================= Helpers ================= */
const clean = v => String(v ?? '').trim()
const titleCase = s => String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())

function stockFlags(it = {}) {
  const qty = +it.qty || 0
  const min = +it.min || 0
  const rop = +it.rop || 0
  const max = Number.isFinite(+it.max) ? (+it.max || 0) : Infinity

  return {
    belowMin: qty < min,
    atOrBelowROP: qty <= rop,
    overMax: Number.isFinite(max) && qty > max,
    urgent: !!it?.flags?.urgent,
  }
}

function suggestedOrderQty(it = {}) {
  const qty = +it.qty || 0
  const min = +it.min || 0
  const rop = +it.rop || 0
  const target = Math.max(min, rop || 0)
  const need = Math.max(0, target - qty)
  return need
}

/* ================= Barcode Scan Modal ================= */
function ScanModal({ open, onClose, onDetected }) {
  const videoRef = useRef(null)
  const [supported, setSupported] = useState(false)
  const [err, setErr] = useState('')
  const [manual, setManual] = useState('')

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window)
  }, [])

  useEffect(() => {
    if (!open || !supported) return
    let stream
    let rafId
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const detector = new window.BarcodeDetector({
      formats: [
        'ean_13','ean_8','upc_a','upc_e','code_128','code_39','code_93','itf','qr_code'
      ]
    })

    const loop = async () => {
      const vid = videoRef.current
      if (!vid || !vid.videoWidth) { rafId = requestAnimationFrame(loop); return }
      canvas.width = vid.videoWidth
      canvas.height = vid.videoHeight
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
      try {
        const res = await detector.detect(canvas)
        if (res && res.length) {
          const value = res[0].rawValue || res[0].rawValue || ''
          if (value) {
            navigator.vibrate?.(30)
            onDetected(String(value))
          }
        }
      } catch {}
      rafId = requestAnimationFrame(loop)
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }, audio: false
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        loop()
      } catch (e) {
        setErr('Camera permission or barcode detection failed.')
      }
    })()

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      stream?.getTracks?.().forEach(t => t.stop())
    }
  }, [open, supported, onDetected])

  if (!open) return null

  return (
    <div className="ctx-backdrop" onClick={onClose}>
      <div
        className="ctx-menu"
        style={{ left:'50%', top:'12%', transform:'translateX(-50%)', width:520, padding:10 }}
        onClick={e=>e.stopPropagation()}
      >
        <div style={{fontWeight:900, margin:'2px 4px 10px'}}>Scan a barcode</div>

        {supported ? (
          <div style={{display:'grid', gap:8}}>
            <video ref={videoRef} style={{width:'100%', borderRadius:10, border:'1px solid #e6e8f0'}} muted playsInline />
            {!!err && <div style={{color:'#b91c1c', fontSize:12}}>{err}</div>}
            <div style={{fontSize:12, color:'#64748b'}}>
              Tip: aim the code within the frame. On detection, I’ll add/increment that item by SKU.
            </div>
          </div>
        ) : (
          <div style={{display:'grid', gap:8}}>
            <div style={{fontSize:12, color:'#64748b'}}>
              Your browser doesn’t support camera barcode scanning. Enter a code manually:
            </div>
            <input className="btn" value={manual} onChange={e=>setManual(e.target.value)} placeholder="Type or paste barcode/SKU"/>
            <div style={{display:'flex', justifyContent:'flex-end', gap:6}}>
              <button className="mini" onClick={onClose}>Cancel</button>
              <button className="mini" onClick={()=>manual && onDetected(clean(manual))}>Add</button>
            </div>
          </div>
        )}

        {supported && (
          <div style={{display:'flex', justifyContent:'flex-end', marginTop:10, gap:6}}>
            <button className="mini" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ================= Main Orders ================= */
export default function Orders({ items = [] }) {
  // Basic order header (simplified for this feature set)
  const [supplier, setSupplier] = useState('')
  const [refNo, setRefNo] = useState('')

  // Add line UI
  const [search, setSearch] = useState('')
  const [scanOpen, setScanOpen] = useState(false)

  // Auto-flag toggles
  const [flagBelowMin, setFlagBelowMin] = useState(true)
  const [flagAtROP, setFlagAtROP] = useState(true)
  const [flagUrgent, setFlagUrgent] = useState(true)

  // Order lines
  const [lines, setLines] = useState([]) // {itemId, sku, name, qtyOrdered, qtyReceived}

  const suppliers = useMemo(() => {
    const s = new Set(items.map(i => clean(i.supplier)).filter(Boolean))
    return Array.from(s).sort()
  }, [items])

  const filteredInventory = useMemo(() => {
    const q = clean(search).toLowerCase()
    if (!q) return items
    return items.filter(i => {
      const hay = `${i.name} ${i.sku} ${i.supplier}`.toLowerCase()
      return hay.includes(q)
    })
  }, [items, search])

  const flaggedSuggestions = useMemo(() => {
    return items.filter(it => {
      const f = stockFlags(it)
      const isFlag =
        (flagBelowMin && f.belowMin) ||
        (flagAtROP && f.atOrBelowROP) ||
        (flagUrgent && f.urgent)
      return isFlag && suggestedOrderQty(it) > 0
    })
  }, [items, flagBelowMin, flagAtROP, flagUrgent])

  function addOrBumpLine(item, qty = 1) {
    if (!item) return
    setLines(prev => {
      const ix = prev.findIndex(l => l.itemId === item.id)
      if (ix >= 0) {
        const next = [...prev]
        next[ix] = { ...next[ix], qtyOrdered: (+next[ix].qtyOrdered || 0) + qty }
        return next
      }
      return [
        ...prev,
        {
          itemId: item.id,
          sku: item.sku || '',
          name: item.name || '',
          qtyOrdered: qty,
          qtyReceived: 0,
        }
      ]
    })
  }

  function handleScanDetected(codeText) {
    const code = clean(codeText)
    // Match by SKU first, fallback to a 'barcode' field if you keep one
    const found =
      items.find(i => clean(i.sku).toLowerCase() === code.toLowerCase()) ||
      items.find(i => clean(i.barcode).toLowerCase() === code.toLowerCase())
    if (found) {
      addOrBumpLine(found, 1)
    }
    setScanOpen(false)
  }

  function addAllFlagged() {
    const batch = []
    flaggedSuggestions.forEach(it => {
      const need = suggestedOrderQty(it)
      if (need > 0) batch.push({ it, need })
    })
    // Merge with existing lines
    setLines(prev => {
      const map = new Map(prev.map(l => [l.itemId, {...l}]))
      batch.forEach(({ it, need }) => {
        const cur = map.get(it.id)
        if (cur) cur.qtyOrdered = (+cur.qtyOrdered || 0) + need
        else map.set(it.id, { itemId: it.id, sku: it.sku||'', name: it.name||'', qtyOrdered: need, qtyReceived: 0 })
      })
      return Array.from(map.values())
    })
  }

  const totalLines = lines.length
  const totalQty = lines.reduce((n,l) => n + (+l.qtyOrdered||0), 0)

  async function saveDraft() {
    const payload = {
      supplier: supplier || null,
      refNo: refNo || null,
      status: 'Draft',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lines: lines.map(l => ({
        itemId: l.itemId, sku: l.sku, name: l.name,
        qtyOrdered: +l.qtyOrdered || 0,
        qtyReceived: +l.qtyReceived || 0,
      }))
    }
    const ref = await addDoc(collection(db,'orders'), payload)
    await addDoc(collection(db,'activities'), {
      type:'Create Order', details:`Order ${ref.id} created (${totalLines} lines)`,
      createdAt: serverTimestamp()
    })
    alert('Draft saved.')
  }

  async function receiveLine(line, qtyToReceive = 1) {
    const it = items.find(x => x.id === line.itemId)
    if (!it) return
    // 1) bump inventory
    await updateDoc(doc(db,'items', it.id), {
      qty: (+it.qty||0) + (+qtyToReceive||0),
      updatedAt: serverTimestamp()
    })
    // 2) bump line (local-only here; persist in your order doc if desired)
    setLines(prev => prev.map(l => l.itemId===line.itemId
      ? { ...l, qtyReceived: (+l.qtyReceived||0) + (+qtyToReceive||0) }
      : l
    ))
    await addDoc(collection(db,'activities'), {
      type:'Receive', details:`${it.name}: +${qtyToReceive}`, createdAt: serverTimestamp()
    })
  }

  return (
    <main>
      <div className="card">
        <header>
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <div className="top-title">New Purchase Order</div>
            <span className="badge">{totalLines} lines • {totalQty} units</span>
          </div>
          <div style={{display:'flex', gap:8}}>
            <button className="btn" onClick={saveDraft}>Save Draft</button>
          </div>
        </header>

        <div className="body" style={{display:'grid', gap:14}}>
          {/* Header fields */}
          <div className="row">
            <div className="field">
              <label>Supplier</label>
              <select className="btn" value={supplier} onChange={e=>setSupplier(e.target.value)}>
                <option value="">—</option>
                {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Reference</label>
              <input className="btn" placeholder="PO-00123" value={refNo} onChange={e=>setRefNo(e.target.value)} />
            </div>
          </div>

          {/* Add line: search + scan + auto-flag */}
          <div className="card" style={{border:'1px dashed #e6e8f0'}}>
            <header style={{borderBottom:'1px dashed #e6e8f0'}}>
              <div style={{fontWeight:800}}>Add line</div>
              <div style={{display:'flex', gap:8}}>
                <button className="btn" onClick={()=>setScanOpen(true)}>Scan</button>
              </div>
            </header>
            <div className="body" style={{display:'grid', gap:12}}>
              <div className="sm-toolbar">
                <div className="toolbar" style={{width:'100%'}}>
                  <div className="search" style={{flex:1}}>
                    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z"/></svg>
                    <input
                      placeholder="Search inventory (name, SKU, supplier)…"
                      value={search}
                      onChange={e=>setSearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Auto-flag row */}
              <div className="chips" style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <span style={{fontSize:12, color:'#64748b', fontWeight:800}}>Auto-flag:</span>
                <label className="sel-all"><input type="checkbox" checked={flagBelowMin} onChange={e=>setFlagBelowMin(e.target.checked)}/> <span>Below Min</span></label>
                <label className="sel-all"><input type="checkbox" checked={flagAtROP} onChange={e=>setFlagAtROP(e.target.checked)}/> <span>≤ ROP</span></label>
                <label className="sel-all"><input type="checkbox" checked={flagUrgent} onChange={e=>setFlagUrgent(e.target.checked)}/> <span>Urgent</span></label>
                <span className="chip stat">Matches: {flaggedSuggestions.length}</span>
                {!!flaggedSuggestions.length && (
                  <button className="btn" onClick={addAllFlagged}>Add all flagged</button>
                )}
              </div>

              {/* Suggestions list */}
              <div style={{display:'grid', gap:6}}>
                {(search ? filteredInventory : flaggedSuggestions).slice(0,50).map(it => {
                  const f = stockFlags(it)
                  const need = suggestedOrderQty(it)
                  return (
                    <div key={it.id} className="storage-card" style={{display:'grid', gridTemplateColumns:'1fr auto auto', alignItems:'center', gap:10}}>
                      <div>
                        <div className="name" style={{fontWeight:800}}>{it.name}</div>
                        <div className="muted">{it.sku || '—'} • {it.supplier || '—'}</div>
                        <div style={{display:'flex', gap:6, fontSize:12, marginTop:4}}>
                          {f.belowMin && <span className="tag danger">Below min</span>}
                          {f.atOrBelowROP && <span className="tag warn">≤ ROP</span>}
                          {f.urgent && <span className="tag danger">Urgent</span>}
                        </div>
                      </div>
                      <div style={{fontSize:12, color:'#64748b'}}>Stock: {+it.qty||0} (min {+it.min||0}, rop {+it.rop||0})</div>
                      <div style={{display:'flex', gap:6}}>
                        <button className="mini" onClick={()=>addOrBumpLine(it, 1)}>+1</button>
                        <button className="mini" onClick={()=>addOrBumpLine(it, Math.max(1, need || 1))}>
                          Add {Math.max(1, need || 1)}
                        </button>
                      </div>
                    </div>
                  )
                })}
                {!(search ? filteredInventory : flaggedSuggestions).length && (
                  <div style={{fontSize:12, color:'#64748b'}}>No matches.</div>
                )}
              </div>
            </div>
          </div>

          {/* Lines table */}
          <div className="card">
            <header style={{borderBottom:'1px dashed #e6e8f0'}}>
              <div style={{fontWeight:800}}>Lines</div>
            </header>
            <div className="body" style={{paddingTop:8}}>
              <table className="sheet-style" id="invTable">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Qty to order</th>
                    <th>Received</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => {
                    const it = items.find(x => x.id === l.itemId) || {}
                    const f = stockFlags(it)
                    return (
                      <tr key={l.itemId}>
                        <td className="mono">{l.sku || '—'}</td>
                        <td>
                          <div style={{fontWeight:800}}>{l.name}</div>
                          <div style={{display:'flex', gap:6, fontSize:12}}>
                            {f.belowMin && <span className="tag danger">Below min</span>}
                            {f.atOrBelowROP && <span className="tag warn">≤ ROP</span>}
                            {f.urgent && <span className="tag danger">Urgent</span>}
                          </div>
                        </td>
                        <td style={{whiteSpace:'nowrap'}}>
                          <input
                            className="btn"
                            type="number" min={0}
                            value={l.qtyOrdered}
                            onChange={e=>{
                              const v = Math.max(0, Number(e.target.value)||0)
                              setLines(prev => prev.map(x => x.itemId===l.itemId ? { ...x, qtyOrdered:v } : x))
                            }}
                            style={{width:100, padding:'6px 10px'}}
                          />
                        </td>
                        <td className="mono">{l.qtyReceived||0}</td>
                        <td className="no-wrap">
                          <div className="actions-inline">
                            <button className="mini" onClick={()=>receiveLine(l, 1)}>Receive +1</button>
                            <button className="mini danger" onClick={()=>setLines(prev=>prev.filter(x=>x.itemId!==l.itemId))}>Remove</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!lines.length && <div style={{fontSize:12, color:'#64748b', marginTop:8}}>No lines added yet.</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Scanner modal */}
      <ScanModal
        open={scanOpen}
        onClose={()=>setScanOpen(false)}
        onDetected={handleScanDetected}
      />
    </main>
  )
}
