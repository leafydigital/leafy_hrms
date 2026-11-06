import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Bell, BellOff, BellRing, Download, FileText, Hash, Loader2, Lock, LogOut, MessageSquarePlus,
  Paperclip, Pencil, Plus, Send, Trash2, UserMinus, UserPlus, Users, X,
} from 'lucide-react'
import { api, apiBlob, apiUpload } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { useRealtime } from '../lib/realtime'
import { initials } from '../lib/format'
import { FieldError, Modal, useToast } from '../components/ui'

const MAX_FILE = 10 * 1024 * 1024
const COLORS = ['bg-lime-200 text-leaf-900', 'bg-sky-200 text-sky-900', 'bg-amber-200 text-amber-900', 'bg-rose-200 text-rose-900', 'bg-violet-200 text-violet-900', 'bg-teal-200 text-teal-900']
const NAME_COLORS = ['text-leaf-700', 'text-sky-700', 'text-amber-700', 'text-rose-700', 'text-violet-700', 'text-teal-700']
const hash = (id = '') => [...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0)
const colorFor = (id) => COLORS[hash(id) % COLORS.length]
const nameColor = (id) => NAME_COLORS[hash(id) % NAME_COLORS.length]
const tIST = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
const dayIST = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ts))
const size = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`)
const isImage = (mime) => /^image\/(png|jpe?g|gif|webp|bmp)$/.test(mime || '')
function dayLabel(d) {
  if (d === dayIST(new Date())) return 'Today'
  if (d === dayIST(new Date(Date.now() - 86400000))) return 'Yesterday'
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' })
}
const channelTitle = (c) => (c.kind === 'dm' ? c.partner?.full_name ?? 'Direct message' : c.name)

// ---------------------------------------------------------------- files (fetched with the login token)
const blobCache = new Map()
function useFileUrl(id) {
  const [url, setUrl] = useState(blobCache.get(id) ?? null)
  useEffect(() => {
    if (!id || blobCache.has(id)) return
    let live = true
    apiBlob(`/api/chat/file/${id}`).then((b) => { const u = URL.createObjectURL(b); blobCache.set(id, u); if (live) setUrl(u) }).catch(() => {})
    return () => { live = false }
  }, [id])
  return url
}
async function download(f) {
  const url = blobCache.get(f.id) ?? URL.createObjectURL(await apiBlob(`/api/chat/file/${f.id}`))
  blobCache.set(f.id, url)
  const a = document.createElement('a')
  a.href = url; a.download = f.file_name; document.body.appendChild(a); a.click(); a.remove()
}

function ImageThumb({ f, onOpen }) {
  const url = useFileUrl(f.id)
  return (
    <button type="button" onClick={() => onOpen({ ...f, url })} className="block overflow-hidden rounded-lg bg-black/5" title={f.file_name}>
      {url ? <img src={url} alt={f.file_name} className="max-h-64 w-full max-w-[280px] object-cover" /> : <div className="flex h-40 w-56 items-center justify-center"><Loader2 className="animate-spin text-gray-400" size={20} /></div>}
    </button>
  )
}
function FileCard({ f, mine }) {
  return (
    <button type="button" onClick={() => download(f).catch(() => {})} className={`flex w-full max-w-[280px] items-center gap-3 rounded-lg px-3 py-2 text-left ${mine ? 'bg-lime-200/60 hover:bg-lime-200' : 'bg-gray-100 hover:bg-gray-200'}`}>
      <FileText size={26} className="shrink-0 text-leaf-700" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{f.file_name}</span><span className="text-[11px] text-gray-500">{size(f.size_bytes)}</span></span>
      <Download size={16} className="shrink-0 text-gray-500" />
    </button>
  )
}

// ---------------------------------------------------------------- sidebar
function ChannelList({ channels, activeId, onOpen, onNewDm, onNewGroup, muted }) {
  const groups = [
    { label: 'Channels', items: channels.filter((c) => c.kind === 'channel') },
    { label: 'Groups', items: channels.filter((c) => c.kind === 'group'), add: onNewGroup, addLabel: '+ Create a group' },
    { label: 'Direct messages', items: channels.filter((c) => c.kind === 'dm'), add: onNewDm, addLabel: '+ Message someone' },
  ]
  return (
    <div className="flex h-full flex-col bg-ink text-gray-300">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="font-bold text-white">Leafy Digital</div>
        <div className="flex gap-1">
          <button className="rounded-md p-1.5 hover:bg-ink-700 hover:text-white" onClick={onNewGroup} title="Create a group" aria-label="Create a group"><Users size={18} /></button>
          <button className="rounded-md p-1.5 hover:bg-ink-700 hover:text-white" onClick={onNewDm} title="New direct message" aria-label="New direct message"><MessageSquarePlus size={18} /></button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{g.label}</span>
              {g.add && <button className="rounded p-0.5 text-gray-500 hover:text-white" onClick={g.add} aria-label={g.addLabel}><Plus size={14} /></button>}
            </div>
            {g.items.length === 0 && g.add && <button className="px-2 text-xs text-gray-500 hover:text-white" onClick={g.add}>{g.addLabel}</button>}
            {g.items.map((c) => {
              const unread = Number(c.unread || 0)
              const isMuted = muted.includes(c.slug)
              return (
                <button key={c.id} onClick={() => onOpen(c.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${activeId === c.id ? 'bg-lime-500 font-semibold text-ink' : unread && !isMuted ? 'font-bold text-white hover:bg-ink-700' : 'hover:bg-ink-700 hover:text-white'}`}>
                  {c.kind === 'dm'
                    ? <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${colorFor(c.partner?.id)}`}>{initials(c.partner?.full_name)}</span>
                    : c.kind === 'group' ? <Lock size={14} className="shrink-0 opacity-70" /> : <Hash size={15} className="shrink-0 opacity-70" />}
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

// ---------------------------------------------------------------- one message (WhatsApp style)
function Bubble({ m, prev, meId, showNames, onOpenImage }) {
  if (m.kind === 'system') {
    return (
      <div className="my-2 flex justify-center px-4">
        <span className="rounded-lg bg-white/80 px-3 py-1 text-center text-xs text-gray-600 shadow-sm">{m.sender_id === meId ? 'You' : m.sender_name} {m.body}</span>
      </div>
    )
  }
  const mine = m.sender_id === meId
  const grouped = prev && prev.kind !== 'system' && prev.sender_id === m.sender_id && dayIST(prev.created_at) === dayIST(m.created_at) && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000
  const files = m.attachments ?? []
  const images = files.filter((f) => isImage(f.mime_type))
  const others = files.filter((f) => !isImage(f.mime_type))
  const auto = m.kind === 'shift' || m.kind === 'task'
  return (
    <div className={`flex gap-2 px-3 sm:px-6 ${grouped ? 'mt-0.5' : 'mt-2.5'} ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && (
        <div className="w-8 shrink-0">
          {!grouped && <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold ${colorFor(m.sender_id)}`}>{m.sender_id ? initials(m.sender_name) : 'HR'}</div>}
        </div>
      )}
      <div className={`relative max-w-[78%] rounded-xl px-2.5 pb-1.5 pt-1.5 shadow-sm sm:max-w-[65%] ${mine ? 'bg-[#d9fdd3]' : 'bg-white'} ${!grouped ? (mine ? 'rounded-tr-sm' : 'rounded-tl-sm') : ''}`}>
        {!mine && !grouped && showNames && <div className={`mb-0.5 text-xs font-bold ${nameColor(m.sender_id)}`}>{m.sender_name ?? 'Leafy HRMS'}</div>}
        {images.length > 0 && (
          <div className={`mb-1 grid gap-1 ${images.length > 1 ? 'grid-cols-2' : ''}`}>
            {images.map((f) => <ImageThumb key={f.id} f={f} onOpen={onOpenImage} />)}
          </div>
        )}
        {others.length > 0 && <div className="mb-1 space-y-1">{others.map((f) => <FileCard key={f.id} f={f} mine={mine} />)}</div>}
        {(m.body || auto) && (
          <span className="whitespace-pre-wrap break-words text-sm text-ink">
            {auto && <span className={`mr-1.5 inline-block rounded px-1.5 py-px align-middle text-[10px] font-bold uppercase ${m.kind === 'shift' ? 'bg-lime-200 text-leaf-800' : 'bg-sky-100 text-sky-800'}`}>{m.kind}</span>}
            {m.body}
          </span>
        )}
        <span className="float-right ml-3 mt-1.5 select-none text-[10px] leading-none text-gray-500">{tIST(m.created_at)}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- people picker (create group / add people)
function PeoplePicker({ people, selected, onChange, exclude = [] }) {
  const [q, setQ] = useState('')
  const refs = useRefs()
  const list = people.filter((p) => !exclude.includes(p.id) && `${p.full_name} ${p.emp_code}`.toLowerCase().includes(q.trim().toLowerCase()))
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  return (
    <div>
      <input className="input mb-2" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((id) => { const p = people.find((x) => x.id === id); return p && (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-lime-100 py-0.5 pl-2 pr-1 text-xs font-semibold text-leaf-800">{p.full_name}<button type="button" onClick={() => toggle(id)} className="rounded-full p-0.5 hover:bg-lime-200" aria-label={`Remove ${p.full_name}`}><X size={12} /></button></span>
          ) })}
        </div>
      )}
      <div className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
        {list.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50">
            <input type="checkbox" className="h-4 w-4 accent-leaf-600" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${colorFor(p.id)}`}>{initials(p.full_name)}</span>
            <span className="text-sm font-medium">{p.full_name}</span>
            <span className="ml-auto text-xs text-gray-400">{refs.desigName(p.designation_id)}</span>
          </label>
        ))}
        {list.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No one found.</p>}
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
  const [pending, setPending] = useState([]) // files being attached: { key, file, preview, progress, attachment, error }
  const [sending, setSending] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [dmOpen, setDmOpen] = useState(false)
  const [dmQuery, setDmQuery] = useState('')
  const [groupForm, setGroupForm] = useState(null) // create group
  const [groupErrors, setGroupErrors] = useState({})
  const [info, setInfo] = useState(null) // group info / members
  const scroller = useRef(null)
  const stick = useRef(true)
  const input = useRef(null)
  const fileInput = useRef(null)

  const channels = rt.channels
  const active = useMemo(() => channels.find((c) => c.id === activeId), [channels, activeId])
  const open = useCallback((id) => setParams(id ? { c: id } : {}, { replace: false }), [setParams])
  const people = useMemo(() => refs.activeStaff.filter((p) => p.id !== me.id), [refs.activeStaff, me.id])

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
    setMessages([]); setLoading(true); stick.current = true; setPending([]); setText('')
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

  // ---- attachments: upload as soon as they are picked / pasted / dropped
  const addFiles = (fileList) => {
    const files = [...fileList]
    if (!files.length || !activeId) return
    for (const file of files) {
      const key = `${Date.now()}-${Math.random()}`
      if (file.size > MAX_FILE) { toast.error(`${file.name || 'File'} is larger than 10 MB.`); continue }
      if (!file.size) continue
      const named = file.name ? file : new File([file], `pasted-image-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, { type: file.type || 'image/png' })
      const preview = isImage(named.type) ? URL.createObjectURL(named) : null
      setPending((p) => [...p, { key, file: named, preview, progress: 0 }])
      apiUpload(`/api/chat/upload?channel_id=${activeId}`, named, (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))))
        .then(({ data, error }) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: 1, attachment: data?.attachment, error: error?.message } : x))))
    }
  }
  const removePending = (key) => setPending((p) => p.filter((x) => x.key !== key))
  const onPaste = (e) => {
    const files = [...(e.clipboardData?.files ?? [])]
    if (files.length) { e.preventDefault(); addFiles(files) }
  }
  const uploading = pending.some((x) => !x.attachment && !x.error)

  const send = async (e) => {
    e?.preventDefault()
    const body = text.trim()
    const ready = pending.filter((x) => x.attachment)
    if ((!body && !ready.length) || sending || uploading) return
    if (pending.some((x) => x.error)) return toast.error('Remove the files that failed to upload first.')
    setSending(true)
    stick.current = true
    const { data, error } = await api('/api/chat/send', { channel_id: activeId, body, attachment_ids: ready.map((x) => x.attachment.id) })
    setSending(false)
    if (error) return toast.error(error.message)
    setText('')
    if (input.current) input.current.style.height = 'auto'
    pending.forEach((x) => x.preview && URL.revokeObjectURL(x.preview))
    setPending([])
    setMessages((list) => (list.some((x) => String(x.id) === String(data.message.id)) ? list : [...list, data.message]))
    input.current?.focus()
  }

  // ---- DMs and groups
  const startDm = async (employeeId) => {
    const { data, error } = await api('/api/chat/dm', { employee_id: employeeId })
    if (error) return toast.error(error.message)
    setDmOpen(false); setDmQuery('')
    await rt.refreshChannels()
    open(data.channel_id)
  }
  const createGroup = async (e) => {
    e.preventDefault()
    const errs = {}
    if (groupForm.name.trim().length < 2) errs.name = 'Give the group a name (at least 2 characters).'
    if (!groupForm.member_ids.length) errs.member_ids = 'Add at least one person.'
    if (Object.keys(errs).length) return setGroupErrors(errs)
    const { data, error } = await api('/api/chat/groups/create', groupForm)
    if (error) { setGroupErrors(error.fields ?? {}); return toast.error(error.message) }
    setGroupForm(null)
    await rt.refreshChannels()
    open(data.channel_id)
    toast.success('Group created')
  }
  const loadInfo = async () => {
    const { data, error } = await api('/api/chat/groups/members', { channel_id: activeId })
    if (error) return toast.error(error.message)
    setInfo({ ...data, adding: [], editName: data.channel.name, editDesc: data.channel.description ?? '', editing: false })
  }
  const groupCall = async (path, body, okText) => {
    const { error } = await api(path, { channel_id: activeId, ...body })
    if (error) { toast.error(error.message); return false }
    if (okText) toast.success(okText)
    await rt.refreshChannels()
    return true
  }

  const dmPeople = people.filter((p) => p.full_name.toLowerCase().includes(dmQuery.trim().toLowerCase()))

  let lastDay = null
  return (
    <div className="-m-4 flex h-[calc(100dvh-57px)] overflow-hidden bg-white sm:-m-8 lg:h-[100dvh]">
      <aside className={`${activeId ? 'hidden md:block' : 'block'} w-full shrink-0 md:w-64`}>
        <ChannelList channels={channels} activeId={activeId} onOpen={open} muted={rt.muted}
          onNewDm={() => setDmOpen(true)} onNewGroup={() => { setGroupErrors({}); setGroupForm({ name: '', description: '', member_ids: [] }) }} />
      </aside>

      <section className={`${activeId ? 'flex' : 'hidden md:flex'} relative min-w-0 flex-1 flex-col`}
        onDragOver={(e) => { if (active && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragOver(true) } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files) }}>
        {active ? (
          <>
            <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2.5 sm:px-4">
              <button className="rounded-md p-1.5 hover:bg-gray-100 md:hidden" onClick={() => open(null)} aria-label="Back to chats"><ArrowLeft size={18} /></button>
              <button className="min-w-0 flex-1 text-left" onClick={active.kind === 'group' ? loadInfo : undefined} disabled={active.kind !== 'group'}>
                <div className="flex items-center gap-1 truncate font-bold">{active.kind === 'channel' ? <Hash size={16} /> : active.kind === 'group' ? <Lock size={14} /> : null}{channelTitle(active)}</div>
                <div className="truncate text-xs text-gray-500">{active.kind === 'group' ? `${active.member_count} members · tap for group info` : active.description ?? ''}</div>
              </button>
              {rt.permission !== 'granted' && rt.permission !== 'unsupported' && (
                <button className="btn btn-primary btn-sm" onClick={async () => { const p = await rt.enableNotifications(); if (p === 'granted') toast.success('Notifications on'); else if (p === 'denied') toast.error('Notifications are blocked in your browser settings.') }}>
                  <BellRing size={14} /> <span className="hidden sm:inline">Enable notifications</span>
                </button>
              )}
              {active.kind === 'group' && <button className="rounded-md p-2 text-gray-500 hover:bg-gray-100" onClick={loadInfo} title="Group members" aria-label="Group members"><Users size={18} /></button>}
              <button className="rounded-md p-2 text-gray-500 hover:bg-gray-100" onClick={() => rt.toggleMute(active.slug)} title={rt.muted.includes(active.slug) ? 'Unmute: pop-ups and sound on' : 'Mute: no pop-ups or sound'} aria-label="Toggle mute">
                {rt.muted.includes(active.slug) ? <BellOff size={18} /> : <Bell size={18} />}
              </button>
            </header>

            <div ref={scroller} className="flex-1 overflow-y-auto bg-[#efeae2] pb-3" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
              {hasMore && <div className="py-2 text-center"><button className="btn btn-ghost btn-sm" onClick={loadEarlier}>Load earlier messages</button></div>}
              {loading && <div className="py-10 text-center text-sm text-gray-500">Loading…</div>}
              {!loading && messages.length === 0 && <div className="px-6 py-16 text-center text-sm text-gray-500">No messages yet. Say hello 👋</div>}
              {messages.map((m, i) => {
                const d = dayIST(m.created_at)
                const showDay = d !== lastDay
                lastDay = d
                return (
                  <div key={m.id}>
                    {showDay && <div className="my-3 text-center"><span className="rounded-lg bg-white/90 px-3 py-1 text-xs font-semibold text-gray-600 shadow-sm">{dayLabel(d)}</span></div>}
                    <Bubble m={m} prev={showDay ? null : messages[i - 1]} meId={me.id} showNames={active.kind !== 'dm'} onOpenImage={setLightbox} />
                  </div>
                )
              })}
            </div>

            {dragOver && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-4 border-dashed border-leaf-600 bg-lime-50/80 text-lg font-bold text-leaf-800">Drop files to send</div>
            )}

            <form onSubmit={send} className="border-t border-gray-200 bg-gray-50 p-2 sm:p-3" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
              {pending.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pending.map((x) => (
                    <div key={x.key} className={`relative flex items-center gap-2 rounded-lg border bg-white p-1.5 pr-7 text-xs ${x.error ? 'border-red-300' : 'border-gray-200'}`}>
                      {x.preview ? <img src={x.preview} alt="" className="h-12 w-12 rounded object-cover" /> : <FileText size={28} className="text-leaf-700" />}
                      <div className="max-w-[160px]">
                        <div className="truncate font-semibold">{x.file.name}</div>
                        <div className={x.error ? 'text-red-600' : 'text-gray-500'}>{x.error ?? (x.attachment ? size(x.file.size) : `Uploading ${Math.round((x.progress || 0) * 100)}%`)}</div>
                      </div>
                      <button type="button" className="absolute right-1 top-1 rounded-full p-0.5 text-gray-400 hover:bg-gray-100 hover:text-ink" onClick={() => removePending(x.key)} aria-label="Remove"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <button type="button" className="mb-0.5 rounded-full p-2 text-gray-500 hover:bg-gray-200 hover:text-ink" onClick={() => fileInput.current?.click()} title="Attach files or photos" aria-label="Attach files"><Paperclip size={20} /></button>
                <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
                <div className="flex flex-1 items-end rounded-2xl border border-gray-300 bg-white px-3 py-1.5 focus-within:border-leaf-600 focus-within:ring-2 focus-within:ring-lime-400/40">
                  <textarea ref={input} rows={1} value={text} maxLength={4000} onPaste={onPaste}
                    onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px` }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); send() } }}
                    placeholder={`Message ${active.kind === 'channel' ? `#${active.name}` : channelTitle(active)}`}
                    className="max-h-40 min-h-[28px] flex-1 resize-none border-0 bg-transparent py-1 text-sm focus:outline-none" />
                </div>
                <button className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-leaf-600 text-white hover:bg-leaf-700 disabled:opacity-40" disabled={(!text.trim() && !pending.some((x) => x.attachment)) || sending || uploading} aria-label="Send">
                  {sending || uploading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </div>
              <p className="mt-1 hidden text-[11px] text-gray-400 sm:block">Enter to send · Shift + Enter for a new line · paste or drop images and files (up to 10 MB){!rt.connected && ' · Reconnecting…'}</p>
            </form>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-[#efeae2] text-sm text-gray-500">Pick a channel, group or person to start chatting.</div>
        )}
      </section>

      {/* image viewer */}
      <Modal open={!!lightbox} onClose={() => setLightbox(null)} size="xl" title={lightbox?.file_name ?? ''}
        footer={lightbox && <button className="btn btn-ghost" onClick={() => download(lightbox)}><Download size={15} /> Download</button>}>
        {lightbox?.url && <img src={lightbox.url} alt={lightbox.file_name} className="mx-auto max-h-[70vh] w-auto" />}
      </Modal>

      {/* new direct message */}
      <Modal open={dmOpen} onClose={() => setDmOpen(false)} title="New direct message">
        <input className="input mb-3" placeholder="Search people…" value={dmQuery} onChange={(e) => setDmQuery(e.target.value)} autoFocus />
        <div className="max-h-80 divide-y divide-gray-100 overflow-y-auto">
          {dmPeople.map((p) => (
            <button key={p.id} className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-gray-50" onClick={() => startDm(p.id)}>
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${colorFor(p.id)}`}>{initials(p.full_name)}</span>
              <span className="text-sm font-semibold">{p.full_name}</span>
              <span className="ml-auto text-xs text-gray-400">{refs.desigName(p.designation_id)}</span>
            </button>
          ))}
          {dmPeople.length === 0 && <p className="py-6 text-center text-sm text-gray-500">No one found.</p>}
        </div>
      </Modal>

      {/* create group */}
      <Modal open={!!groupForm} onClose={() => setGroupForm(null)} title="Create a group"
        footer={<><button className="btn btn-ghost" onClick={() => setGroupForm(null)}>Cancel</button><button form="group-form" className="btn btn-primary">Create group{groupForm?.member_ids.length ? ` (${groupForm.member_ids.length + 1})` : ''}</button></>}>
        {groupForm && (
          <form id="group-form" onSubmit={createGroup} noValidate className="space-y-4">
            <div>
              <label className={`label${groupErrors.name ? ' text-red-600' : ''}`} htmlFor="g-name">Group name</label>
              <input id="g-name" className={`input${groupErrors.name ? ' border-red-500 bg-red-50/40' : ''}`} placeholder="e.g. Dental clinics project" value={groupForm.name} maxLength={60} autoFocus
                onChange={(e) => { setGroupForm((g) => ({ ...g, name: e.target.value })); setGroupErrors((x) => ({ ...x, name: undefined })) }} />
              <FieldError>{groupErrors.name}</FieldError>
            </div>
            <div>
              <label className="label" htmlFor="g-desc">Description (optional)</label>
              <input id="g-desc" className="input" value={groupForm.description} onChange={(e) => setGroupForm((g) => ({ ...g, description: e.target.value }))} />
            </div>
            <div>
              <span className={`label${groupErrors.member_ids ? ' text-red-600' : ''}`}>Add people — only they will see this group</span>
              <PeoplePicker people={people} selected={groupForm.member_ids} onChange={(ids) => { setGroupForm((g) => ({ ...g, member_ids: ids })); setGroupErrors((x) => ({ ...x, member_ids: undefined })) }} />
              <FieldError>{groupErrors.member_ids}</FieldError>
            </div>
          </form>
        )}
      </Modal>

      {/* group info */}
      <Modal open={!!info} onClose={() => setInfo(null)} size="lg" title={info ? `Group info · ${info.channel.name}` : ''}>
        {info && (
          <div className="space-y-5">
            {info.can_manage && (info.editing ? (
              <div className="space-y-2 rounded-lg bg-gray-50 p-3">
                <input className="input" value={info.editName} maxLength={60} onChange={(e) => setInfo((x) => ({ ...x, editName: e.target.value }))} />
                <input className="input" placeholder="Description" value={info.editDesc} onChange={(e) => setInfo((x) => ({ ...x, editDesc: e.target.value }))} />
                <div className="flex justify-end gap-2">
                  <button className="btn btn-ghost btn-sm" onClick={() => setInfo((x) => ({ ...x, editing: false }))}>Cancel</button>
                  <button className="btn btn-primary btn-sm" onClick={async () => { if (await groupCall('/api/chat/groups/update', { name: info.editName, description: info.editDesc }, 'Group updated')) loadInfo() }}>Save</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-gray-600">{info.channel.description || 'No description.'}</p>
                <button className="btn btn-ghost btn-sm" onClick={() => setInfo((x) => ({ ...x, editing: true }))}><Pencil size={13} /> Edit</button>
              </div>
            ))}

            <div>
              <h3 className="mb-2 text-sm font-bold">{info.members.length} members</h3>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {info.members.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${colorFor(p.id)}`}>{initials(p.full_name)}</span>
                    <span className="text-sm font-medium">{p.full_name}{p.id === me.id && <span className="text-gray-400"> (you)</span>}</span>
                    {p.role === 'owner' && <span className="rounded bg-lime-100 px-1.5 py-0.5 text-[10px] font-bold text-leaf-800">Owner</span>}
                    {info.can_manage && p.id !== me.id && (
                      <button className="ml-auto rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" title={`Remove ${p.full_name}`}
                        onClick={async () => { if (window.confirm(`Remove ${p.full_name} from the group?`) && await groupCall('/api/chat/groups/remove', { employee_id: p.id }, 'Removed')) loadInfo() }}>
                        <UserMinus size={16} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {info.can_manage && (
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><UserPlus size={15} /> Add people</h3>
                <PeoplePicker people={people} selected={info.adding} exclude={info.members.map((m) => m.id)} onChange={(ids) => setInfo((x) => ({ ...x, adding: ids }))} />
                <div className="mt-2 flex justify-end">
                  <button className="btn btn-primary btn-sm" disabled={!info.adding.length} onClick={async () => { if (await groupCall('/api/chat/groups/add', { member_ids: info.adding }, 'Added to the group')) loadInfo() }}>Add {info.adding.length || ''}</button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-4">
              <button className="btn btn-ghost text-red-600" onClick={async () => { if (window.confirm('Leave this group?') && await groupCall('/api/chat/groups/remove', { employee_id: me.id }, 'You left the group')) { setInfo(null); open(null) } }}><LogOut size={15} /> Leave group</button>
              {info.can_manage && <button className="btn btn-danger" onClick={async () => { if (window.confirm('Delete this group and all its messages for everyone?') && await groupCall('/api/chat/groups/delete', {}, 'Group deleted')) { setInfo(null); open(null) } }}><Trash2 size={15} /> Delete group</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
