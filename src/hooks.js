import { useEffect, useState, useMemo } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from './firebase'

export function useColl(name, opts={}){
  const [docs,setDocs] = useState([])
  useEffect(()=>{
    const q = opts.orderBy ? query(collection(db, name), orderBy(...opts.orderBy)) : collection(db, name)
    const unsub = onSnapshot(q, snap => setDocs(snap.docs.map(d=>({id:d.id, ...d.data()}))))
    return () => unsub()
  }, [name, JSON.stringify(opts)])
  return docs
}

export function useAppData(){
  const rooms = useColl('rooms')
  const storages = useColl('storages')
  const items = useColl('items')
  const activities = useColl('activities', { orderBy: ['createdAt','desc'] })
  return { rooms, storages, items, activities }
}

export function tsToStr(ts){
  try{
    return ts?.toDate ? ts.toDate().toLocaleString() : ''
  }catch{ return '' }
}

export function level(it){
  const qty = +it.qty || 0, mn = +it.min || 0, mx = +it.max || 0
  if(qty < mn) return 'below'
  if(mx>0 && qty > mx) return 'over'
  return 'ok'
}
