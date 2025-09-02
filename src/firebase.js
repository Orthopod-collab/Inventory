import { initializeApp } from 'firebase/app'
import { getAnalytics } from 'firebase/analytics'
import { getFirestore } from 'firebase/firestore'

// Default to the config from your HTML prototype (feel free to edit)
export const firebaseConfig = {
  apiKey: 'AIzaSyB0w25u3Ys1SyE2Xm0waLHNlUcqOKbQdIw',
  authDomain: 'inventory-67ceb.firebaseapp.com',
  projectId: 'inventory-67ceb',
  storageBucket: 'inventory-67ceb.firebasestorage.app',
  messagingSenderId: '1031351285804',
  appId: '1:1031351285804:web:cee68e7047fc8ef76c7989',
  measurementId: 'G-C5G29GW4PZ'
}

const app = initializeApp(firebaseConfig)
try { getAnalytics(app) } catch (_) {}

export const db = getFirestore(app)
