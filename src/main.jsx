import React from 'react'
import ReactDOM from 'react-dom/client'

// Path decides which app to load. Each app is its own lazy chunk (and brings its own CSS),
// so visitors to the website never download the HRMS, and vice versa.
const root = document.getElementById('root')
const path = window.location.pathname
const isHrms = path === '/hrms' || path.startsWith('/hrms/')

if (isHrms) {
  import('./hrms/HrmsApp.jsx').then(({ default: HrmsApp }) => {
    ReactDOM.createRoot(root).render(<React.StrictMode><HrmsApp /></React.StrictMode>)
  })
} else {
  import('./website/Website.jsx').then(({ default: Website }) => {
    ReactDOM.createRoot(root).render(<Website />)
  })
}
