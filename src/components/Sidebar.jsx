// Sidebar.jsx
import React from 'react'

/** Icon set (same visuals for desktop + mobile) */
const icons = {
  register: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* document */}
      <path d="M7 3h6l4 4v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
            stroke="currentColor" strokeWidth="1.6" fill="none"/>
      <path d="M13 3v5h5" stroke="currentColor" strokeWidth="1.6" fill="none"/>
      {/* plus badge */}
      <circle cx="17.5" cy="17.5" r="3.25" fill="currentColor" />
      <path d="M17.5 15.7v3.6M15.7 17.5h3.6"
            stroke="#0b1224" strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  ),
  inventory: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 19V5M8 19v-7M12 19V8M16 19V4M20 19V11"
            stroke="currentColor" strokeWidth="1.6"/>
    </svg>
  ),
  storage: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6"/>
    </svg>
  ),
  orders: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 4h2l2.5 12h10.5l2-8H7" stroke="currentColor" strokeWidth="1.6"/>
      <circle cx="10" cy="20" r="1.5" fill="currentColor"/>
      <circle cx="18" cy="20" r="1.5" fill="currentColor"/>
    </svg>
  ),
  received: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M3 14h5l2 3h4l2-3h5" stroke="currentColor" strokeWidth="1.6"/>
    </svg>
  ),
  history: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="currentColor" strokeWidth="1.7" fill="none"/>
    </svg>
  ),
  labels: (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="14" y="3" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6"/>
      <rect x="3" y="14" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M14 14h7v7h-7v-3h3v-2h-3v-2Z" stroke="currentColor" strokeWidth="1.6"/>
    </svg>
  ),
}

export default function Sidebar({ active, setActive }) {
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
    <>
      {/* Desktop left rail (unchanged) */}
      <aside className="side">
        <div className="logo">RLH</div>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={`icon-btn ${active===key?'active':''}`}
            onClick={() => setActive(key)}
            title={label}
            aria-label={label}
          >
            {icons[key]}
            <span className="label">{label}</span>
          </button>
        ))}
        <div className="spacer" />
      </aside>

      {/* Mobile bottom bar — icons only, same dark bg as sidebar */}
      <nav className="bottom-nav">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            className={`bottom-item ${active===key?'active':''}`}
            onClick={() => setActive(key)}
            aria-label={label}
            title={label}
          >
            {icons[key]}
          </button>
        ))}
      </nav>
    </>
  )
}
