import React from 'react'

const icons = {
  register: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M3 17.25V21h3.75L18.81 8.94l-3.75-3.75L3 17.25Z" stroke="currentColor" strokeWidth="1.6"/><path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.59 1.59 3.75 3.75 1.59-1.59Z" fill="currentColor"/></svg>),
  inventory: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 19V5" stroke="currentColor" strokeWidth="1.6"/><path d="M8 19v-7" stroke="currentColor" strokeWidth="1.6"/><path d="M12 19V8" stroke="currentColor" strokeWidth="1.6"/><path d="M16 19V4" stroke="currentColor" strokeWidth="1.6"/><path d="M20 19V11" stroke="currentColor" strokeWidth="1.6"/></svg>),
  storage: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/></svg>),
  orders: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M3 4h2l2.5 12h10.5l2-8H7" stroke="currentColor" strokeWidth="1.6"/><circle cx="10" cy="20" r="1.5" fill="currentColor"/><circle cx="18" cy="20" r="1.5" fill="currentColor"/></svg>),
  received: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M3 14h5l2 3h4l2-3h5" stroke="currentColor" strokeWidth="1.6"/></svg>),
  history: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="currentColor" strokeWidth="1.7" fill="none"/></svg>),
  labels: (<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6"/><path d="M14 14h7v7h-7v-3h3v-2h-3v-2Z" stroke="currentColor" strokeWidth="1.6"/></svg>),
}

export default function Sidebar({active, setActive}){
  const tabs = [
    ['register','Register'],
    ['inventory','Inventory'],
    ['storage','Storage Map'],
    ['orders','Orders'],
    ['received','Received'],
    ['history','History'],
    ['labels','QR & Labels'],
  ]
  return (
    <aside className="side">
      <div className="logo">RLH</div>
      {tabs.map(([key,label])=>(
        <button key={key} className={`icon-btn ${active===key?'active':''}`} onClick={()=>setActive(key)} title={label}>
          {icons[key]}
          <span className="label">{label}</span>
        </button>
      ))}
      <div className="spacer" />
    </aside>
  )
}
