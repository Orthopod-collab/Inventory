// TopBar.jsx
import React from 'react'

/** Persist org name in localStorage for now (can swap to Firestore later) */
function useOrgName() {
  const [name, setName] = React.useState(
    () => localStorage.getItem('orgName') || 'Your Hospital'
  )
  React.useEffect(() => {
    const handler = () => setName(localStorage.getItem('orgName') || 'Your Hospital')
    window.addEventListener('orgNameChanged', handler)
    return () => window.removeEventListener('orgNameChanged', handler)
  }, [])
  return name
}

/** Top gradient banner with dynamic org name */
export default function TopBar({ page }) {
  const orgName = useOrgName()
  return (
    <header className="top">
      <div className="top-title">
        {orgName} Resource Management System
      </div>
      {/* optional: show current page at far left, like your old "Register" label */}
      {page && <span className="badge" style={{marginLeft: 'auto'}}>{page}</span>}
    </header>
  )
}

/** Helper you can call from a Settings screen later */
export function setOrgName(newName){
  localStorage.setItem('orgName', newName || 'Your Hospital')
  window.dispatchEvent(new Event('orgNameChanged'))
}
