import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, apiBase, getAccessToken } from './db'
import { useAuth } from './useAuth'
import { notificationPermission, playChime, registerServiceWorker, requestNotificationPermission, showSystemNotification } from './notify'

// One live connection per signed-in tab: chat messages, approval notices, shift-board pings.
const RealtimeCtx = createContext(null)
export const useRealtime = () => useContext(RealtimeCtx)

const MUTE_KEY = 'leafy_hrms_muted_channels'
const DEFAULT_MUTED = ['shift-updates'] // auto shift-in/out posts would ring every few seconds at 9 AM

function readMuted() {
  try { return JSON.parse(localStorage.getItem(MUTE_KEY)) ?? DEFAULT_MUTED } catch { return DEFAULT_MUTED }
}

async function* sseEvents(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      let event = 'message', data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) {
        try { yield { event, data: JSON.parse(data) } } catch { /* ignore malformed */ }
      }
    }
  }
}

export function RealtimeProvider({ children }) {
  const { me } = useAuth()
  const navigate = useNavigate()
  const [connected, setConnected] = useState(false)
  const [channels, setChannels] = useState([])
  const [popups, setPopups] = useState([])
  const [permission, setPermission] = useState(notificationPermission())
  const [muted, setMuted] = useState(readMuted)
  const listeners = useRef(new Set())
  const activeChannel = useRef(null)
  const channelsRef = useRef([])
  channelsRef.current = channels
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  const refreshChannels = useCallback(async () => {
    const { data } = await api('/api/chat/channels', {})
    if (data) setChannels(data.channels)
  }, [])

  const subscribe = useCallback((fn) => {
    listeners.current.add(fn)
    return () => listeners.current.delete(fn)
  }, [])

  const dismiss = useCallback((id) => setPopups((p) => p.filter((x) => x.id !== id)), [])
  const pushPopup = useCallback((popup) => {
    const id = `${Date.now()}-${Math.random()}`
    setPopups((p) => [...p.slice(-3), { ...popup, id }])
    setTimeout(() => dismiss(id), 7000)
  }, [dismiss])

  const markRead = useCallback(async (channelId, lastId) => {
    if (!channelId || !lastId) return
    setChannels((list) => list.map((c) => (c.id === channelId ? { ...c, unread: 0 } : c)))
    await api('/api/chat/read', { channel_id: channelId, last_id: Number(lastId) })
  }, [])

  const setActiveChannel = useCallback((id) => { activeChannel.current = id }, [])

  // Handle one incoming event
  const handle = useCallback(({ event, data }) => {
    listeners.current.forEach((fn) => fn(event, data))
    if (event === 'message') {
      const mine = data.sender_id === me?.id
      const known = channelsRef.current.find((c) => c.id === data.channel_id)
      if (!known) { refreshChannels(); }
      const viewing = activeChannel.current === data.channel_id && document.visibilityState === 'visible'
      setChannels((list) => list.map((c) => (c.id === data.channel_id
        ? { ...c, last_id: data.id, last_at: data.created_at, unread: mine || viewing ? c.unread : Number(c.unread || 0) + 1 }
        : c)))
      if (mine || viewing) return
      const slug = known?.slug ?? (data.channel_kind === 'dm' ? 'dm' : data.channel_name)
      if (mutedRef.current.includes(slug)) return
      const where = data.channel_kind === 'dm' ? 'Direct message' : `#${data.channel_name}`
      const link = `/chat?c=${data.channel_id}`
      playChime('message')
      pushPopup({ title: data.sender_name || 'Leafy HRMS', subtitle: where, body: data.body, link })
      showSystemNotification({ title: `${data.sender_name || 'Leafy HRMS'} · ${where}`, body: data.body, link, tag: data.channel_id })
    } else if (event === 'notice') {
      playChime('notice')
      pushPopup({ title: data.title, body: data.body, link: data.link, notice: true })
      showSystemNotification({ title: data.title, body: data.body, link: data.link, tag: 'notice' })
    }
  }, [me?.id, pushPopup, refreshChannels])

  // Keep one stream open with automatic reconnect.
  useEffect(() => {
    if (!me) return
    let stopped = false
    let controller
    let retry = 1000
    const run = async () => {
      while (!stopped) {
        const token = getAccessToken()
        if (!token) return
        controller = new AbortController()
        try {
          const res = await fetch(`${apiBase}/api/chat/stream`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal, cache: 'no-store' })
          if (res.status === 401 || res.status === 403) return
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
          setConnected(true)
          retry = 1000
          refreshChannels()
          for await (const evt of sseEvents(res)) handle(evt)
        } catch { /* network drop or abort */ }
        setConnected(false)
        if (stopped) return
        await new Promise((r) => setTimeout(r, retry))
        retry = Math.min(retry * 2, 30000)
      }
    }
    run()
    const onVisible = () => { if (document.visibilityState === 'visible') refreshChannels() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { stopped = true; controller?.abort(); document.removeEventListener('visibilitychange', onVisible) }
  }, [me?.id, handle, refreshChannels])

  // Service worker: keeps notification clicks inside the app.
  useEffect(() => {
    if (permission === 'granted') registerServiceWorker()
    const onMsg = (e) => { if (e.data?.type === 'navigate') navigate(e.data.link) }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
  }, [permission, navigate])

  const value = useMemo(() => ({
    connected, channels, popups, dismiss, subscribe, refreshChannels, markRead, setActiveChannel,
    totalUnread: channels.reduce((s, c) => s + (muted.includes(c.slug) ? 0 : Number(c.unread || 0)), 0),
    permission,
    async enableNotifications() { const p = await requestNotificationPermission(); setPermission(p); return p },
    muted,
    toggleMute(slug) {
      setMuted((m) => {
        const next = m.includes(slug) ? m.filter((x) => x !== slug) : [...m, slug]
        try { localStorage.setItem(MUTE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
        return next
      })
    },
  }), [connected, channels, popups, dismiss, subscribe, refreshChannels, markRead, setActiveChannel, permission, muted])

  return <RealtimeCtx.Provider value={value}>{children}</RealtimeCtx.Provider>
}
