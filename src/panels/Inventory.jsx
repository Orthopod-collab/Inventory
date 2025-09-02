import React, { useMemo, useState, useEffect, useRef } from 'react'
import {
  deleteDoc, doc, serverTimestamp, updateDoc, addDoc, collection, deleteField,
  writeBatch
} from 'firebase/firestore'
import { db } from '../firebase'
import * as XLSX from 'xlsx'

/* ====================== Small helpers ====================== */
const clean = v => String(v ?? '').trim()
const toDateStr = ts => {
  try {
    if (!ts) return ''
    if (ts.toDate) return ts.toDate().toLocaleString()
    if (ts.seconds) return new Date(ts.seconds * 1000).toLocaleString()
    const d = ts instanceof Date ? ts : new Date(ts)
    return isNaN(d) ? '' : d.toLocaleString()
  } catch { return '' }
}
const stockLevel = it => {
  const q = +it?.qty || 0, min = +it?.min || 0
  const max = Number.isFinite(+it?.max) ? (+it?.max || 0) : Infinity
  if (Number.isFinite(max) && q > max) return 'over'
  if (q < min) return 'below'
  return 'ok'
}
const ensureArray = v =>
  Array.isArray(v) ? v.filter(Boolean).map(clean)
  : clean(v) ? clean(v).split(/[;,]/).map(s => clean(s)).filter(Boolean) : []

const titleCase = s => String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())

/* -------- fuzzy resolver (spelling match) -------- */
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'')
const levenshtein = (a,b)=>{
  a=norm(a); b=norm(b)
  const m=Array.from({length:a.length+1},(_,i)=>[i])
  for(let j=1;j<=b.length;j++) m[0][j]=j
  for(let i=1;i<=a.length;i++){
    for(let j=1;j<=b.length;j++){
      const cost = a[i-1]===b[j-1] ? 0 : 1
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1]+cost)
    }
  }
  return m[a.length][b.length]
}
/** Return best option from list (case/spacing-insensitive), falling back to raw input */
function resolveFromList(input, options){
  const raw = clean(input); if(!raw) return ''
  const L = options || []
  const ni = norm(raw)
  // exact (case-insensitive)
  const exact = L.find(o => norm(o)===ni); if (exact) return exact
  // prefix / includes
  const pref = L.find(o => norm(o).startsWith(ni)) || L.find(o => norm(o).includes(ni))
  if (pref) return pref
  // fuzzy within distance 2
  let best = null, bestD = Infinity
  for(const o of L){ const d = levenshtein(o, raw); if(d<bestD){best=o; bestD=d} }
  if (bestD<=2) return best
  return raw
}

/* Category badge (Trauma/Emergency/Elective) */
const CategoryBadge = ({ value }) => {
  const v = (String(value||'').trim().toLowerCase());
  const cls = v==='emergency' ? 'cat-emergency'
           : v==='elective'  ? 'cat-elective'
           : v==='trauma'    ? 'cat-trauma'
           : '';
  const label = v ? v.replace(/^\w/,c=>c.toUpperCase()) : '—';
  return <span className={`cat-badge ${cls}`}>{label}</span>;
};

/* Type pill (uses your .pill + .type-* styles) */
const TypePill = ({ value }) => {
  const v = clean(value)
  if (!v) return <span style={{ color:'var(--muted)' }}>—</span>
  const cls = `pill type-${v.replace(/\s+/g,'_')}`
  return <span className={cls}>{titleCase(v)}</span>
}

/* ====================== Tiny tag input for Systems ====================== */
function SystemTagsInput({ value, onChange, suggestions = [] }) {
  const [input, setInput] = React.useState('');

  const add = (t) => {
    const tag = String(t || '').trim();
    if (!tag) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setInput('');
  };
  const remove = (t) => onChange(value.filter(x => x !== t));

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      e.preventDefault();
      add(input);
    } else if (e.key === 'Backspace' && !input && value.length) {
      remove(value[value.length - 1]);
    }
  };

  return (
    <div className="tag-input">
      {value.map(t => (
        <span key={t} className="tag token">
          {t}
          <button type="button" onClick={() => remove(t)} aria-label={`Remove ${t}`}>×</button>
        </span>
      ))}
      <input
        list="bulk-sys-suggest"
        placeholder="Type a system, press Enter…"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <datalist id="bulk-sys-suggest">
        {suggestions.map(s => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}

/* ====================== Parser ====================== */
function parseCSV(text){
  const out=[], row=[], push=()=>{ out.push(row.splice(0)) }
  let v='', q=false
  for (let i=0;i<text.length;i++){
    const c=text[i], n=text[i+1]
    if (q){ if (c==='"' && n==='"'){v+='"'; i++} else if (c==='"'){q=false} else v+=c }
    else { if (c==='"') q=true; else if (c===','){row.push(v); v=''} else if (c==='\n'){row.push(v); v=''; push()} else if (c!=='\r') v+=c }
  }
  if (v.length || row.length){ row.push(v); push() }
  if (!out.length) return { headers:[], rows:[] }
  const headers = out[0].map(clean)
  const rows = out.slice(1).filter(r => r.some(x => clean(x) !== ''))
  return { headers, rows }
}
function parseXLSX(ab){
  const wb = XLSX.read(ab, { type:'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const m = XLSX.utils.sheet_to_json(ws, { header:1, blankrows:false })
  if (!m.length) return { headers:[], rows:[] }
  const headers = m[0].map(clean)
  const rows = m.slice(1).filter(r => r && r.some(x => clean(x) !== ''))
  return { headers, rows }
}
const isExcelFile = f => {
  const n=(f?.name||'').toLowerCase(), t=(f?.type||'').toLowerCase()
  return n.endsWith('.xlsx') || n.endsWith('.xls') || t.includes('spreadsheet') || t.includes('excel')
}

/* ====================== Mapping helpers ====================== */
const TARGET_FIELDS = [
  { key:'sku', label:'SKU', required:true },
  { key:'name', label:'Product Description' },
  { key:'supplier', label:'Supplier' },
  { key:'system', label:'System' },
  { key:'category', label:'Category' },             // Trauma / Emergency / Elective
  { key:'type', label:'Type' },                     // consumable / implant / etc.
  { key:'qty', label:'Qty' }, { key:'min', label:'Min' }, { key:'max', label:'Max' }, { key:'rop', label:'ROP' },
  { key:'usage', label:'Usage' },
  { key:'room', label:'Room' }, { key:'storageName', label:'Storage' }, { key:'drawer', label:'Drawer/Layer' }, { key:'slot', label:'Slot' },
  { key:'comments', label:'Comments' },
  { key:'description', label:'(Alt) Description only' },
]
const normalizeHeader = h => {
  const n = clean(h).toLowerCase().replaceAll(/[\s_-]/g,'')
  const map = {
    sku:'sku', code:'sku', catalogue:'sku', catalog:'sku', catno:'sku', itemno:'sku', partno:'sku', ref:'sku',
    product:'name', item:'name', description:'description',
    supplier:'supplier', manufacturer:'supplier', brand:'supplier',
    system:'system', tray:'system', set:'system',
    category:'category', type:'type',
    qty:'qty', stock:'qty',
    min:'min', minimum:'min', reorderlevel:'min',
    max:'max', maximum:'max',
    rop:'rop', reorder:'rop', reorderpoint:'rop',
    usage:'usage',
    room:'room', storage:'storageName', cabinet:'storageName', cupboard:'storageName',
    drawer:'drawer', layer:'drawer', shelf:'drawer',
    slot:'slot', bin:'slot', position:'slot',
    comments:'comments', notes:'comments',
  }
  return map[n] || null
}
const suggestMap = headers => {
  const map={}
  headers.forEach((h,i)=>{ const k=normalizeHeader(h); if(k) map[k]=i })
  return map
}
const buildRowsFromMapping = (headers, rows, map, descOnly=false) => {
  const idx = k => map[k]
  return rows.map(r=>{
    const get = k => map[k]==null? '' : clean(r[idx(k)])
    let name = get('name'), system = get('system')
    if (descOnly && map.description!=null) name = get('description')
    return {
      sku: get('sku'),
      name,
      supplier: get('supplier'),
      system,
      category: get('category'),       // no default; user will set Trauma/Emergency/Elective
      type: get('type'),
      qty: +get('qty') || 0, min: +get('min') || 0,
      max: get('max')==='' ? '' : (+get('max') || 0),
      rop: +get('rop') || 0,
      usage: get('usage') || '',
      room: get('room'), storageName: get('storageName'),
      drawer: get('drawer'), slot: get('slot'),
      comments: get('comments'),
    }
  }).filter(r=>clean(r.sku))
}

/* ====================== Column widths (Excel-like) ====================== */
const COL_ORDER = [
  'select','sku','name','supplier','system','category','type','location',
  'qty','min','max','rop','usage','var','status','updated','comments','flags'
]
const DEFAULT_COL_WIDTHS = {
  select:34, sku:130, name:520, supplier:160, system:220, category:110, type:150,
  location:360, qty:56, min:56, max:56, rop:56, usage:56, var:56, status:70,
  updated:180, comments:120, flags:70
}
const WIDTHS_KEY = 'inv.colWidths.v2'

/* ====================== Component ====================== */
export default function Inventory({ items = [], storages = [], setActive=()=>{} }) {
  /* filters */
  const [q, setQ] = useState('')
  const [supplier, setSupplier] = useState('')
  const [systemF, setSystemF] = useState('')
  const [categoryF, setCategoryF] = useState('')   // trauma / emergency / elective
  const [usageF, setUsageF] = useState('')
  const [flagF, setFlagF] = useState('')

  // NEW: quick status & unplaced toggles + committed search marker
  const [statusF, setStatusF] = useState('')        // '', 'due', 'below', 'over'
  const [unplacedOnly, setUnplacedOnly] = useState(false)
  const [committedQ, setCommittedQ] = useState('')

  const [selected, setSelected] = useState(new Set())

  /* sort */
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const onSort = key => {
    setSortKey(key)
    setSortDir(d => (sortKey===key ? (d==='asc'?'desc':'asc') : 'asc'))
  }

  /* upload/mapping */
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [mapModal, setMapModal] = useState({ open:false, headers:[], rows:[], map:{}, descOnly:false })

  /* context/editor */
  const [ctx, setCtx] = useState({ open:false, x:0, y:0, item:null, field:null, markOpen:false })
  const [editor, setEditor] = useState({
    open:false, x:0, y:0, item:null, field:null, mode:'text',
    value:'', systemsValue:'',
    tab:'existing', room:'', storageId:'', drawer:'', slot:'', creatingName:'', creatingRoom:''
  })

  /* ---------- BULK editor (Systems/Supplier/Category/Type/Location) ---------- */
  const [bulk, setBulk] = useState({
    open:false,
    field:'system',               // system | supplier | category | type | location
    op:'add',                     // per-field operation
    // system
    systems:[],
    // supplier/category/type
    supplier:'', category:'', type:'',
    // location
    room:'', storageId:'', drawer:'', slot:'',
    createStorage:false, newStorageName:''
  })

  /* column widths (persisted) */
  const [colWidths, setColWidths] = useState(() => {
    try { return { ...DEFAULT_COL_WIDTHS, ...(JSON.parse(localStorage.getItem(WIDTHS_KEY) || '{}')) } }
    catch { return { ...DEFAULT_COL_WIDTHS } }
  })
  useEffect(()=>{ localStorage.setItem(WIDTHS_KEY, JSON.stringify(colWidths)) }, [colWidths])

  const startResize = (e, key) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = Number(colWidths[key] || DEFAULT_COL_WIDTHS[key] || 80)
    let latest = startW
    const onMove = ev => {
      const delta = ev.clientX - startX
      latest = Math.max(34, Math.min(1600, startW + delta))
      setColWidths(w => ({ ...w, [key]: latest }))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setColWidths(w => {
        const next = { ...w, [key]: latest }
        localStorage.setItem(WIDTHS_KEY, JSON.stringify(next))
        return next
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /* derived sets & options */
  const suppliers = useMemo(()=>(
    Array.from(new Set(items.map(i=>clean(i?.supplier)).filter(Boolean))).sort()
  ),[items])
  const allSystems = useMemo(()=>{
    const set = new Set()
    items.forEach(i => ensureArray(i?.system).forEach(s => set.add(s)))
    return Array.from(set).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}))
  },[items])

  const typeOptions = ['consumable', 'instrument_tray', 'single_pack', 'implant', 'medical_device', 'table_attach']
  const categoryOptions = ['trauma','emergency','elective'] // theatre flows

  /* storage helpers */
  const storagesIn = room => storages.filter(s => clean(s?.location)===clean(room))
  const roomOptions = useMemo(()=>Array.from(new Set(storages.map(s=>s.location).filter(Boolean))).sort(),[storages])
  const storageById = useMemo(()=>{ const m=new Map(); storages.forEach(s=>s?.id && m.set(s.id,s)); return m },[storages])
  const storageKey = (room,name)=>`${clean(room).toLowerCase()}|${clean(name).toLowerCase()}`
  const storageIdByRoomName = useMemo(()=>{
    const m=new Map()
    storages.forEach(s=>m.set(storageKey(s.location, s.name), s.id))
    return m
  },[storages])

  const clampPos = (x,y,w=280,h=200) => ({ x:Math.min(x, innerWidth-w-8), y:Math.min(y, innerHeight-h-8) })

  /* filter + sort */
  const filtered = useMemo(()=>{
    const S = q.toLowerCase()
    const out = items.filter(it=>{
      if (!it) return false
      if (supplier && clean(it.supplier) !== supplier) return false
      if (systemF) {
        if (!ensureArray(it.system).some(s => s===systemF)) return false
      }
      if (categoryF && clean(it.category).toLowerCase() !== categoryF) return false
      if (usageF && clean(it.usage) !== usageF) return false
      const f = it.flags || {}
      const any = !!(f.pinned || f.urgent || f.watching)
      if (flagF==='flagged' && !any) return false
      if (flagF==='pinned' && !f.pinned) return false
      if (flagF==='urgent' && !f.urgent) return false
      if (flagF==='watching' && !f.watching) return false

      // NEW: status and unplaced filters
      const qn = +it?.qty || 0
      const mn = +it?.min || 0
      const mx = Number.isFinite(+it?.max) ? (+it?.max || 0) : Infinity
      const rp = +it?.rop || 0
      if (statusF==='due'   && !(qn <= rp)) return false
      if (statusF==='below' && !(qn <  mn)) return false
      if (statusF==='over'  && !(Number.isFinite(mx) && qn > mx)) return false
      if (unplacedOnly && it?.location?.storage) return false

      const hay = [
        it.name, it.sku, it.supplier, ensureArray(it.system).join(' '),
        it.category, it.type, it.size
      ].map(x=>String(x||'').toLowerCase()).join(' ')
      return !S || hay.includes(S)
    })

    const cmp = (a,b) => {
      const dir = sortDir==='asc' ? 1 : -1
      const KA = (k) => (k==='system' ? ensureArray(a.system).join(', ')
        : k==='updatedAt' ? +((a.updatedAt?.seconds||0)*1000)
        : (a[k] ?? ''))
      const KB = (k) => (k==='system' ? ensureArray(b.system).join(', ')
        : k==='updatedAt' ? +((b.updatedAt?.seconds||0)*1000)
        : (b[k] ?? ''))
      const va = KA(sortKey), vb = KB(sortKey)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), undefined, { numeric:true, sensitivity:'base' }) * dir
    }
    return out.sort(cmp)
  },[items, q, supplier, systemF, categoryF, usageF, flagF, statusF, unplacedOnly, sortKey, sortDir])

  const stats = useMemo(()=>{
    const f = filtered
    return {
      total: f.length,
      stock: f.reduce((n,i)=>n + (+i?.qty||0), 0),
      due:   f.filter(i => (+i?.qty||0) <= (+i?.rop||0)).length,
      below: f.filter(i => (+i?.qty||0) <  (+i?.min||0)).length,
      over:  f.filter(i => Number.isFinite(+i?.max) && (+i?.qty||0) > (+i?.max||0)).length,
      usageH: f.filter(i=>i?.usage==='high').length,
      usageM: f.filter(i=>i?.usage==='medium').length,
      usageL: f.filter(i=>i?.usage==='low').length,

      // NEW: flags + placement
      flagPinned:   f.filter(i => i?.flags?.pinned).length,
      flagWatching: f.filter(i => i?.flags?.watching).length,
      flagUrgent:   f.filter(i => i?.flags?.urgent).length,
      unplaced:     f.filter(i => !i?.location?.storage).length,
    }
  },[filtered])

  /* selection */
  const allFilteredIds = useMemo(()=>new Set(filtered.map(i=>i.id)), [filtered])
  const isAllSelected = selected.size>0 && filtered.every(i=>selected.has(i.id))
  const toggleSelect = id => setSelected(prev=>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n })
  const toggleSelectAll = () => setSelected(prev=>{
    const n=new Set(prev)
    if (isAllSelected) filtered.forEach(i=>n.delete(i.id)); else filtered.forEach(i=>n.add(i.id))
    return n
  })

  async function deleteSelected(){
    if (!selected.size) return
    const ids = [...selected].filter(id=>allFilteredIds.has(id))
    if (!ids.length) return
    if (!confirm(`Delete ${ids.length} selected item(s)?`)) return
    await Promise.all(ids.map(async id=>{
      await deleteDoc(doc(db,'items',id))
      await addDoc(collection(db,'activities'),{ type:'Delete Item', details:`Item ${id} removed (bulk)`, createdAt:serverTimestamp() })
    }))
    setSelected(new Set())
  }

  /* export */
  function exportCSV(items, storages){
    const rows=[['SKU','Product Description','Supplier','System','Category','Type','Qty','Min','Max','ROP','Usage','Room','Storage','Drawer','Slot','Comments']]
    items.forEach(it=>{
      const s = storages.find(x=>x.id===it?.location?.storage) || {}
      rows.push([
        it.sku||'', it.name||'', it.supplier||'',
        ensureArray(it.system).join('; '),
        it.category||'', it.type||'',
        it.qty||0, it.min||0, it.max||0, it.rop||0, it.usage||'',
        s.location||'', s.name||'', it?.location?.drawer||'', it?.location?.slot||'',
        (it.comments ?? it.notes ?? '').toString().replace(/\n/g,' ')
      ])
    })
    const csv = rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], {type:'text/csv'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='inventory.csv'; a.click()
  }

  /* context menu + editor */
  const openCtxRow = (e,item)=>{ e.preventDefault(); const p=clampPos(e.clientX,e.clientY,240,160); setCtx({ open:true,x:p.x,y:p.y,item,field:null,markOpen:false }) }
  const openCellCtx = (e,item,field)=>{ e.preventDefault(); e.stopPropagation(); const p=clampPos(e.clientX,e.clientY,240,160); setCtx({ open:true,x:p.x,y:p.y,item,field,markOpen:false }) }
  const closeAll = ()=>{ 
    setCtx(s=>({...s,open:false,markOpen:false,item:null,field:null})); 
    setEditor(s=>({...s,open:false,item:null,field:null}));
    setBulk(s=>({...s, open:false}));
  }
  useEffect(()=>{ 
    const onEsc=e=>e.key==='Escape'&&closeAll(); 
    const onScroll=()=> (ctx.open||editor.open||bulk.open)&&closeAll(); 
    addEventListener('keydown',onEsc); 
    addEventListener('scroll',onScroll,true); 
    return ()=>{ removeEventListener('keydown',onEsc); removeEventListener('scroll',onScroll,true) } 
  },[ctx.open,editor.open,bulk.open])

  const nonEditable = new Set(['var','status','comments','flags'])
  const openEditorFromMenu = ()=>{
    if (!ctx.field || nonEditable.has(String(ctx.field).toLowerCase())) return
    openEditor(ctx.item, ctx.field, ctx.x, ctx.y)
  }
  function openEditor(item, field, ax, ay){
    let mode='text', value=item?.[field] ?? ''
    const p = clampPos(ax, ay, field==='location'?520:280, field==='location'?300:170)

    if (['qty','min','max','rop'].includes(field)) { mode='number'; value=+value||0 }
    else if (field==='category') { mode='select'; value=String(value||'') }
    else if (field==='usage') { mode='seg'; value=String(value||'medium') }
    else if (field==='location') { mode='location' }
    else if (field==='system') { mode='systems' }

    const curStorageId = item?.location?.storage || ''
    const curStorage = storageById.get(curStorageId)
    const room = curStorage?.location || ''

    setEditor({
      open:true, x:p.x, y:p.y, item, field, mode,
      value,
      systemsValue: field==='system' ? ensureArray(item?.system).join(', ') : '',
      tab:'existing', room, storageId:curStorageId,
      drawer: clean(item?.location?.drawer), slot: clean(item?.location?.slot),
      creatingName:'', creatingRoom:''
    })
    setCtx(s=>({...s,open:false}))
  }
  async function saveEditor(){
    const { item, field, mode } = editor
    if (!item || !field) return
    const ref = doc(db,'items',item.id)
    try {
      if (mode==='text'){
        const v = clean(editor.value)
        await updateDoc(ref,{ [field]:v, updatedAt:serverTimestamp() })
      } else if (mode==='number'){
        const v = Math.max(0, Number(editor.value)||0)
        await updateDoc(ref,{ [field]:v, updatedAt:serverTimestamp() })
      } else if (mode==='select'){
        const v = String(editor.value||'')
        await updateDoc(ref,{ category:v, updatedAt:serverTimestamp() })
      } else if (mode==='seg'){
        const v = String(editor.value||'medium')
        await updateDoc(ref,{ usage:v, updatedAt:serverTimestamp() })
      } else if (mode==='systems'){
        const arr = ensureArray(editor.systemsValue)
        await updateDoc(ref,{ system:arr, updatedAt:serverTimestamp() })
      } else if (mode==='location'){
        if (editor.tab==='existing'){
          const loc = { storage: editor.storageId || null, drawer: editor.drawer || '', slot: editor.slot || '' }
          await updateDoc(ref,{ location:loc, updatedAt:serverTimestamp() })
        } else {
          const name=clean(editor.creatingName), room=clean(editor.creatingRoom)
          if (!name || !room) { alert('Storage name and room are required.'); return }
          const nref = await addDoc(collection(db,'storages'), { name, location:room, createdAt:serverTimestamp() })
          const loc = { storage:nref.id, drawer:editor.drawer||'', slot:editor.slot||'' }
          await updateDoc(ref,{ location:loc, updatedAt:serverTimestamp() })
        }
      }
      await addDoc(collection(db,'activities'),{ type:'Edit', details:`${field} updated on ${item.id}`, createdAt:serverTimestamp() })
    } catch(err){ console.error(err); alert('Failed to save changes.') }
    finally { closeAll() }
  }

  /* flags & comments */
  async function setExclusiveFlag(item,key){
    const cur=item?.flags||{}
    const clear = key && cur[key]
    const next = clear ? { pinned:false, watching:false, urgent:false }
      : { pinned:false, watching:false, urgent:false, [key]:true }
    await updateDoc(doc(db,'items',item.id),{ flags:next, updatedAt:serverTimestamp() })
  }
  async function handleComment(item){
    const existing=item.comments ?? item.notes ?? ''
    if (existing){
      alert(`Comments for ${item.name}:\n\n${existing}`)
      const next = prompt("Type 'e' to edit, 'd' to delete, or OK to close:","")
      if (next?.toLowerCase()==='e'){
        const updated=prompt('Edit comment:', existing)
        if (updated!=null){
          await updateDoc(doc(db,'items',item.id),{ comments:clean(updated), updatedAt:serverTimestamp() })
        }
      } else if (next?.toLowerCase()==='d'){
        if (confirm('Delete this comment?')){
          await updateDoc(doc(db,'items',item.id),{ comments:deleteField(), updatedAt:serverTimestamp() })
        }
      }
    } else {
      const msg=prompt(`Add a comment for ${item.name}:`)
      if (msg && clean(msg)){
        await updateDoc(doc(db,'items',item.id),{ comments:clean(msg), updatedAt:serverTimestamp() })
      }
    }
  }

  /* import */
  async function onFileChange(e){
    const file=e.target.files?.[0]; e.target.value=''
    if (!file) return
    let headers=[], rows=[]
    try{
      setImporting(true)
      if (isExcelFile(file)){ const ab=await file.arrayBuffer(); ({headers,rows}=parseXLSX(ab)) }
      else { const tx=await file.text(); ({headers,rows}=parseCSV(tx)) }
    } catch(err){ console.error(err); alert('Could not read file.'); setImporting(false); return }
    if (!headers.length || !rows.length){ alert('The file seems empty.'); setImporting(false); return }
    setMapModal({ open:true, headers, rows, map:suggestMap(headers), descOnly:false })
    setImporting(false)
  }
  async function importRows(normalized){
    const cache=new Map(); storages.forEach(s=>cache.set(`${clean(s.location).toLowerCase()}|${clean(s.name).toLowerCase()}`, s.id))
    let batch=writeBatch(db), ops=0
    const commit=async()=>{ if (ops){ await batch.commit(); batch=writeBatch(db); ops=0 } }

    const existingBySKU = new Map(items.map(i=>[clean(i.sku).toLowerCase(), i]))

    for (const r of normalized){
      let storageId=null
      if (r.room && r.storageName){
        const key=`${r.room.toLowerCase()}|${r.storageName.toLowerCase()}`
        storageId = cache.get(key)
        if (!storageId){
          const sref = doc(collection(db,'storages'))
          batch.set(sref,{ name:r.storageName, location:r.room, createdAt:serverTimestamp() })
          storageId=sref.id; cache.set(key, storageId); ops++
          if (ops>=450) await commit()
        }
      }
      const loc = storageId ? { storage:storageId, drawer:r.drawer||'', slot:r.slot||'' } : null

      const payload = {
        sku: clean(r.sku), name: clean(r.name),
        supplier: clean(r.supplier),
        system: ensureArray(r.system),
        category: clean(r.category),           // keep as provided (trauma/emergency/elective)
        type: clean(r.type),
        qty:+r.qty||0, min:+r.min||0, max:r.max===''? '' : (+r.max||0), rop:+r.rop||0,
        usage: clean(r.usage),
        location: loc,
        comments: clean(r.comments),
        updatedAt: serverTimestamp()
      }

      const ex = existingBySKU.get(clean(r.sku).toLowerCase())
      if (ex) batch.update(doc(db,'items',ex.id), payload)
      else { const ref = doc(collection(db,'items')); batch.set(ref, { ...payload, createdAt:serverTimestamp() }) }
      ops++; if (ops>=450) await commit()
    }
    await commit()
    await addDoc(collection(db,'activities'),{ type:'CSV/XLSX Import', details:`Rows: ${normalized.length}`, createdAt:serverTimestamp() })
  }

  /* ===== Bulk apply (System/Supplier/Category/Type/Location) ===== */
  async function applyBulk(){
    const ids = [...selected]
    if (!ids.length) { setBulk(s=>({...s, open:false})); return; }

    const byId = new Map(items.map(i=>[i.id,i]))
    let batch = writeBatch(db), ops = 0
    const commit = async()=>{ if (ops){ await batch.commit(); batch=writeBatch(db); ops=0 } }

    // Precompute canonical inputs
    const canonSupplier = bulk.supplier ? resolveFromList(bulk.supplier, suppliers) : ''
    const canonCategory = bulk.category ? resolveFromList(bulk.category, categoryOptions) : ''
    const canonType     = bulk.type     ? resolveFromList(bulk.type,     typeOptions)     : ''

    // If creating a storage, create once up-front
    let targetStorageId = bulk.storageId || null
    if (bulk.field==='location' && bulk.op==='move' && bulk.createStorage){
      const room = clean(bulk.room), name = clean(bulk.newStorageName)
      if (!room || !name){ alert('Room and new storage name are required.'); return }
      const existing = storageIdByRoomName.get(storageKey(room, name))
      if (existing) targetStorageId = existing
      else {
        const sref = await addDoc(collection(db,'storages'), { name, location:room, createdAt:serverTimestamp() })
        targetStorageId = sref.id
      }
    }

    // Systems tags normalised set
    const sysTags = Array.from(new Set((bulk.systems||[]).map(t=>clean(t)))).filter(Boolean)

    for (const id of ids){
      const it = byId.get(id); if (!it) continue;
      const ref = doc(db,'items',id)

      if (bulk.field==='system'){
        const cur = ensureArray(it.system)
        let next = cur
        if (bulk.op==='add')       next = Array.from(new Set([...cur, ...sysTags]))
        if (bulk.op==='remove')    next = cur.filter(t => !sysTags.includes(t))
        if (bulk.op==='replace')   next = sysTags
        if (bulk.op==='clear')     next = []
        batch.update(ref, { system: next, updatedAt: serverTimestamp() }); ops++
      }

      if (bulk.field==='supplier'){
        if (bulk.op==='clear') batch.update(ref, { supplier: deleteField(), updatedAt:serverTimestamp() }), ops++
        else if (bulk.op==='set') batch.update(ref, { supplier: clean(canonSupplier), updatedAt:serverTimestamp() }), ops++
      }

      if (bulk.field==='category'){
        if (bulk.op==='clear') batch.update(ref, { category: deleteField(), updatedAt:serverTimestamp() }), ops++
        else if (bulk.op==='set') batch.update(ref, { category: String(canonCategory||'').toLowerCase(), updatedAt:serverTimestamp() }), ops++
      }

      if (bulk.field==='type'){
        if (bulk.op==='clear') batch.update(ref, { type: deleteField(), updatedAt:serverTimestamp() }), ops++
        else if (bulk.op==='set') {
          const v = clean(canonType).replace(/\s+/g,'_')
          batch.update(ref, { type: v, updatedAt: serverTimestamp() }); ops++
        }
      }

      if (bulk.field==='location'){
        if (bulk.op==='clear'){
          batch.update(ref, { location: deleteField(), updatedAt: serverTimestamp() }); ops++
        } else if (bulk.op==='move'){
          const loc = {
            storage: bulk.createStorage ? targetStorageId : (bulk.storageId || null),
            drawer: bulk.drawer || '',
            slot: bulk.slot || ''
          }
          batch.update(ref, { location: loc, updatedAt: serverTimestamp() }); ops++
        }
      }

      if (ops>=450) await commit()
    }

    await commit()
    await addDoc(collection(db,'activities'),{
      type:'Bulk Edit',
      details:`Field=${bulk.field}, Count=${ids.length}`,
      createdAt: serverTimestamp()
    })
    setBulk(s=>({...s, open:false}))
  }

  /* ===== Bulk DELETE (updated & safe) ===== */
  const [deletingBulk, setDeletingBulk] = useState(false);
  const bulkDeleteSelected = React.useCallback(async () => {
    const ids = Array.from(selected);
    if (!ids.length || deletingBulk) return;

    const confirmed = confirm(
      `Permanently delete ${ids.length} selected item(s)? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingBulk(true);
    try {
      let batch = writeBatch(db), ops = 0;
      const commit = async()=>{ if (ops){ await batch.commit(); batch=writeBatch(db); ops=0 } };

      for (const id of ids){
        batch.delete(doc(db,'items', id));
        ops++;
        if (ops >= 450) await commit(); // under 500/batch
      }
      await commit();

      await addDoc(collection(db,'activities'),{
        type:'Bulk Delete',
        details:`Count=${ids.length}`,
        createdAt: serverTimestamp()
      });

      setSelected(new Set());
      setBulk(s => ({ ...s, open:false }));
    } catch (err) {
      console.error(err);
      alert('Failed to delete selected. See console for details.');
    } finally {
      setDeletingBulk(false);
    }
  }, [selected, deletingBulk]);

  /* ====================== UI ====================== */
  return (
    <>
      <main>
        <div className="card">
          <div className="body">
            {/* toolbar */}
            <div className="toolbar">
              <div className="search" style={{flex:1, position:'relative'}}>
                <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z"/></svg>
                <input
                  placeholder="Search SKU, product, supplier, system…"
                  value={q}
                  onChange={e=>setQ(e.target.value)}
                  onKeyDown={e=>{ if (e.key==='Enter') setCommittedQ(q) }}
                  style={{ paddingRight: q ? 120 : undefined }}
                />
                {q && (
                  <span
                    className="search-count"
                    title={committedQ === q ? 'Committed search' : 'Live matches'}
                    style={{
                      position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                      fontSize:12, color:'var(--muted)', background:'rgba(0,0,0,0.04)',
                      padding:'2px 8px', borderRadius:12, border:'1px solid #e6e8f0'
                    }}
                  >
                    {filtered.length.toLocaleString()} match{filtered.length===1?'':'es'}{committedQ && committedQ===q ? ' • ⏎' : ''}
                  </span>
                )}
              </div>

              <select className="btn" value={supplier} onChange={e=>{ setSupplier(e.target.value) }}>
                <option value="">All suppliers</option>
                {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <select className="btn" value={systemF} onChange={e=>setSystemF(e.target.value)}>
                <option value="">All systems</option>
                {allSystems.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <select className="btn" value={categoryF} onChange={e=>setCategoryF(e.target.value)}>
                <option value="">All categories</option>
                {['trauma','emergency','elective'].map(t=><option key={t} value={t}>{titleCase(t)}</option>)}
              </select>

              <div className="seg">
                {['','high','medium','low'].map(v=>(
                  <button key={v||'all'} className={usageF===v?'active':''} onClick={()=>setUsageF(v)}>{v||'All'}</button>
                ))}
              </div>

              <select className="btn" value={flagF} onChange={e=>setFlagF(e.target.value)}>
                <option value="">All flags</option>
                <option value="flagged">Any flagged</option>
                <option value="pinned">Pinned</option>
                <option value="urgent">Urgent</option>
                <option value="watching">Watching</option>
              </select>

              <label className="sel-all">
                <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll}/>
                <span>Select all</span>
              </label>

              {selected.size > 0 && (
                <button className="btn" onClick={()=>setBulk(s=>({...s, open:true }))}>
                  Bulk edit ({selected.size})
                </button>
              )}

              <button className="btn" onClick={()=>exportCSV(items,storages)}>Export CSV</button>
              <button className="btn" onClick={()=>fileRef.current?.click()} disabled={importing}>{importing?'Importing…':'Upload CSV/XLSX'}</button>
              <input ref={fileRef} type="file"
                accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,.xlsx,.xls"
                style={{display:'none'}} onChange={onFileChange}/>
            </div>

            {/* stats */}
            <div className="chips" style={{margin:'8px 0', overflowX:'auto', whiteSpace:'nowrap'}}>
              <span className="chip stat">Total items: {stats.total.toLocaleString()}</span>
              <span className="chip stat">Total stock: {stats.stock.toLocaleString()}</span>

              <button className={`chip ${statusF==='due'?'on':''}`} onClick={()=>setStatusF(s=>s==='due'?'':'due')} title="At/below ROP">
                Reorder due: {stats.due.toLocaleString()}
              </button>
              <button className={`chip ${statusF==='below'?'on':''}`} onClick={()=>setStatusF(s=>s==='below'?'':'below')} title="Below Min">
                Below min: {stats.below.toLocaleString()}
              </button>
              <button className={`chip ${statusF==='over'?'on':''}`} onClick={()=>setStatusF(s=>s==='over'?'':'over')} title="Over Max">
                Over max: {stats.over.toLocaleString()}
              </button>

              <button className={`chip ${flagF==='pinned'?'on':''}`} onClick={()=>setFlagF(f=>f==='pinned'?'':'pinned')} title="Show pinned">
                📌 Pinned: {stats.flagPinned.toLocaleString()}
              </button>
              <button className={`chip ${flagF==='watching'?'on':''}`} onClick={()=>setFlagF(f=>f==='watching'?'':'watching')} title="Show watching">
                👁 Watching: {stats.flagWatching.toLocaleString()}
              </button>
              <button className={`chip ${flagF==='urgent'?'on':''}`} onClick={()=>setFlagF(f=>f==='urgent'?'':'urgent')} title="Show urgent">
                ❗ Urgent: {stats.flagUrgent.toLocaleString()}
              </button>

              <button className={`chip ${unplacedOnly?'on':''}`} onClick={()=>setUnplacedOnly(v=>!v)} title="No storage assigned">
                Unplaced: {stats.unplaced.toLocaleString()}
              </button>

              <span className="chip">Usage (H/M/L): {stats.usageH}/{stats.usageM}/{stats.usageL}</span>

              {(statusF || unplacedOnly || supplier || systemF || categoryF || usageF || flagF || q) && (
                <button
                  className="chip outline"
                  onClick={()=>{
                    setStatusF(''); setUnplacedOnly(false);
                    setSupplier(''); setSystemF(''); setCategoryF('');
                    setUsageF(''); setFlagF(''); setQ(''); setCommittedQ('');
                  }}
                  title="Clear all filters"
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* table */}
            <div style={{overflow:'auto'}}>
              <table id="invTable" className="sheet-style">
                <colgroup>
                  {COL_ORDER.map(k => (
                    <col key={k} style={{ width: (colWidths[k] ?? DEFAULT_COL_WIDTHS[k] ?? 80) }} />
                  ))}
                </colgroup>

                <thead>
                  <tr>
                    <th className="is-resizable col-select"></th>

                    <th className="is-resizable col-sku" onClick={()=>onSort('sku')}>
                      SKU {sortKey==='sku' ? (sortDir==='asc'?'▲':'▼') : ''}
                      <span className="col-resizer" onMouseDown={(e)=>startResize(e,'sku')}/>
                    </th>

                    <th className="is-resizable col-name" onClick={()=>onSort('name')}>
                      Product Description {sortKey==='name' ? (sortDir==='asc'?'▲':'▼') : ''}
                      <span className="col-resizer" onMouseDown={(e)=>startResize(e,'name')}/>
                    </th>

                    <th className="is-resizable col-supplier" onClick={()=>onSort('supplier')}>
                      Supplier {sortKey==='supplier' ? (sortDir==='asc'?'▲':'▼') : ''}
                      <span className="col-resizer" onMouseDown={(e)=>startResize(e,'supplier')}/>
                    </th>

                    <th className="is-resizable col-system" onClick={()=>onSort('system')}>
                      System {sortKey==='system' ? (sortDir==='asc'?'▲':'▼') : ''}
                      <span className="col-resizer" onMouseDown={(e)=>startResize(e,'system')}/>
                    </th>

                    <th className="is-resizable col-category" onClick={()=>onSort('category')}>
                      Category {sortKey==='category' ? (sortDir==='asc'?'▲':'▼') : ''}
                      <span className="col-resizer" onMouseDown={(e)=>startResize(e,'category')}/>
                    </th>

                    <th className="is-resizable col-type" onClick={()=>onSort('type')}>
                      Type {sortKey==='type' ? (sortDir==='asc'?'▲':'▼') : ''}
                      <span className="col-resizer" onMouseDown={(e)=>startResize(e,'type')}/>
                    </th>

                    <th className="is-resizable col-location">
                      Location
                      <span className="col-resizer" onMouseDown={(e)=>startResize(e,'location')}/>
                    </th>

                    {['qty','min','max','rop','usage','var','status','updated','comments','flags'].map(k=>(
                      <th key={k} className={`is-resizable col-${k}`} onClick={()=>{
                        if (['updated','comments','flags','status','var'].includes(k)) return
                        onSort(k)
                      }}>
                        {{
                          qty:'Stock', min:'Min', max:'Max', rop:'ROP', usage:'Usage',
                          var:'Var', status:'Status', updated:'Updated', comments:'Comments', flags:'Flags'
                        }[k]}
                        <span className="col-resizer" onMouseDown={(e)=>startResize(e,k)}/>
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {filtered.map(it=>{
                    const sObj = storages.find(s=>s.id===it?.location?.storage) || {}
                    const storageName = sObj?.name || '', roomName = sObj?.location || ''
                    const lev = stockLevel(it)
                    const qty=+it?.qty||0, min=+it?.min||0
                    const max = Number.isFinite(+it?.max) ? (+it?.max||0) : Infinity
                    const variance = Number.isFinite(max) && qty>max ? 'Over' : (qty<min ? 'Short' : 'Full')
                    const checked = selected.has(it.id)
                    const systems = ensureArray(it.system)
                    const isUnplaced = !roomName

                    return (
                      <tr key={it.id} className={checked?'row-selected':''} onContextMenu={e=>openCtxRow(e,it)}>
                        <td className="col-select" style={{textAlign:'center'}}>
                          <input type="checkbox" checked={checked} onChange={()=>toggleSelect(it.id)} />
                        </td>

                        <td className="col-sku mono" onDoubleClick={e=>openEditor(it,'sku',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'sku')}>{it.sku||''}</td>

                        <td className="col-name" onDoubleClick={e=>openEditor(it,'name',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'name')}>
                          <strong>{it.name}</strong>
                        </td>

                        <td className="col-supplier" onDoubleClick={e=>openEditor(it,'supplier',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'supplier')}>
                          {it.supplier}
                        </td>

                        <td className="col-system" onDoubleClick={e=>openEditor(it,'system',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'system')}>
                          {systems.length ? systems.map(s=><span key={s} className="tag info">{s}</span>) : <span style={{color:'var(--muted)'}}>—</span>}
                        </td>

                        <td className="col-category" onDoubleClick={e=>openEditor(it,'category',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'category')}>
                          <CategoryBadge value={it.category} />
                        </td>

                        <td className="col-type" onDoubleClick={e=>openEditor(it,'type',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'type')}>
                          <TypePill value={it.type} />
                        </td>

                        <td className="col-location" onDoubleClick={e=>openEditor(it,'location',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'location')}>
                          <span style={isUnplaced ? {color:'#b45309', fontWeight:800} : undefined}>
                            {roomName || 'Unplaced'}
                          </span>
                          <div style={{color:'var(--muted)',fontSize:12}}>
                            {storageName} {it?.location?.drawer?('• '+it.location.drawer):''} {it?.location?.slot?('• '+it.location.slot):''}
                          </div>
                        </td>

                        <td className="col-qty mono" onDoubleClick={e=>openEditor(it,'qty',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'qty')}>{qty}</td>
                        <td className="col-min mono" onDoubleClick={e=>openEditor(it,'min',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'min')}>{min}</td>
                        <td className="col-max mono" onDoubleClick={e=>openEditor(it,'max',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'max')}>{Number.isFinite(max)?max:'-'}</td>
                        <td className="col-rop mono" onDoubleClick={e=>openEditor(it,'rop',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'rop')}>{it.rop||0}</td>
                        <td className="col-usage" onDoubleClick={e=>openEditor(it,'usage',e.clientX,e.clientY)} onContextMenu={e=>openCellCtx(e,it,'usage')}>{(it.usage||'').replace(/^\w/,c=>c.toUpperCase())}</td>
                        <td className="col-var">{variance}</td>
                        <td className="col-status"><span className={`level-dot ${lev}`}></span>{lev}</td>
                        <td className="col-updated">{toDateStr(it.updatedAt)}</td>

                        <td className="col-comments no-wrap">
                          <a href="#" className="link" onClick={(e)=>{e.preventDefault(); handleComment(it)}}>
                            {(it.comments ?? it.notes) ? 'View Comment' : 'Add Comment'}
                          </a>
                        </td>

                        <td className="col-flags flags-cell" onContextMenu={e=>openCellCtx(e,it,null)}>
                          {it?.flags?.pinned ? <span title="Pinned">📌</span> :
                           it?.flags?.watching ? <span title="Watching">👁</span> :
                           it?.flags?.urgent ? <span title="Urgent">❗</span> : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {(ctx.open || editor.open || mapModal.open || bulk.open) && <div className="ctx-backdrop" onClick={closeAll}/>}

      {/* context menu */}
      {ctx.open && (
        <div className="ctx-menu tight" style={{left:ctx.x, top:ctx.y}}>
          <button onClick={openEditorFromMenu}
            disabled={!ctx.field || (new Set(['var','status','comments','flags']).has((ctx.field||'').toLowerCase()))}
            style={!ctx.field || (new Set(['var','status','comments','flags']).has((ctx.field||'').toLowerCase())) ? {opacity:.5, pointerEvents:'none'} : {}}>
            ✏️ Edit {ctx.field || ''}
          </button>

          <button onClick={()=>setCtx(s=>({...s,markOpen:!s.markOpen}))}>📍 Mark</button>
          {ctx.markOpen && (
            <div style={{padding:'4px 6px 6px'}}>
              <div style={{display:'flex',gap:6}}>
                <button className={ctx.item?.flags?.pinned?'on mini':'mini'} onClick={()=>{setExclusiveFlag(ctx.item,'pinned'); closeAll()}}>📌 Pin</button>
                <button className={ctx.item?.flags?.watching?'on mini':'mini'} onClick={()=>{setExclusiveFlag(ctx.item,'watching'); closeAll()}}>👁 Watch</button>
                <button className={ctx.item?.flags?.urgent?'on mini':'mini'} onClick={()=>{setExclusiveFlag(ctx.item,'urgent'); closeAll()}}>❗ Urgent</button>
              </div>
            </div>
          )}

          <div className="ctx-sep"/>
          <button className="on" onClick={async()=>{
            if (!ctx.item) return;
            if (!confirm(`Delete “${ctx.item.name || ctx.item.sku || ctx.item.id}”?`)) return;
            try{
              await deleteDoc(doc(db,'items',ctx.item.id));
              await addDoc(collection(db,'activities'),{
                type:'Delete Item',
                details:`Item ${ctx.item.id} removed (single)`,
                createdAt: serverTimestamp()
              });
            } catch(e){
              console.error(e);
              alert('Failed to delete item.');
            } finally {
              closeAll();
            }
          }}>🗑 Delete</button>
        </div>
      )}

      {/* single-item editors */}
      {editor.open && !['location'].includes(editor.mode) && (
        <div className="ctx-menu tight" style={{left:editor.x, top:editor.y, width:280}}>
          <div style={{fontWeight:700, margin:'2px 6px 6px'}}>Edit {editor.field}</div>

          {editor.mode==='text' && (
            <div style={{padding:'0 6px 6px'}}>
              <input value={editor.value} onChange={e=>setEditor(s=>({...s,value:e.target.value}))}
                     onKeyDown={e=>{ if(e.key==='Enter') saveEditor(); if(e.key==='Escape') closeAll() }}
                     style={{width:'100%', padding:'6px 8px', border:'1px solid #e6e8f0', borderRadius:6}} autoFocus/>
            </div>
          )}

          {editor.mode==='number' && (
            <div style={{display:'flex', alignItems:'center', gap:6, padding:'0 6px 6px'}}>
              <button className="mini" onClick={()=>setEditor(s=>({...s, value:Math.max(0, Number(s.value||0)-1)}))}>▼</button>
              <input type="number" min={0} value={editor.value}
                onChange={e=>setEditor(s=>({...s,value:e.target.value}))}
                onKeyDown={e=>{ if(e.key==='Enter') saveEditor(); if(e.key==='Escape') closeAll() }}
                style={{flex:1, padding:'6px 8px', border:'1px solid #e6e8f0', borderRadius:6}}/>
              <button className="mini" onClick={()=>setEditor(s=>({...s, value:Number(s.value||0)+1}))}>▲</button>
            </div>
          )}

          {editor.mode==='select' && (
            <div style={{padding:'0 6px 6px'}}>
              <select className="btn" style={{width:'100%'}} value={editor.value}
                onChange={e=>setEditor(s=>({...s,value:e.target.value}))}>
                {categoryOptions.map(t=><option key={t} value={t}>{titleCase(t)}</option>)}
              </select>
            </div>
          )}

          {editor.mode==='seg' && (
            <div style={{padding:'0 6px 6px'}}>
              <div className="seg">
                {['high','medium','low'].map(u=>(
                  <button key={u} className={editor.value===u?'active':''} onClick={()=>setEditor(s=>({...s,value:u}))}>
                    {u.replace(/^\w/,c=>c.toUpperCase())}
                  </button>
                ))}
              </div>
            </div>
          )}

          {editor.mode==='systems' && (
            <div style={{padding:'0 6px 6px'}}>
              <input list="systems-suggest" value={editor.systemsValue}
                onChange={e=>setEditor(s=>({...s, systemsValue:e.target.value}))}
                placeholder="Comma separated…"
                style={{width:'100%', padding:'6px 8px', border:'1px solid #e6e8f0', borderRadius:6}}/>
              <datalist id="systems-suggest">
                {allSystems.map(s => <option key={s} value={s} />)}
              </datalist>
              <div style={{marginTop:6, fontSize:12, color:'var(--muted)'}}>Tip: type multiple systems separated by commas.</div>
            </div>
          )}

          <div style={{display:'flex', justifyContent:'flex-end', gap:6, padding:'0 6px 6px'}}>
            <button className="mini" onClick={closeAll}>Cancel</button>
            <button className="mini" onClick={saveEditor}>Save</button>
          </div>
        </div>
      )}

      {/* location editor */}
      {editor.open && editor.mode==='location' && (
        <div className="ctx-menu tight" style={{ left:editor.x, top:editor.y, width:520, fontSize:12 }}>
          <div style={{fontWeight:700, margin:'2px 6px 6px'}}>Edit Location</div>

          <div style={{display:'flex', gap:6, padding:'0 6px 6px'}}>
            <button className={`mini ${editor.tab==='existing'?'':''}`} onClick={()=>setEditor(s=>({...s, tab:'existing'}))}>Move to existing</button>
            <button className={`mini ${editor.tab==='create'?'':''}`} onClick={()=>setEditor(s=>({...s, tab:'create'}))}>Create new</button>
          </div>

          {editor.tab==='existing' ? (
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, padding:'0 6px 6px'}}>
              <div>
                <div style={{fontSize:11, color:'var(--muted)', marginBottom:2}}>Room</div>
                <select className="btn" style={{width:'100%'}} value={editor.room}
                  onChange={e=>{
                    const room=e.target.value
                    const first=storagesIn(room)[0]?.id || ''
                    setEditor(s=>({...s, room, storageId:first, drawer:'', slot:''}))
                  }}>
                  <option value="">—</option>
                  {roomOptions.map(r=><option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <div style={{fontSize:11, color:'var(--muted)', marginBottom:2}}>Storage</div>
                <select className="btn" style={{width:'100%'}} value={editor.storageId}
                  onChange={e=>setEditor(s=>({...s, storageId:e.target.value, drawer:'', slot:''}))}>
                  <option value="">—</option>
                  {storagesIn(editor.room).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              <div>
                <div style={{fontSize:11, color:'var(--muted)', marginBottom:2}}>Drawer/Layer</div>
                <input className="btn" style={{width:'100%'}} value={editor.drawer} onChange={e=>setEditor(s=>({...s, drawer:e.target.value}))}/>
              </div>

              <div>
                <div style={{fontSize:11, color:'var(--muted)', marginBottom:2}}>Slot</div>
                <input className="btn" style={{width:'100%'}} value={editor.slot} onChange={e=>setEditor(s=>({...s, slot:e.target.value}))} disabled={!editor.storageId}/>
              </div>

              <div style={{gridColumn:'1/-1', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <button className="mini" onClick={()=>{ /* open storage map if available */ }}>Open storage map</button>
                <div style={{display:'flex', gap:6}}>
                  <button className="mini" onClick={closeAll}>Cancel</button>
                  <button className="mini" onClick={saveEditor}>Save</button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, padding:'0 6px 6px'}}>
              <div>
                <div style={{fontSize:11, color:'var(--muted)', marginBottom:2}}>New room</div>
                <input className="btn" style={{width:'100%'}} value={editor.creatingRoom} onChange={e=>setEditor(s=>({...s, creatingRoom:e.target.value}))}/>
              </div>
              <div>
                <div style={{fontSize:11, color:'var(--muted)', marginBottom:2}}>New storage name</div>
                <input className="btn" style={{width:'100%'}} value={editor.creatingName} onChange={e=>setEditor(s=>({...s, creatingName:e.target.value}))}/>
              </div>
              <div>
                <div style={{fontSize:11, color:'var(--muted)', marginBottom:2}}>Drawer</div>
                <input className="btn" style={{width:'100%'}} value={editor.drawer} onChange={e=>setEditor(s=>({...s, drawer:e.target.value}))}/>
              </div>
              <div>
                <div style={{fontSize:11, color:'var(--muted)', marginBottom:2}}>Slot</div>
                <input className="btn" style={{width:'100%'}} value={editor.slot} onChange={e=>setEditor(s=>({...s, slot:e.target.value}))}/>
              </div>
              <div style={{gridColumn:'1/-1', display:'flex', justifyContent:'flex-end', gap:6}}>
                <button className="mini" onClick={closeAll}>Cancel</button>
                <button className="mini" onClick={saveEditor}>Create & Move</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* BULK editor modal */}
      {bulk.open && (
        <div className="ctx-menu tight" style={{ left:'50%', top:'14%', transform:'translateX(-50%)', width:560 }}>
          <div style={{fontWeight:800, margin:'0 6px 8px'}}>Bulk edit</div>

          <div style={{display:'grid', gap:8, padding:'0 6px 6px'}}>
            {/* Field selector */}
            <div>
              <div style={{fontSize:12, color:'var(--muted)', marginBottom:2}}>Field</div>
              <select className="btn" value={bulk.field} onChange={e=>{
                const field = e.target.value
                const op = field==='system' ? 'add' : (field==='location' ? 'move' : 'set')
                setBulk(s=>({...s, field, op}))
              }}>
                <option value="system">System (tags)</option>
                <option value="supplier">Supplier</option>
                <option value="category">Category</option>
                <option value="type">Type</option>
                <option value="location">Location</option>
              </select>
            </div>

            {/* Operation */}
            <div>
              <div style={{fontSize:12, color:'var(--muted)', marginBottom:2}}>Operation</div>
              {bulk.field==='system' && (
                <select className="btn" value={bulk.op} onChange={e=>setBulk(s=>({...s, op:e.target.value}))}>
                  <option value="add">Add tags (merge)</option>
                  <option value="remove">Remove tags</option>
                  <option value="replace">Replace (overwrite)</option>
                  <option value="clear">Clear all</option>
                </select>
              )}
              {['supplier','category','type'].includes(bulk.field) && (
                <select className="btn" value={bulk.op} onChange={e=>setBulk(s=>({...s, op:e.target.value}))}>
                  <option value="set">Set value</option>
                  <option value="clear">Clear field</option>
                </select>
              )}
              {bulk.field==='location' && (
                <select className="btn" value={bulk.op} onChange={e=>setBulk(s=>({...s, op:e.target.value}))}>
                  <option value="move">Move to location</option>
                  <option value="clear">Unplace items</option>
                </select>
              )}
            </div>

            {/* Editors per field */}
            {bulk.field==='system' && bulk.op!=='clear' && (
              <>
                <div style={{fontSize:12, color:'var(--muted)'}}>Systems</div>
                <SystemTagsInput
                  value={bulk.systems}
                  onChange={systems=>setBulk(s=>({...s, systems}))}
                  suggestions={allSystems}
                />
                <div style={{fontSize:12, color:'var(--muted)'}}>Tip: choose from suggestions or type a new system and press Enter.</div>
              </>
            )}

            {bulk.field==='supplier' && bulk.op==='set' && (
              <>
                <div style={{fontSize:12, color:'var(--muted)'}}>Supplier</div>
                <input className="btn" list="supplier-suggest" style={{width:'100%'}}
                  value={bulk.supplier} onChange={e=>setBulk(s=>({...s, supplier:e.target.value}))}
                  placeholder="Type supplier (suggested)…"/>
                <datalist id="supplier-suggest">
                  {suppliers.map(s=><option key={s} value={s}/>)}
                </datalist>
              </>
            )}

            {bulk.field==='category' && bulk.op==='set' && (
              <>
                <div style={{fontSize:12, color:'var(--muted)'}}>Category</div>
                <select className="btn" value={bulk.category} onChange={e=>setBulk(s=>({...s, category:e.target.value}))}>
                  <option value="">—</option>
                  {categoryOptions.map(c=><option key={c} value={c}>{titleCase(c)}</option>)}
                </select>
              </>
            )}

            {bulk.field==='type' && bulk.op==='set' && (
              <>
                <div style={{fontSize:12, color:'var(--muted)'}}>Type</div>
                <input className="btn" list="type-suggest" style={{width:'100%'}}
                  value={bulk.type} onChange={e=>setBulk(s=>({...s, type:e.target.value}))}
                  placeholder="e.g., Consumable"/>
                <datalist id="type-suggest">
                  {typeOptions.map(t=><option key={t} value={titleCase(t)}/>)}
                </datalist>
                <div style={{fontSize:12, color:'var(--muted)'}}>Tip: free text allowed; we’ll match to the closest known type.</div>
              </>
            )}

            {bulk.field==='location' && bulk.op!=='clear' && (
              <div style={{display:'grid', gap:8}}>
                <div className="seg" style={{width:'fit-content'}}>
                  <button className={!bulk.createStorage?'active':''}
                          onClick={()=>setBulk(s=>({...s, createStorage:false}))}>Use existing</button>
                  <button className={bulk.createStorage?'active':''}
                          onClick={()=>setBulk(s=>({...s, createStorage:true}))}>Create new</button>
                </div>

                {!bulk.createStorage ? (
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                    <div>
                      <div style={{fontSize:12,color:'var(--muted)'}}>Room</div>
                      <select className="btn" style={{width:'100%'}} value={bulk.room}
                        onChange={e=>{
                          const room=e.target.value
                          const first=storagesIn(room)[0]?.id || ''
                          setBulk(s=>({...s, room, storageId:first}))
                        }}>
                        <option value="">—</option>
                        {roomOptions.map(r=><option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:12,color:'var(--muted)'}}>Storage</div>
                      <select className="btn" style={{width:'100%'}} value={bulk.storageId}
                        onChange={e=>setBulk(s=>({...s, storageId:e.target.value}))} disabled={!bulk.room}>
                        <option value="">—</option>
                        {storagesIn(bulk.room).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                    <div>
                      <div style={{fontSize:12,color:'var(--muted)'}}>Room</div>
                      <input className="btn" list="room-suggest" style={{width:'100%'}}
                        value={bulk.room} onChange={e=>setBulk(s=>({...s, room:e.target.value}))}
                        placeholder="Type room (or pick)"/>
                      <datalist id="room-suggest">
                        {roomOptions.map(r=><option key={r} value={r}/>)}
                      </datalist>
                    </div>
                    <div>
                      <div style={{fontSize:12,color:'var(--muted)'}}>New storage name</div>
                      <input className="btn" style={{width:'100%'}}
                        value={bulk.newStorageName} onChange={e=>setBulk(s=>({...s, newStorageName:e.target.value}))}
                        placeholder="e.g., Cupboard A"/>
                    </div>
                  </div>
                )}

                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8}}>
                  <div>
                    <div style={{fontSize:12,color:'var(--muted)'}}>Drawer/Layer</div>
                    <input className="btn" style={{width:'100%'}}
                      value={bulk.drawer} onChange={e=>setBulk(s=>({...s, drawer:e.target.value}))}/>
                  </div>
                  <div>
                    <div style={{fontSize:12,color:'var(--muted)'}}>Slot</div>
                    <input className="btn" style={{width:'100%'}}
                      value={bulk.slot} onChange={e=>setBulk(s=>({...s, slot:e.target.value}))}/>
                  </div>
                </div>
              </div>
            )}
          </div>

          
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 6px 6px'}}>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <button
                className="mini"
                onClick={bulkDeleteSelected}
                disabled={!selected.size || deletingBulk}
                title="Delete all selected items"
                style={{ background:'#fee2e2', border:'1px solid #fecaca', color:'#b91c1c' }}
              >
                {deletingBulk ? 'Deleting…' : `🗑 Delete selected (${selected.size})`}
              </button>
              <div style={{fontSize:12, color:'var(--muted)'}}>Tip: we’ll auto-match spelling to your existing values.</div>
            </div>
            <div style={{display:'flex', gap:6}}>
              <button className="mini" onClick={()=>setBulk(s=>({ ...s, open:false }))}>Cancel</button>
              <button className="mini" onClick={applyBulk}>Apply to {selected.size} item(s)</button>
            </div>
          </div>

        </div>
      )}

      {/* mapping modal */}
      {mapModal.open && (
        <div className="ctx-menu" style={{ left:'50%', top:'8%', transform:'translateX(-50%)', width:720 }}>
          <div style={{fontWeight:800, marginBottom:8}}>Map columns from the uploaded file</div>

          <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8, marginBottom:8}}>
            {TARGET_FIELDS.filter(f=>f.key!=='description').map(f=>(
              <div key={f.key} style={{display:'grid', gap:6}}>
                <div style={{fontSize:12, color:'var(--muted)'}}>{f.label}{f.required?' *':''}</div>
                <select className="btn" value={mapModal.map[f.key] ?? ''} onChange={e=>{
                  const v = e.target.value==='' ? undefined : Number(e.target.value)
                  setMapModal(s=>({ ...s, map:{ ...s.map, [f.key]: (v===undefined?undefined:v) } }))
                }}>
                  <option value="">— Not used —</option>
                  {mapModal.headers.map((h,i)=><option key={i} value={i}>{h||`Column ${i+1}`}</option>)}
                </select>
              </div>
            ))}
          </div>

          <label style={{display:'flex', alignItems:'center', gap:8}}>
            <input type="checkbox" checked={mapModal.descOnly} onChange={e=>setMapModal(s=>({...s, descOnly:e.target.checked}))}/>
            <span>Vendor gives <b>Description</b> only (use as Product Description)</span>
          </label>

          <div style={{borderTop:'1px dashed #cfd4dc', paddingTop:8, marginTop:8, fontSize:12}}>
            <div style={{marginBottom:6, color:'var(--muted)'}}>Preview (first 5 rows)</div>
            <div style={{maxHeight:160, overflow:'auto', border:'1px dashed #cfd4dc', borderRadius:8, padding:8}}>
              <table className="sheet-style" style={{fontSize:12}}>
                <thead><tr>{mapModal.headers.map((h,i)=><th key={i}>{h||`Col ${i+1}`}</th>)}</tr></thead>
                <tbody>
                  {mapModal.rows.slice(0,5).map((r,ri)=>(<tr key={ri}>{mapModal.headers.map((_,ci)=><td key={ci}>{clean(r[ci])}</td>)}</tr>))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:10}}>
            <button className="mini" onClick={()=>setMapModal(s=>({...s, open:false}))}>Cancel</button>
            <button className="mini" onClick={async()=>{
              if (mapModal.map.sku==null) { alert('SKU is required.'); return }
              const normalized = buildRowsFromMapping(mapModal.headers, mapModal.rows, mapModal.map, mapModal.descOnly)
              if (!normalized.length){ alert('No valid rows after mapping.'); return }
              try{
                setMapModal(s=>({...s, open:false})); setImporting(true)
                await importRows(normalized)
                alert('Import complete.')
              } catch(e){ console.error(e); alert('Import failed. See console.') }
              finally { setImporting(false) }
            }}>Import {mapModal.rows.length} rows</button>
          </div>
        </div>
      )}
    </>
  )
}
