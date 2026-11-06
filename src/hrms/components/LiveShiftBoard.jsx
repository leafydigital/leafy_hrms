import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Coffee, Home, LogIn, LogOut, MessageSquare, Search, UserX } from 'lucide-react'
import { api } from '../lib/db'
import { useRealtime } from '../lib/realtime'
import { fmtTime } from '../lib/format'
import { Badge, Empty, Modal } from './ui'

const TILES = [
  { key: 'in', label: 'Shifted in', icon: LogIn, tone: 'bg-lime-100 text-leaf-800' },
  { key: 'on_break', label: 'On break', icon: Coffee, tone: 'bg-amber-100 text-amber-800' },
  { key: 'out', label: 'Shifted out', icon: LogOut, tone: 'bg-gray-100 text-gray-700' },
  { key: 'not_in', label: 'Not in yet', icon: UserX, tone: 'bg-red-50 text-red-700' },
  { key: 'on_leave', label: 'On leave', icon: Home, tone: 'bg-sky-100 text-sky-800' },
]
const PAGE = 100

/**
 * Live "who is in" counts, updated instantly from shift-in / shift-out / break events.
 * Click a count to see the people in a list (code, name, department) — built for large teams.
 */
export default function LiveShiftBoard() {
  const { subscribe } = useRealtime()
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null) // tile key
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [shown, setShown] = useState(PAGE)
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

  const tile = TILES.find((t) => t.key === open)
  const people = useMemo(() => (open && data ? data.groups[open] ?? [] : []), [open, data])
  const departments = useMemo(() => [...new Set(people.map((p) => p.department).filter(Boolean))].sort(), [people])
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return people.filter((p) => (!dept || p.department === dept) &&
      (!n || [p.full_name, p.emp_code, p.department, p.designation].some((v) => String(v ?? '').toLowerCase().includes(n))))
  }, [people, q, dept])

  const openTile = (key) => { setOpen(key); setQ(''); setDept(''); setShown(PAGE) }
  const showTimes = open === 'in' || open === 'on_break' || open === 'out'

  if (!data) return null
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
          <button key={t.key} onClick={() => openTile(t.key)} title={`See who is ${t.label.toLowerCase()}`}
            className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 text-left transition hover:border-leaf-600 hover:shadow-sm">
            <span className={`rounded-lg p-2 ${t.tone}`}><t.icon size={16} /></span>
            <span>
              <span className="block text-2xl font-bold leading-none">{data.counts[t.key]}</span>
              <span className="text-xs text-gray-500">{t.label}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-400">Click a count to see the list of people.</p>

      <Modal open={!!open} onClose={() => setOpen(null)} size="xl" title={tile ? `${tile.label} · ${people.length}` : ''}>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9" placeholder="Search code, name, department, designation…" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE) }} autoFocus />
          </div>
          <select className="input w-auto" value={dept} onChange={(e) => { setDept(e.target.value); setShown(PAGE) }}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        {filtered.length === 0 ? <Empty>No one here.</Empty> : (
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-gray-200">
            <table className="w-full min-w-[560px]">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="th">Emp code</th><th className="th">Name</th><th className="th">Department</th>
                  {showTimes && <><th className="th">In</th><th className="th">Out</th></>}
                  <th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.slice(0, shown).map((p) => (
                  <tr key={p.id}>
                    <td className="td whitespace-nowrap font-mono text-xs">{p.emp_code}</td>
                    <td className="td"><div className="font-semibold">{p.full_name}</div>{p.designation && <div className="text-xs text-gray-500">{p.designation}</div>}</td>
                    <td className="td text-sm text-gray-700">{p.department ?? '—'}</td>
                    {showTimes && <><td className="td text-sm">{fmtTime(p.check_in)}</td><td className="td text-sm">{fmtTime(p.check_out)}</td></>}
                    <td className="td text-right">
                      <div className="flex justify-end gap-1">
                        {p.work_mode === 'wfh' && <Badge tone="blue">WFH</Badge>}
                        {p.approval_status === 'pending' && <Badge tone="amber">Pending</Badge>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          <span>Showing {Math.min(shown, filtered.length)} of {filtered.length}{filtered.length !== people.length ? ` (filtered from ${people.length})` : ''}</span>
          {shown < filtered.length && <button className="btn btn-ghost btn-sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more</button>}
        </div>
      </Modal>
    </div>
  )
}
