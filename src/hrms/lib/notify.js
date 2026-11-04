// Browser notifications + the HRMS notification sound.
// Desktop/phone notifications go through the service worker (public/sw.js) because Android Chrome
// and installed iOS web apps only allow ServiceWorkerRegistration.showNotification().

let audioCtx = null
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    audioCtx = new AC()
  }
  return audioCtx
}

// Browsers only allow sound after the user has interacted with the page once.
export function unlockAudio() {
  const c = ctx()
  if (c && c.state === 'suspended') c.resume().catch(() => {})
}
if (typeof window !== 'undefined') {
  const once = () => { unlockAudio(); window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once) }
  window.addEventListener('pointerdown', once)
  window.addEventListener('keydown', once)
}

/**
 * The "Leafy chime": a quick rising three-note pluck (E6 → B6 → E7) with a soft tail.
 * Generated with Web Audio so there is no sound file to host, and it is distinct from Slack/Teams.
 */
export function playChime(kind = 'message') {
  const c = ctx()
  if (!c || c.state !== 'running') return
  const notes = kind === 'notice' ? [659.25, 987.77, 1318.51, 987.77] : [1318.51, 1975.53, 2637.02]
  const start = c.currentTime + 0.01
  const master = c.createGain()
  master.gain.value = 0.18
  master.connect(c.destination)
  notes.forEach((freq, i) => {
    const t = start + i * 0.085
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = i === notes.length - 1 ? 'sine' : 'triangle'
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(1, t + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (i === notes.length - 1 ? 0.45 : 0.16))
    osc.connect(gain).connect(master)
    osc.start(t)
    osc.stop(t + 0.5)
  })
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window

export const notificationPermission = () => (notificationsSupported() ? Notification.permission : 'unsupported')

let swReg = null
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    swReg = await navigator.serviceWorker.register(`${__HRMS_BASE__}/sw.js`, { scope: `${__HRMS_BASE__}/` })
    return swReg
  } catch (e) {
    console.warn('Service worker registration failed', e)
    return null
  }
}

/** Must be called from a click (Safari/iOS require a user gesture). */
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  unlockAudio()
  const result = await Notification.requestPermission()
  if (result === 'granted') await registerServiceWorker()
  return result
}

/** Shows an OS notification when the app is in the background. */
export async function showSystemNotification({ title, body, link, tag }) {
  if (notificationPermission() !== 'granted') return
  if (document.visibilityState === 'visible' && document.hasFocus()) return // the in-app popup is enough
  const options = { body, tag, icon: `${__HRMS_BASE__}/favicon.png`, badge: `${__HRMS_BASE__}/favicon.png`, data: { link: link || '/' }, renotify: !!tag }
  try {
    const reg = swReg || (await navigator.serviceWorker?.getRegistration())
    if (reg) return await reg.showNotification(title, options)
    const n = new Notification(title, options)
    n.onclick = () => { window.focus(); if (link) window.location.assign(__HRMS_BASE__ + link); n.close() }
  } catch (e) {
    console.warn('Notification failed', e)
  }
}
