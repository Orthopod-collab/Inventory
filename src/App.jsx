import React, { useMemo, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import Register from './panels/Register.jsx'
import Inventory from './panels/Inventory.jsx'
import StorageMap from './panels/StorageMap.jsx'
import History from './panels/History.jsx'
import Orders from './panels/Orders.jsx'
import Received from './panels/Received.jsx'
import Labels from './panels/Labels.jsx'
import { useAppData } from './hooks.js'

export default function App(){
  const [active,setActive] = useState('register')
  const { rooms, storages, items, activities } = useAppData()

  const topTitle = useMemo(()=>{
    const map = {register:'Register', inventory:'Inventory', storage:'Storage Map', orders:'Orders', received:'Received', history:'History', labels:'QR & Labels'}
    return map[active]
  }, [active])

  return (
    <div className="app">
      <Sidebar active={active} setActive={setActive} />
      <div>
        <header className="top">
          <div className="top-title">{topTitle}</div>
          <div className="badge">RLH Trauma and Orthopaedic Theatres Inventory Manager</div>
        </header>
        <main>
          <section className={`panel card ${active==='register'?'active':''}`}>
            <Register items={items} storages={storages} rooms={rooms} onJump={()=>setActive('inventory')} />
          </section>
          <section className={`panel card ${active==='inventory'?'active':''}`}>
            <Inventory items={items} storages={storages} setActive={setActive} />
          </section>
          <section className={`panel card ${active==='storage'?'active':''}`}>
            <StorageMap items={items} rooms={rooms} storages={storages} />
          </section>
          <section className={`panel card ${active==='history'?'active':''}`}>
            <History activities={activities} />
          </section>
          <section className={`panel card ${active==='orders'?'active':''}`}>
            <Orders />
          </section>
          <section className={`panel card ${active==='received'?'active':''}`}>
            <Received />
          </section>
          <section className={`panel card ${active==='labels'?'active':''}`}>
            <Labels />
          </section>
        </main>
      </div>
    </div>
  )
}
