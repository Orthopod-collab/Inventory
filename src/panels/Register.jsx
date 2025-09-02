import React, { useMemo, useState } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { tsToStr } from '../hooks'

const UNPLACED = '__unplaced__'

export default function Register({items, storages, rooms, onJump}){
  const [form,setForm] = useState({
    supplier:'', name:'', system:'', type:'consumable', size:'',
    qty:0, rop:0, min:0, max:0, sku:'', notes:'', usage:'medium'
  })

  const suppliers = useMemo(()=>Array.from(new Set(items.map(i=>i.supplier).filter(Boolean))).sort(),[items])
  const systems = useMemo(()=>Array.from(new Set(items.map(i=>i.system).filter(Boolean))).sort(),[items])

  function update(k,v){ setForm(s=>({...s,[k]:v})) }

  async function save(){
    if(!form.supplier || !form.name){ alert('Supplier and Product Name are required.'); return }
    await addDoc(collection(db,'items'), {
      ...form,
      qty:+form.qty||0, rop:+form.rop||0, min:+form.min||0, max:+form.max||0,
      location: { storage: UNPLACED, drawer: null, slot: null },
      updatedAt: serverTimestamp()
    })
    alert('Saved. New items appear in Unplaced.')
    setForm({supplier:'', name:'', system:'', type:'consumable', size:'', qty:0, rop:0, min:0, max:0, sku:'', notes:'', usage:'medium'})
  }

  return (
    <>
      <header><div>Register Product</div><div><button className="btn" onClick={onJump}>Inventory</button></div></header>
      <div className="body two-col">
        <div className="narrow">
          <div className="row">
            <div className="field">
              <label>Supplier</label>
              <input list="dlSuppliers" value={form.supplier} onChange={e=>update('supplier', e.target.value)} placeholder="Type or pick supplier"/>
              <datalist id="dlSuppliers">{suppliers.map(s=><option key={s} value={s} />)}</datalist>
            </div>
            <div className="field"><label>Product Name</label><input value={form.name} onChange={e=>update('name', e.target.value)} placeholder="e.g. 3.5mm Cortical Screw" /></div>
          </div>
          <div className="row-3">
            <div className="field"><label>System</label><input list="dlSystems" value={form.system} onChange={e=>update('system', e.target.value)} placeholder="e.g. Distal Elbow Set" /><datalist id="dlSystems">{systems.map(s=><option key={s} value={s} />)}</datalist></div>
            <div className="field"><label>Type</label>
              <select value={form.type} onChange={e=>update('type', e.target.value)}>
                <option value="consumable">Consumable</option>
                <option value="implant">Implant</option>
                <option value="table_attach">Table & Attachments</option>
                <option value="medical_device">Medical Device</option>
                <option value="instrument_tray">Instrument Tray</option>
                <option value="single_pack">Single Pack</option>
              </select>
            </div>
            <div className="field"><label>Size</label><input value={form.size} onChange={e=>update('size', e.target.value)} placeholder="e.g. 120mm / 12-hole" /></div>
          </div>

          <div className="row-3">
            <div className="field"><label>Current Stock</label><input type="number" value={form.qty} onChange={e=>update('qty', e.target.value)} /></div>
            <div className="field"><label>Reorder Point (ROP)</label><input type="number" value={form.rop} onChange={e=>update('rop', e.target.value)} /></div>
            <div className="field"><label>Product Ref / SKU</label><input value={form.sku} onChange={e=>update('sku', e.target.value)} placeholder="e.g. 214.832" /></div>
          </div>

          <div className="row-3">
            <div className="field"><label>Consignment Min Level</label><input type="number" value={form.min} onChange={e=>update('min', e.target.value)} /></div>
            <div className="field"><label>Consignment Max Level</label><input type="number" value={form.max} onChange={e=>update('max', e.target.value)} /></div>
            <div className="field"><label>Usage Level</label>
              <div className="seg">
                {['high','medium','low'].map(u=>(
                  <button key={u} className={form.usage===u?'active':''} onClick={()=>update('usage',u)}>{u==='high'?'🟢 High':u==='medium'?'⚫ Medium':'🔴 Low'}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="row"><div className="field" style={{gridColumn:'1/-1'}}>
            <label>Notes</label><textarea rows="4" value={form.notes} onChange={e=>update('notes', e.target.value)} placeholder="Optional notes (size, lot, expiry, packaging, pairing, etc.)"></textarea>
          </div></div>

          <div className="chip" style={{margin:'8px 0', display:'inline-block'}}>New items are saved as <strong>Unplaced</strong>. Place them later in <em>Storage Map</em>.</div>

          <div style={{marginTop:12, display:'flex', gap:10, alignItems:'center'}}>
            <button className="btn primary" onClick={save}>Save product</button>
            <button className="btn" onClick={()=>setForm({supplier:'', name:'', system:'', type:'consumable', size:'', qty:0, rop:0, min:0, max:0, sku:'', notes:'', usage:'medium'})}>Clear</button>
          </div>
        </div>
      </div>
    </>
  )
}
