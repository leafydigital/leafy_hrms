import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Coffee, Home, LogIn, LogOut, MessageSquare, UserX } from 'lucide-react'
import { api } from '../lib/db'
import { useRealtime } from '../lib/realtime'
import { fmtTime, initials } from '../lib/format'
import { Badge } from './ui'

const TILES = [
  { key: 'in', label: 'Shifted in', icon: LogIn, tone: 'bg-lime-100 text-leaf-800' },
  { key: 'on_break', label: 'On break', icon: Coffee, tone: 'bg-amber-100 text-amber-800' },
  { key: 'out', label: 'Shifted out', icon: LogOut, tone: 'bg-gray-100 text-gray-700' },
  { key: 'not_in', label: 'Not in yet', icon: UserX, tone: 'bg-red-50 text-red-700' },
  { key: 'on_leave', label: 'On leave', icon: Home, tone: 'bg-sky-100 text-sky-800' },
]

/** Live "who is in" board, updated instantly from shift-in / shift-out / break events. */
export default function LiveShiftBoard() {
  const { subscribe } = useRealtime()
  const [data, setData] = useState(null)
  const [open, setOpen] = useState('in')
  const timer = useRef(null)

  const load = useCallback(async () => {
    const { data } = await api('/api/attendance/live', {})
    if (data) setData(data)
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t) }, [load])
  useEffect(() => subscribe((evt) => {
    if (evt !== 'shift') return
    clearTimeout(timer.current)
    timer.current = setTimeout(load, 400)
  }), [subscribe, load])

  if (!data) return null
  const people = data.groups[open] ?? []
  return (
    <div className="card mb-6 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Live shift board <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-lime-500 align-middle" /></h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="blue">{data.wfh_today} WFH today</Badge>
          {data.pending_checkins > 0 && <Link to="/attendance?tab=approvals"><Badge tone="amber">{data.pending_checkins} check-in{data.pending_checkins > 1 ? 's' : ''} to approve</Badge></Link>}
          {data.pending_wfh > 0 && <Link to="/wfh?tab=review"><Badge tone="amber">{data.pending_wfh} WFH request{data.pending_wfh > 1 ? 's' : ''}</Badge></Link>}
          <Link to="/chat" className="inline-flex items-center gap-1 font-semibold text-leaf-700 hover:underline"><MessageSquare size={14} /> #shift-updates</Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {TILES.map((t) => (
          <button key={t.key} onClick={() => setOpen(t.key)}
            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${open === t.key ? 'border-leaf-600 ring-2 ring-lime-400/40' : 'border-gray-200 hover:border-gray-300'}`}>
            <span className={`rounded-lg p-2 ${t.tone}`}><t.icon size={16} /></span>
            <span>
              <span className="block text-2xl font-bold leading-none">{data.counts[t.key]}</span>
              <span className="text-xs text-gray-500">{t.label}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {people.length === 0 && <span className="text-sm text-gray-500">No one here.</span>}
        {people.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-2 rounded-full bg-gray-50 py-1 pl-1 pr-3 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-lime-200 text-[10px] font-bold text-leaf-900">{initials(p.full_name)}</span>
            {p.full_name}
            {p.check_in && <span className="text-xs text-gray-500">{fmtTime(p.check_in)}{p.check_out ? ` – ${fmtTime(p.check_out)}` : ''}</span>}
            {p.work_mode === 'wfh' && <Badge tone="blue">WFH</Badge>}
            {p.approval_status === 'pending' && <Badge tone="amber">pending</Badge>}
          </span>
        ))}
      </div>
    </div>
  )
}
