import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/figmaTokens.css'
import './index.css'
import App from './App.jsx'

// Firebase OAuth domain safety:
// If app is opened via 127.0.0.1, force localhost to match common authorized-domain setup.
if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
  const normalized = new URL(window.location.href)
  normalized.hostname = 'localhost'
  window.location.replace(normalized.toString())
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
