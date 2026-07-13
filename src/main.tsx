import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// StrictMode intentionally omitted — it double-fires effects in dev, which causes
// the bootstrap effect in useBrowser to create two "New Tab" tabs on startup.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
