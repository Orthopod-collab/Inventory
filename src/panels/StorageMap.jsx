import React, {
  useEffect, useMemo, useRef, useState, useLayoutEffect
} from 'react';
import {
  addDoc, collection, doc, serverTimestamp, setDoc, updateDoc, writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';

/* ---------- Shared helpers ---------- */
const clean = v => String(v ?? '').trim();
const titleCase = s => String(s||'').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const UNPLACED = '__unplaced__';
const safeId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;

/* drawers = letters helper */
const isAlpha = s => /^[A-Z]+$/.test(s);
const incAlpha = (s='')=>{
  if (!s) return 'A';
  let carry = 1, out = '';
  for (let i=s.length-1;i>=0;i--){
    const code = s.charCodeAt(i) - 65 + carry;
    if (code >= 26){ out = 'A' + out; carry = 1; }
    else { out = String.fromCharCode(65+code) + out; carry = 0; }
  }
  if (carry) out = 'A' + out;
  return out;
};
const nextDrawerLabelFrom = (labels=[])=>{
  const alphas = labels.map(String).map(s=>s.toUpperCase()).filter(isAlpha);
  if (!alphas.length) return 'A';
  alphas.sort((a,b)=> a.length - b.length || a.localeCompare(b));
  return incAlpha(alphas[alphas.length-1]);
};

/* normalize drawers utility (used by storages panel + move sheet) */
const normalizeDrawers = (raw) => {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(d => {
    if (typeof d === 'string' || typeof d === 'number') {
      const label = String(d).toUpperCase();
      return { label, defaultPartitions: undefined };
    }
    if (d && typeof d === 'object') {
      const lbl = (d.label ?? d.name ?? '').toString().toUpperCase();
      const parts = Number(d.partitions);
      return {
        label: lbl,
        defaultPartitions: Number.isFinite(parts) && parts > 0 ? parts : undefined
      };
    }
    return { label: String(d).toUpperCase(), defaultPartitions: undefined };
  }).filter(x => x.label);
};

/* ---------- Item card ---------- */
function ItemCard({ it, onTapAssign, isMobile }) {
  const cls = `item-card ${it?.type ? ('type-'+String(it.type).replace(/\s+/g,'_')) : ''}`;
  return (
    <div
      className={cls}
      draggable={!isMobile}
      onDragStart={(e)=>!isMobile && e.dataTransfer.setData('text/plain', JSON.stringify({ id: it.id, name: it.name }))}
      onClick={()=> isMobile && onTapAssign?.(it)}
      title={`${it.sku||''}${it.supplier?(' • '+it.supplier):''}`}
    >
      <div className="ic-name">{it.name}</div>
      <div className="ic-meta">
        <span>{titleCase(it.type || '—')}</span>
        <span>{Math.max(0, +it.qty || 0)} in stock</span>
      </div>
    </div>
  );
}

/* ---------- Unplaced column ---------- */
function UnplacedColumn({ items, query, setQuery, onDropHere, isMobile, onTapAssign }) {
  const list = useMemo(()=>{
    const q = clean(query).toLowerCase();
    const src = items.filter(x => {
      const sid = x?.location?.storage;
      return !sid || sid === UNPLACED;
    });
    if (!q) return src;
    return src.filter(x => {
      const hay = `${x.name} ${x.sku} ${x.supplier} ${x.type}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  return (
    <div className="tri-col tri-mid">
      <div className="band unplaced">UNPLACED</div>

      <div className="sm-toolbar" style={{margin:'8px 0 6px'}}>
        <div className="toolbar" style={{width:'100%'}}>
          <div className="search" style={{flex:1}}>
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5z"/></svg>
            <input placeholder="Search unplaced…" value={query} onChange={e=>setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      <div
        className="unplaced-drop"
        onDragOver={(e)=>!isMobile && e.preventDefault()}
        onDrop={e=>!isMobile && onDropHere(e)}
      >
        {list.map(it => (
          <ItemCard key={it.id} it={it} isMobile={isMobile} onTapAssign={onTapAssign} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Drawer row ---------- */
function DrawerRow({ storage, label, list, partCount, setPartCount, isMobile, onTapAssign }) {
  const sId = storage.id;

  const handleDropTo = (drawer, partIndex) => async (e) => {
    e.preventDefault();
    const payload = e.dataTransfer.getData('text/plain');
    if (!payload) return;
    const data = JSON.parse(payload);
    await updateDoc(doc(db, 'items', data.id), {
      location: { storage: sId, drawer, slot: String(partIndex+1) },
      updatedAt: serverTimestamp()
    });
    await addDoc(collection(db,'activities'),{
      type:'Move Item',
      details:`${data.name} → ${storage.name} / ${drawer} / ${partIndex+1}`,
      createdAt: serverTimestamp()
    });
  };

  return (
    <div className="drawer-section">
      <div className="drawer-row">
        <div className="drawer-label clickable">
          <span>{label}</span>
          <div className="part-controls">
            <button className="mini icon" onClick={()=>setPartCount(Math.max(1, partCount-1))}>−</button>
            <span className="part-count">{partCount}</span>
            <button className="mini icon" onClick={()=>setPartCount(partCount+1)}>＋</button>
          </div>
        </div>

        <div className="partitions" style={{ ['--cols']: partCount }}>
          {Array.from({length:partCount}).map((_,i)=>(
            <div key={i} className="part-col">
              <div className="part-cap">{i+1}</div>
              <div
                className="part-drop"
                onDragOver={(e)=>!isMobile && e.preventDefault()}
                onDrop={e=>!isMobile && handleDropTo(label, i)(e)}
              >
                {list
                  .filter(x => String(x?.location?.slot||'') === String(i+1))
                  .map(it => (
                    <ItemCard
                      key={it.id}
                      it={it}
                      isMobile={isMobile}
                      onTapAssign={onTapAssign}
                    />
                  ))
                }
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Right panel ---------- */
function StoragesPanel({
  storages, items,
  activeStorages, setActiveStorages,
  partCfg, setPartCfg,
  isMobile, onTapAssign
}) {
  const active = activeStorages
    .map(id => storages.find(s => s && s.id === id))
    .filter(Boolean);

  const bannerText = useMemo(() => {
    const locs = Array.from(new Set(active.map(s => s.location).filter(Boolean)));
    if (!locs.length) return 'Select a storage';
    return locs.join(' • ');
  }, [active]);

  const bannerHelper = 'Drag (desktop) or tap to assign (mobile)';
  const itemsByStorage = (sid) => items.filter(x => x?.location?.storage === sid);

  // inner scroll height for desktop
  const innerScrollH = active.length===2 ? 'calc(50vh - 160px)' : 'calc(78vh - 160px)';

  return (
    <div className="tri-col tri-right">
      <div className="loc-banner">
        <div className="loc-title">{bannerText}</div>
        <div className="loc-help">{bannerHelper}</div>
      </div>

      {!active.length && (
        <div style={{padding:'12px', color:'#64748b'}}>Open a storage from the left panel to view drawers/partitions here.</div>
      )}

      <div style={{display:'grid', gridTemplateRows: active.length===2 ? '1fr 12px 1fr' : '1fr', gap:'0'}}>
        {active.map((s, idx) => {
          const drawers = normalizeDrawers(s.drawers);
          const list = itemsByStorage(s.id);

          return (
            <div key={s.id || s.name} className="storage-col" style={{minHeight:0}}>
              <div className="storage-bar" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <div style={{minWidth:0}}>
                  <div className="name" style={{fontWeight:900, fontSize:16, overflow:'hidden', textOverflow:'ellipsis'}}>{s.name}</div>
                  <div className="meta" style={{color:'#64748b', fontSize:12}}>{s.type||'Storage'} • {s.location||'—'}</div>
                </div>
                <div style={{marginLeft:'auto',display:'flex',gap:6}}>
                  <button className="mini" onClick={async ()=>{
                    const cur = normalizeDrawers(s.drawers).map(d=>d.label);
                    const next = nextDrawerLabelFrom(cur);
                    await updateDoc(doc(db,'storages', s.id), { drawers: [...cur, next] });
                    await addDoc(collection(db,'activities'), { type:'Add Drawer', details:`${s.name}: +${next}`, createdAt: serverTimestamp() });
                  }}>+ Drawer</button>
                  <button className="mini danger" onClick={async ()=>{
                    const cur = normalizeDrawers(s.drawers).map(d=>d.label);
                    if (!cur.length){ alert('No drawers to remove'); return; }
                    const last = cur[cur.length-1];
                    if (!confirm(`Remove drawer "${last}" from ${s.name}? Items in ${last} will be moved to Unplaced.`)) return;
                    const batch = writeBatch(db);
                    items
                      .filter(it => it?.location?.storage===s.id && String(it?.location?.drawer||'').toUpperCase()===last)
                      .forEach(it=>{
                        batch.update(doc(db,'items', it.id), {
                          location: { storage:UNPLACED, drawer:null, slot:null },
                          updatedAt: serverTimestamp()
                        });
                      });
                    batch.update(doc(db,'storages', s.id), { drawers: cur.slice(0,-1) });
                    await batch.commit();
                    await addDoc(collection(db,'activities'), { type:'Remove Drawer', details:`${s.name}: -${last}`, createdAt: serverTimestamp() });
                  }}>− Drawer</button>
                  <button className="mini" onClick={()=>setActiveStorages(prev => prev.filter(x => x!==s.id))}>Hide</button>
                </div>
              </div>

              <div className="detail-body" style={{overflowY:'auto', overflowX:'hidden', maxHeight: isMobile ? 'none' : innerScrollH}}>
                {drawers.length ? (
                  <div style={{display:'flex', flexDirection:'column', gap:12}}>
                    {drawers.map(d=>{
                      const key = `${s.id}__${d.label}`;
                      const persisted = +partCfg.get(key);
                      const count = Math.max(1, persisted || d.defaultPartitions || 3);
                      const setCount = (n)=>{
                        const next = new Map(partCfg); next.set(key, n); setPartCfg(next);
                        try{ localStorage.setItem('sm.partitionCounts', JSON.stringify([...next])); }catch{}
                      };
                      const subset = list.filter(x => String(x?.location?.drawer||'').toUpperCase() === d.label);

                      return (
                        <DrawerRow
                          key={d.label}
                          storage={s}
                          label={d.label}
                          list={subset}
                          partCount={count}
                          setPartCount={setCount}
                          isMobile={isMobile}
                          onTapAssign={onTapAssign}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <div className="drawer-section">
                    <div className="drawer-row">
                      <div className="drawer-label clickable"><span>Items</span></div>
                      <div className="unplaced-drop">
                        {list.map(it => (
                          <ItemCard key={it.id} it={it} isMobile={isMobile} onTapAssign={onTapAssign}/>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {idx===0 && active.length===2 && <div style={{height:12}}/>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Left panel ---------- */
function LocationsPanel({
  rooms, storages, items,
  expandedRooms, setExpandedRooms,
  activeStorages, setActiveStorages,
  onCreateRoom, onCreateStorage, onRemoveStorage,
  onRemoveRoom, onMoveStorageToRoom
}) {
  const counts = useMemo(()=>{
    const m = new Map();
    items.forEach(it=>{
      const sid = it?.location?.storage;
      if (sid) m.set(sid, (m.get(sid)||0) + (+it.qty||0));
    });
    return m;
  },[items]);

  const persistExp = (arr)=>{ try{ localStorage.setItem('sm.expandedRooms', JSON.stringify(arr)); }catch{} };
  const persistAct = (arr)=>{ try{ localStorage.setItem('sm.activeStorages', JSON.stringify(arr)); }catch{} };

  const toggleExpand = (roomName) => {
    setExpandedRooms(prev=>{
      const arr = [...prev];
      const ix = arr.indexOf(roomName);
      if (ix>=0){ arr.splice(ix,1); persistExp(arr); return arr; }
      arr.push(roomName);
      while(arr.length>2) arr.shift();
      persistExp(arr);
      return arr;
    });
  };

  const toggleActiveStorage = (id) => {
    setActiveStorages(prev=>{
      const arr = [...prev];
      const ix = arr.indexOf(id);
      if (ix>=0){ arr.splice(ix,1); persistAct(arr); return arr; }
      arr.push(id);
      while(arr.length>2) arr.shift();
      persistAct(arr);
      return arr;
    });
  };

  return (
    <div className="tri-col tri-left">
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', margin:'0 0 8px'}}>
        <div style={{fontWeight:900}}>Locations</div>
        <button className="mini" onClick={onCreateRoom}>+ Add location</button>
      </div>

      {rooms.map(r=>{
        if (!r || !r.name) return null;
        const isOpen = expandedRooms.includes(r.name);
        const inRoom = storages.filter(s => s.location === r.name);
        return (
          <div key={r.name} className={`room ${isOpen?'active':''}`}>
            <header
              onClick={()=>toggleExpand(r.name)}
              onDragOver={(e)=>{ e.preventDefault(); }}
              onDrop={(e)=>{
                e.preventDefault();
                try{
                  const raw = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
                  const data = raw ? JSON.parse(raw) : null;
                  if (data?.kind === 'storage' && data?.id) {
                    onMoveStorageToRoom?.(data.id, r.name);
                  }
                }catch{/* noop */}
              }}
            >
              <div className="bar">
                <div className="title">{r.name}</div>
              </div>
              <div className="actions">
                <span className="count">{inRoom.length} storage</span>
                <button
                  className="mini danger"
                  onClick={(e)=>{ e.stopPropagation(); onRemoveRoom?.(r); }}
                >Remove</button>
              </div>
            </header>

            {isOpen && (
              <div className="list">
                {inRoom
                  .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')))
                  .map(s=>{
                    if (!s) return null;
                    const active = activeStorages.includes(s.id);
                    return (
                      <div key={s.id || s.name}
                           className={`storage-tile ${active?'active':''}`}
                           draggable
                           onDragStart={(e)=>{
                             const payload = JSON.stringify({ kind:'storage', id:s.id, name:s.name });
                             e.dataTransfer.setData('application/json', payload);
                             e.dataTransfer.setData('text/plain', payload);
                           }}
                           onClick={()=>toggleActiveStorage(s.id)}
                      >
                        <div className="name">{s.name}</div>
                        <div className="type">{s.type||'Storage'}</div>
                        <span className="count">{counts.get(s.id)||0}</span>

                        <button
                          className="mini danger"
                          style={{position:'absolute',right:8,bottom:8}}
                          onClick={(e)=>{ e.stopPropagation(); onRemoveStorage(s); }}
                        >Remove</button>
                      </div>
                    );
                  })}

                <button className="add-storage" onClick={()=>onCreateStorage(r.name)}>+ New storage</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Mobile-only tabs ---------- */
function MobileTabs({ view, setView }) {
  return (
    <div className="mobile-tabs">
      <button className={view==='left' ? 'on' : ''} onClick={()=>setView('left')}>Locations</button>
      <button className={view==='mid'  ? 'on' : ''} onClick={()=>setView('mid')}>Unplaced</button>
      <button className={view==='right'? 'on' : ''} onClick={()=>setView('right')}>Storages</button>
    </div>
  );
}

/* ---------- Tap-to-Assign sheet (mobile) ---------- */
function MoveSheet({ open, onClose, item, storages, partCfg, onAssign }) {
  const [storageId, setStorageId] = useState('');
  const [drawer, setDrawer] = useState('');
  const [slot, setSlot] = useState('1');

  useEffect(()=>{ if(open){ setStorageId(''); setDrawer(''); setSlot('1'); }},[open]);

  const currentStorage = storages.find(s => s.id === storageId);
  const drawers = currentStorage ? normalizeDrawers(currentStorage.drawers) : [];
  const slotsCount = (() => {
    if (!currentStorage || !drawer) return 1;
    const key = `${currentStorage.id}__${drawer}`;
    const persisted = Number(partCfg.get(key));
    const def = drawers.find(d=>d.label===drawer)?.defaultPartitions;
    return Math.max(1, persisted || def || 3);
  })();

  if (!open) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()}>
        <div className="sheet-head">
          <div className="sheet-title">Move item</div>
          <div className="sheet-sub">{item?.name}</div>
        </div>

        <div className="field">
          <label>Storage</label>
          <select value={storageId} onChange={e=>{ setStorageId(e.target.value); setDrawer(''); setSlot('1'); }}>
            <option value="">— Select storage —</option>
            {storages
              .slice()
              .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')))
              .map(s=>(
                <option key={s.id} value={s.id}>{s.name} • {s.location||'—'}</option>
              ))}
          </select>
        </div>

        <div className="row">
          <div className="field">
            <label>Drawer</label>
            <select value={drawer} onChange={e=>{ setDrawer(e.target.value); setSlot('1'); }} disabled={!storageId}>
              <option value="">—</option>
              {drawers.map(d=> <option key={d.label} value={d.label}>{d.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Slot</label>
            <select value={slot} onChange={e=>setSlot(e.target.value)} disabled={!drawer}>
              {Array.from({length: slotsCount}).map((_,i)=>(
                <option key={i+1} value={String(i+1)}>{i+1}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!storageId}
            onClick={()=> onAssign({ storageId, drawer: drawer || null, slot: drawer ? slot : null })}
          >Assign</button>
        </div>
      </div>
    </div>
  );
}

/* ====================== MAIN ====================== */
export default function StorageMap({ items=[], rooms=[], storages=[] }) {
  const [leftW, setLeftW] = useState(()=> Number(localStorage.getItem('sm.leftW')||300));
  const [midW,  setMidW]  = useState(()=> Number(localStorage.getItem('sm.midW') ||520));

  const [expandedRooms, setExpandedRooms] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem('sm.expandedRooms')||'[]'); }catch{return [];}
  });
  const [activeStorages, setActiveStorages] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem('sm.activeStorages')||'[]'); }catch{return [];}
  });

  const [partCfg, setPartCfg] = useState(()=>{
    try{
      const raw = JSON.parse(localStorage.getItem('sm.partitionCounts')||'[]');
      return new Map(Array.isArray(raw) ? raw : []);
    }catch{ return new Map(); }
  });

  const [unplacedQ, setUnplacedQ] = useState('');

  const dragRef = useRef({ dragging:null, startX:0, orig:0 });
  useEffect(()=>{
    const onMove = (e)=>{
      const d = dragRef.current;
      if (!d.dragging) return;
      const dx = e.clientX - d.startX;
      if (d.dragging==='left'){
        const w = Math.max(240, Math.min(520, d.orig + dx)); setLeftW(w); localStorage.setItem('sm.leftW', w);
      }
      if (d.dragging==='mid'){
        const w = Math.max(380, Math.min(780, d.orig + dx)); setMidW(w);  localStorage.setItem('sm.midW',  w);
      }
    };
    const onUp = ()=>{ dragRef.current.dragging=null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return ()=>{ window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  },[]);

  async function onCreateRoom(){
    const name = prompt('New location name?'); if(!name) return;
    const n = clean(name);
    await addDoc(collection(db,'rooms'), { name:n, createdAt: serverTimestamp() });
    await addDoc(collection(db,'activities'), { type:'Add Room', details:n, createdAt: serverTimestamp() });
  }

  async function onCreateStorage(roomName){
    const name = prompt('Storage name?'); if(!name) return;
    const type = prompt('Type? (e.g., Gratnell, Cupboard, Shelf)','Gratnell') || 'Storage';
    const drawersStr = prompt('Drawers/Layers (letters, comma-separated: A,B,C)', 'A,B,C');
    const drawers = clean(drawersStr).split(',').map(s=>clean(s).toUpperCase()).filter(Boolean);
    const id = safeId();
    await setDoc(doc(db,'storages', id), { id, name: clean(name), type: clean(type), location: roomName, drawers });
    await addDoc(collection(db,'activities'), { type:'Add Storage', details:`${name} in ${roomName}`, createdAt: serverTimestamp() });
  }

  async function onRemoveStorage(s){
    if(!confirm(`Remove storage "${s.name}"?\nItems will be moved to Unplaced.`)) return;
    const batch = writeBatch(db);
    items.forEach(it=>{
      if (it?.location?.storage === s.id){
        batch.update(doc(db,'items',it.id), {
          location:{ storage:UNPLACED, drawer:null, slot:null },
          updatedAt: serverTimestamp()
        });
      }
    });
    batch.delete(doc(db,'storages', s.id));
    await batch.commit();
    await addDoc(collection(db,'activities'), { type:'Remove Storage', details:s.name, createdAt: serverTimestamp() });
    setActiveStorages(prev => prev.filter(x => x!==s.id));
  }

  // NEW: remove a room/location (cascade storages->delete, items->Unplaced)
  async function onRemoveRoom(room){
    const roomName = room?.name || '';
    if (!roomName) return;
    if (!confirm(`Remove location "${roomName}"?\nAll its storages will be deleted and items moved to Unplaced.`)) return;

    const roomId = room.id || (rooms.find(r => r?.name === roomName)?.id);

    const batch = writeBatch(db);

    // For each storage under this room: move items to Unplaced, delete storage
    storages
      .filter(s => s?.location === roomName)
      .forEach(s => {
        items
          .filter(it => it?.location?.storage === s.id)
          .forEach(it => {
            batch.update(doc(db, 'items', it.id), {
              location: { storage: UNPLACED, drawer: null, slot: null },
              updatedAt: serverTimestamp(),
            });
          });
        batch.delete(doc(db, 'storages', s.id));
      });

    if (roomId) {
      batch.delete(doc(db, 'rooms', roomId));
    }

    await batch.commit();

    await addDoc(collection(db, 'activities'), {
      type: 'Remove Room',
      details: roomName,
      createdAt: serverTimestamp(),
    });

    // Hide any active storages that belonged to this room
    setActiveStorages(prev => prev.filter(id => !storages.find(s => s.id === id && s.location === roomName)));
  }

  // NEW: move a storage between rooms
  async function onMoveStorageToRoom(storageId, targetRoomName){
    const s = storages.find(x => x.id === storageId);
    if (!s || !targetRoomName || s.location === targetRoomName) return;
    await updateDoc(doc(db,'storages', storageId), { location: targetRoomName });
    await addDoc(collection(db,'activities'), {
      type:'Move Storage',
      details:`${s.name} → ${targetRoomName}`,
      createdAt: serverTimestamp()
    });
  }

  const dropUnplaced = async (e) => {
    const payload = e.dataTransfer.getData('text/plain');
    if (!payload) return;
    const data = JSON.parse(payload);
    await updateDoc(doc(db,'items', data.id), {
      location: { storage: UNPLACED, drawer: null, slot: null },
      updatedAt: serverTimestamp()
    });
    await addDoc(collection(db,'activities'),{
      type:'Move Item', details:`${data.name} → Unplaced`, createdAt: serverTimestamp()
    });
  };

  /* Mobile detection (<=900px) */
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
  );
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 900px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener?.('change', onChange);
    mq.addListener?.(onChange);
    return () => {
      mq.removeEventListener?.('change', onChange);
      mq.removeListener?.(onChange);
    };
  }, []);

  /* Mobile tabs: which panel is visible */
  const [mobileView, setMobileView] = useState('mid'); // 'left' | 'mid' | 'right'

  /* Tap-to-assign sheet */
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetItem, setSheetItem] = useState(null);
  const openAssign = (it)=>{ setSheetItem(it); setSheetOpen(true); };
  const doAssign = async ({ storageId, drawer, slot }) => {
    await updateDoc(doc(db,'items', sheetItem.id), {
      location: { storage: storageId, drawer, slot },
      updatedAt: serverTimestamp()
    });
    await addDoc(collection(db,'activities'),{
      type:'Move Item',
      details:`${sheetItem.name} → ${storages.find(s=>s.id===storageId)?.name || 'Storage'}${drawer?` / ${drawer}`:''}${slot?` / ${slot}`:''}`,
      createdAt: serverTimestamp()
    });
    setSheetOpen(false);
    setSheetItem(null);
  };

  return (
    <div
      className={`tri-wrap ${isMobile ? 'mobile' : 'desktop'}`}
      style={{ '--leftW': `${leftW}px`, '--midW': `${midW}px` }}
    >
      {isMobile && <MobileTabs view={mobileView} setView={setMobileView} />}

      {( !isMobile || mobileView==='left') && (
        <>
          <LocationsPanel
            rooms={rooms}
            storages={storages}
            items={items}
            expandedRooms={expandedRooms}
            setExpandedRooms={setExpandedRooms}
            activeStorages={activeStorages}
            setActiveStorages={setActiveStorages}
            onCreateRoom={onCreateRoom}
            onCreateStorage={onCreateStorage}
            onRemoveStorage={onRemoveStorage}
            onRemoveRoom={onRemoveRoom}                      {/* NEW */}
            onMoveStorageToRoom={onMoveStorageToRoom}        {/* NEW */}
          />
          {!isMobile && (
            <div className="v-sizer"
                 onMouseDown={e=>{ dragRef.current={dragging:'left', startX:e.clientX, orig:leftW}; }} />
          )}
        </>
      )}

      {( !isMobile || mobileView==='mid') && (
        <UnplacedColumn
          items={items}
          query={unplacedQ}
          setQuery={setUnplacedQ}
          onDropHere={dropUnplaced}
          isMobile={isMobile}
          onTapAssign={openAssign}
        />
      )}

      {( !isMobile || mobileView==='right') && (
        <>
          {!isMobile && (
            <div className="v-sizer"
                 onMouseDown={e=>{ dragRef.current={dragging:'mid', startX:e.clientX, orig:midW}; }} />
          )}
          <StoragesPanel
            storages={storages}
            items={items}
            activeStorages={activeStorages}
            setActiveStorages={setActiveStorages}
            partCfg={partCfg}
            setPartCfg={setPartCfg}
            isMobile={isMobile}
            onTapAssign={openAssign}
          />
        </>
      )}

      <MoveSheet
        open={sheetOpen}
        onClose={()=>setSheetOpen(false)}
        item={sheetItem}
        storages={storages}
        partCfg={partCfg}
        onAssign={doAssign}
      />
    </div>
  );
}
