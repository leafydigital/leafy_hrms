import { useEffect } from 'react'
import bodyHtml from './website.body.html?raw'
import legacy1 from './scripts/legacy-1.js?raw'
import legacy2 from './scripts/legacy-2.js?raw'
import './website.css'

/**
 * The marketing site (leafydigital.in). Ported from the original static index.html:
 * markup lives in website.body.html, styles in website.css, behaviour (showPage, modals,
 * contact form, cursor) in scripts/. It can be converted into React components section by
 * section later; until then this wrapper keeps the look and behaviour identical.
 */
export default function Website() {
  useEffect(() => {
    if (window.__leafySiteBooted) return // StrictMode / hot-reload safety: run the page scripts once
    window.__leafySiteBooted = true

    // The scripts expect to run while the page is still loading; the DOM is already ready here,
    // so DOMContentLoaded / load handlers are run straight away instead of waiting.
    const origDoc = document.addEventListener.bind(document)
    const origWin = window.addEventListener.bind(window)
    document.addEventListener = (type, fn, opts) => (type === 'DOMContentLoaded' ? fn(new Event(type)) : origDoc(type, fn, opts))
    window.addEventListener = (type, fn, opts) => (type === 'load' ? fn(new Event(type)) : origWin(type, fn, opts))
    try {
      for (const code of [legacy1, legacy2]) {
        const s = document.createElement('script') // classic script => functions become globals for the inline onclick handlers
        s.text = code
        document.body.appendChild(s)
      }
    } finally {
      document.addEventListener = origDoc
      window.addEventListener = origWin
    }
  }, [])

  return <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
}
