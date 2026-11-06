import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { BellRing, KeyRound, LogOut, Menu, MessageSquare, X } from 'lucide-react'
import { useRealtime } from '../lib/realtime'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { NAV, ROLES, can } from '../lib/permissions'
import { initials } from '../lib/format'
import { Modal, useToast } from './ui'

function ChangePassword({ open, onClose }) {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (pw.length < 8) return toast.error('Use at least 8 characters.')
    if (pw !== pw2) return toast.error('The two passwords do not match.')
    setBusy(true)
    const { error } = await db.auth.updateUser({ password: pw, current_password: current })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Password updated')
    setCurrent(''); setPw(''); setPw2('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button form="pw-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
        </>
      }
    >
      <form id="pw-form" onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Current password</label>
          <input type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </div>
        <div>
          <label className="label">New password</label>
          <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
        </div>
      </form>
    </Modal>
  )
}

/** Slack-style pop-ups (top-right) for new messages and approval notices. */
function Popups() {
  const { popups, dismiss } = useRealtime()
  const navigate = useNavigate()
  return (
    <div className="pointer-events-none fixed right-3 top-16 z-[70] flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2 lg:top-4" aria-live="polite">
      {popups.map((p) => (
        <div key={p.id} role="status"
          className="pointer-events-auto flex cursor-pointer gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-xl ring-1 ring-black/5 animate-[slidein_.25s_ease-out]"
          onClick={() => { dismiss(p.id); if (p.link) navigate(p.link) }}>
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${p.notice ? 'bg-ink text-lime-400' : 'bg-lime-200 text-leaf-900'}`}>
            {p.notice ? <BellRing size={16} /> : initials(p.title)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-sm font-bold">{p.title}</span>
              {p.subtitle && <span className="truncate text-xs text-gray-500">{p.subtitle}</span>}
            </div>
            <p className="line-clamp-2 text-sm text-gray-700">{p.body}</p>
          </div>
          <button className="self-start rounded p-0.5 text-gray-400 hover:text-ink" onClick={(e) => { e.stopPropagation(); dismiss(p.id) }} aria-label="Dismiss"><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}

export default function Layout({ children }) {
  const { me, role, signOut } = useAuth()
  const rt = useRealtime()
  const [open, setOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const loc = useLocation()
  const badges = { chat: rt.totalUnread }

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.module)) })).filter((g) => g.items.length)

  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-gray-300">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <img src={`${__HRMS_BASE__}/logo-white.png`} alt="Leafy Digital" className="h-20 w-auto" />
        <button className="rounded p-1 text-gray-400 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X size={20} />
        </button>
      </div>
      <div className="mx-5 mb-2 mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-lime-500">HR Management</div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {groups.map((g) => (
          <div key={g.group}>
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{g.group}</div>
            {g.items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive ? 'bg-lime-500 text-ink' : 'hover:bg-ink-700 hover:text-white'
                  }`
                }
              >
                <i.icon size={18} />
                <span className="flex-1">{i.label}</span>
                {i.badge && badges[i.badge] > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{badges[i.badge] > 99 ? '99+' : badges[i.badge]}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {rt.permission === 'default' && (
        <button onClick={rt.enableNotifications} className="mx-3 mb-3 flex items-center gap-2 rounded-lg bg-ink-700 px-3 py-2 text-left text-xs text-gray-300 hover:text-white">
          <BellRing size={16} className="shrink-0 text-lime-400" /> Turn on notifications for chat and approvals
        </button>
      )}
      <div className="border-t border-ink-600 p-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-500 text-sm font-bold text-ink">
            {initials(me.full_name)}
          </div>
          <NavLink to="/profile" onClick={() => setOpen(false)} className="min-w-0 flex-1 rounded-md hover:text-white" title="My Profile">
            <div className="truncate text-sm font-semibold text-white">{me.full_name}</div>
            <div className="truncate text-xs text-gray-400">{me.designation?.name ?? ROLES[role]?.label}</div>
          </NavLink>
          <button onClick={() => setPwOpen(true)} className="rounded-md p-2 text-gray-400 hover:bg-ink-700 hover:text-white" aria-label="Change password" title="Change password">
            <KeyRound size={18} />
          </button>
          <button onClick={signOut} className="rounded-md p-2 text-gray-400 hover:bg-ink-700 hover:text-white" aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-gray-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
          <button onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-gray-100" aria-label="Open menu">
            <Menu size={22} />
          </button>
          <img src={`${__HRMS_BASE__}/mark.png`} alt="" className="h-8 w-auto" />
          <span className="flex-1 font-bold">Leafy Digital HRMS</span>
          <NavLink to="/chat" className="relative rounded-md p-1.5 hover:bg-gray-100" aria-label="Chat">
            <MessageSquare size={22} />
            {rt.totalUnread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{rt.totalUnread > 99 ? '99+' : rt.totalUnread}</span>}
          </NavLink>
        </header>
        <main key={loc.pathname} className="mx-auto max-w-7xl p-4 sm:p-8">{children}</main>
      </div>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
      <Popups />
    </div>
  )
}
