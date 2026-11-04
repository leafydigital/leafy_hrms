import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Bell, BellOff, BellRing, Hash, MessageSquarePlus, Send } from 'lucide-react'
import { api } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { useRealtime } from '../lib/realtime'
import { initials } from '../lib/format'
import { Modal, useToast } from '../components/ui'

const COLORS = ['bg-lime-200 text-leaf-900', 'bg-sky-200 text-sky-900', 'bg-amber-200 text-amber-900', 'bg-rose-200 text-rose-900', 'bg-violet-200 text-violet-900', 'bg-teal-200 text-teal-900']
const colorFor = (id = '') => COLORS[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length]
const tIST = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const dayIST = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ts))
function dayLabel(d) {
  const today = dayIST(new Date())
  const y = new Date(Date.now() - 86400000)
  if (d === today) return 'Today'
  if (d === dayIST(y)) return 'Yesterday'
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' })
}
const channelTitle = (c) => (c.kind === 'dm' ? c.partner?.full_name ?? 'Direct message' : c.name)

function ChannelList({ channels, activeId, onOpen, onNewDm, muted }) {
  const groups = [
    { label: 'Channels', items: channels.filter((c) => c.kind === 'channel') },
    { label: 'Direct messages', items: channels.filter((c) => c.kind === 'dm') },
  ]
  return (
    <div className="flex h-full flex-col bg-ink text-gray-300">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="font-bold text-white">Leafy Digital</div>
        <button className="rounded-md p-1.5 hover:bg-ink-700 hover:text-white" onClick={onNewDm} title="New direct message" aria-label="New direct message"><MessageSquarePlus size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{g.label}</div>
            {g.items.length === 0 && g.label === 'Direct messages' && <button className="px-2 text-xs text-gray-500 hover:text-white" onClick={onNewDm}>+ Message someone</button>}
            {g.items.map((c) => {
              const unread = Number(c.unread || 0)
              const isMuted = muted.includes(c.slug)
              return (
                <button key={c.id} onClick={() => onOpen(c.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${activeId === c.id ? 'bg-lime-500 font-semibold text-ink' : unread && !isMuted ? 'font-bold text-white hover:bg-ink-700' : 'hover:bg-ink-700 hover:text-white'}`}>
                  {c.kind === 'dm'
                    ? <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${colorFor(c.partner?.id)}`}>{initials(c.partner?.full_name)}</span>
                    : <Hash size={15} className="shrink-0 opacity-70" />}
                  <span className="min-w-0 flex-1 truncate">{channelTitle(c)}</span>
                  {isMuted && <BellOff size={12} className="opacity-50" />}
                  {unread > 0 && activeId !== c.id && <span className={`rounded-full px-1.5 text-[11px] font-bold ${isMuted ? 'bg-ink-600 text-gray-300' : 'bg-red-500 text-white'}`}>{unread > 99 ? '99+' : unread}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Message({ m, prev, meId }) {
  const grouped = prev && prev.sender_id === m.sender_id && dayIST(prev.created_at) === dayIST(m.created_at) && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000
  const auto = m.kind === 'shift' || m.kind === 'task'
  return (
    <div className={`group flex gap-3 px-4 ${grouped ? 'py-0.5' : 'pt-3 pb-0.5'} hover:bg-gray-50`}>
      <div className="w-9 shrink-0">
        {!grouped && <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold ${colorFor(m.sender_id)}`}>{m.sender_id ? initials(m.sender_name) : 'HR'}</div>}
        {grouped && <span className="hidden pt-1 text-[10px] text-gray-400 group-hover:block">{tIST(m.created_at)}</span>}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold">{m.sender_name ?? 'Leafy HRMS'}{m.sender_id === meId && <span className="ml-1 font-normal text-gray-400">(you)</span>}</span>
            <span className="text-[11px] text-gray-400">{tIST(m.created_at)}</span>
          </div>
        )}
        <div className={`whitespace-pre-wrap break-words text-sm ${auto ? 'text-gray-600' : 'text-ink'}`}>
          {auto && <span className={`mr-1.5 inline-block rounded px-1.5 py-px align-middle text-[10px] font-bold uppercase ${m.kind === 'shift' ? 'bg-lime-100 text-leaf-800' : 'bg-sky-100 text-sky-800'}`}>{m.kind === 'shift' ? 'shift' : 'task'}</span>}
          {m.body}
        </div>
      </div>
    </div>
  )
}

export default function Chat() {
  const { me } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const rt = useRealtime()
  const [params, setParams] = useSearchParams()
  const activeId = params.get('c')
  const [messages, setMessages] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [dmOpen, setDmOpen] = useState(false)
  const [dmQuery, setDmQuery] = useState('')
  const scroller = useRef(null)
  const stick = useRef(true)
  const input = useRef(null)

  const channels = rt.channels
  const active = useMemo(() => channels.find((c) => c.id === activeId), [channels, activeId])
  const open = useCallback((id) => setParams(id ? { c: id } : {}, { replace: false }), [setParams])

  // Desktop: open #general by default.
  useEffect(() => {
    if (!activeId && channels.length && window.matchMedia('(min-width: 768px)').matches) {
      const general = channels.find((c) => c.slug === 'general') ?? channels[0]
      setParams({ c: general.id }, { replace: true })
    }
  }, [activeId, channels, setParams])

  useEffect(() => { rt.setActiveChannel(activeId); return () => rt.setActiveChannel(null) }, [activeId])

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setMessages([]); setLoading(true); stick.current = true
    api('/api/chat/messages', { channel_id: activeId, limit: 50 }).then(({ data, error }) => {
      if (cancelled) return
      setLoading(false)
      if (error) return toast.error(error.message)
      setMessages(data.messages); setHasMore(data.has_more)
      const last = data.messages.at(-1)
      if (last) rt.markRead(activeId, last.id)
    })
    if (window.matchMedia('(min-width: 768px)').matches) setTimeout(() => input.current?.focus(), 50)
    return () => { cancelled = true }
  }, [activeId])

  // Live messages for the open channel.
  useEffect(() => rt.subscribe((evt, m) => {
    if (evt !== 'message' || m.channel_id !== activeId) return
    setMessages((list) => (list.some((x) => String(x.id) === String(m.id)) ? list : [...list, m]))
    if (document.visibilityState === 'visible') rt.markRead(activeId, m.id)
  }), [rt.subscribe, activeId])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const loadEarlier = async () => {
    const el = scroller.current
    const before = el?.scrollHeight ?? 0
    stick.current = false
    const { data } = await api('/api/chat/messages', { channel_id: activeId, before_id: Number(messages[0]?.id), limit: 50 })
    if (!data) return
    setMessages((list) => [...data.messages, ...list])
    setHasMore(data.has_more)
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before })
  }

  const send = async (e) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    stick.current = true
    const { data, error } = await api('/api/chat/send', { channel_id: activeId, body })
    setSending(false)
    if (error) return toast.error(error.message)
    setText('')
    setMessages((list) => (list.some((x) => String(x.id) === String(data.message.id)) ? list : [...list, data.message]))
    input.current?.focus()
  }

  const startDm = async (employeeId) => {
    const { data, error } = await api('/api/chat/dm', { employee_id: employeeId })
    if (error) return toast.error(error.message)
    setDmOpen(false); setDmQuery('')
    await rt.refreshChannels()
    open(data.channel_id)
  }

  const people = refs.activeStaff.filter((p) => p.id !== me.id && p.full_name.toLowerCase().includes(dmQuery.trim().toLowerCase()))

  let lastDay = null
  return (
    <div className="-m-4 flex h-[calc(100dvh-57px)] overflow-hidden bg-white sm:-m-8 lg:h-[100dvh]">
      <aside className={`${activeId ? 'hidden md:block' : 'block'} w-full shrink-0 md:w-64`}>
        <ChannelList channels={channels} activeId={activeId} onOpen={open} onNewDm={() => setDmOpen(true)} muted={rt.muted} />
      </aside>

      <section className={`${activeId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {active ? (
          <>
            <header className="flex items-center gap-2 border-b border-gray-200 px-3 py-2.5 sm:px-4">
              <button className="rounded-md p-1.5 hover:bg-gray-100 md:hidden" onClick={() => open(null)} aria-label="Back to channels"><ArrowLeft size={18} /></button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 truncate font-bold">{active.kind === 'channel' && <Hash size={16} />}{channelTitle(active)}</div>
                {active.description && <div className="truncate text-xs text-gray-500">{active.description}</div>}
              </div>
              {rt.permission !== 'granted' && rt.permission !== 'unsupported' && (
                <button className="btn btn-primary btn-sm" onClick={async () => { const p = await rt.enableNotifications(); if (p === 'granted') toast.success('Notifications on'); else if (p === 'denied') toast.error('Notifications are blocked in your browser settings.') }}>
                  <BellRing size={14} /> <span className="hidden sm:inline">Enable notifications</span>
                </button>
              )}
              <button className="rounded-md p-2 text-gray-500 hover:bg-gray-100" onClick={() => rt.toggleMute(active.slug)} title={rt.muted.includes(active.slug) ? 'Unmute: pop-ups and sound on' : 'Mute: no pop-ups or sound'} aria-label="Toggle mute">
                {rt.muted.includes(active.slug) ? <BellOff size={18} /> : <Bell size={18} />}
              </button>
            </header>

            <div ref={scroller} className="flex-1 overflow-y-auto pb-2" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
              {hasMore && <div className="py-2 text-center"><button className="btn btn-ghost btn-sm" onClick={loadEarlier}>Load earlier messages</button></div>}
              {loading && <div className="py-10 text-center text-sm text-gray-500">Loading…</div>}
              {!loading && messages.length === 0 && <div className="px-6 py-16 text-center text-sm text-gray-500">No messages yet. Say hello 👋</div>}
              {messages.map((m, i) => {
                const d = dayIST(m.created_at)
                const showDay = d !== lastDay
                lastDay = d
                return (
                  <div key={m.id}>
                    {showDay && (
                      <div className="relative my-3 text-center">
                        <div className="absolute inset-x-0 top-1/2 border-t border-gray-200" />
                        <span className="relative rounded-full border border-gray-200 bg-white px-3 py-0.5 text-xs font-semibold">{dayLabel(d)}</span>
                      </div>
                    )}
                    <Message m={m} prev={showDay ? null : messages[i - 1]} meId={me.id} />
                  </div>
                )
              })}
            </div>

            <form onSubmit={send} className="border-t border-gray-100 p-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
              <div className="flex items-end gap-2 rounded-xl border border-gray-300 bg-white p-2 focus-within:border-leaf-600 focus-within:ring-2 focus-within:ring-lime-400/40">
                <textarea ref={input} rows={1} value={text} maxLength={4000}
                  onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px` }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send() } }}
                  placeholder={`Message ${active.kind === 'channel' ? `#${active.name}` : channelTitle(active)}`}
                  className="max-h-40 min-h-[36px] flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm focus:outline-none" />
                <button className="btn btn-primary h-9 w-9 shrink-0 p-0" disabled={!text.trim() || sending} aria-label="Send"><Send size={16} /></button>
              </div>
              <p className="mt-1 hidden text-[11px] text-gray-400 sm:block">Enter to send · Shift + Enter for a new line{!rt.connected && ' · Reconnecting…'}</p>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-gray-500">Pick a channel or person to start chatting.</div>
        )}
      </section>

      <Modal open={dmOpen} onClose={() => setDmOpen(false)} title="New direct message">
        <input className="input mb-3" placeholder="Search people…" value={dmQuery} onChange={(e) => setDmQuery(e.target.value)} autoFocus />
        <div className="max-h-80 divide-y divide-gray-100 overflow-y-auto">
          {people.map((p) => (
            <button key={p.id} className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-gray-50" onClick={() => startDm(p.id)}>
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${colorFor(p.id)}`}>{initials(p.full_name)}</span>
              <span className="text-sm font-semibold">{p.full_name}</span>
              <span className="ml-auto text-xs text-gray-400">{refs.desigName(p.designation_id)}</span>
            </button>
          ))}
          {people.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No one found.</p>}
        </div>
      </Modal>
    </div>
  )
}
