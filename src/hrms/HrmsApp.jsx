import { useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/useAuth'
import { ToastProvider } from './components/ui'
import './index.css'

// The root index.html belongs to the website, so the HRMS sets its own head tags here.
function setHead() {
  document.title = 'Leafy Digital HRMS'
  const add = (tag, attrs) => {
    const el = document.createElement(tag)
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
    document.head.appendChild(el)
  }
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="canonical"], meta[name="description"], meta[name="keywords"]').forEach((e) => e.remove())
  document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]').forEach((e) => e.remove())
  add('link', { rel: 'icon', type: 'image/png', href: `${__HRMS_BASE__}/favicon.png` })
  add('link', { rel: 'manifest', href: `${__HRMS_BASE__}/manifest.webmanifest` })
  add('link', { rel: 'apple-touch-icon', href: `${__HRMS_BASE__}/apple-touch-icon.png` })
  add('meta', { name: 'robots', content: 'noindex, nofollow' })
  add('meta', { name: 'apple-mobile-web-app-title', content: 'Leafy HRMS' })
  add('link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' })
  add('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' })
  const theme = document.querySelector('meta[name="theme-color"]')
  if (theme) theme.setAttribute('content', '#0b0f0a')
}
setHead()

export default function HrmsApp() {
  useEffect(() => { document.getElementById('root')?.setAttribute('data-app', 'hrms') }, [])
  return (
    <BrowserRouter basename={__HRMS_BASE__}>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
