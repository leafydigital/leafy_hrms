import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useRefs } from '../lib/refs'
import { todayIST } from '../lib/format'
import { dayInfo, daysOf, dow, halfLabel, leaveAbbr, loadMonth, monthSummary } from '../lib/attendanceMonth'
import { monthEnd, monthStart } from '../lib/format'
import { AttendanceTable } from './AttendanceBits'
import { Loading, Modal } from './ui'
import { fmtDate } from '../lib/format'

// Month calendar of one employee's attendance (used for "My attendance" and for HR / leadership).
//   ✓ present (W = work from home)   ✗ leave   ½ half day (AM off / PM off)   A absent
//   HD company holiday / festival — HD ✓ = worked on it → comp-off (shows whether it was used)
//   Sat & Sun are weekly offs.
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ym = (d) => d.slice(0, 7)
const addMonths = (month, n) => { const d = new Date(`${month}-01T00:00:00`); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export const CELL_STYLE = {
  present: 'bg-lime-50 border-lime-200', weekend_worked: 'bg-lime-50 border-lime-300', half: 'bg-amber-50 border-amber-200', leave: 'bg-red-50 border-red-200',
  leave_pending: 'bg-red-50/40 border-dashed border-red-300', absent: 'bg-red-100 border-red-300', holiday: 'bg-sky-50 border-sky-200',
  holiday_worked: 'bg-sky-50 border-sky-300', weekoff: 'bg-gray-100/70 border-gray-100', unmarked: 'bg-white border-gray-200', none: 'bg-white border-gray-100',
}

/** The symbol for one day. compact = small version for the all-employees grid. */
export function DayMark({ c, refs, compact }) {
  const s = compact ? 14 : 20
  switch (c.kind) {
    case 'present':
    case 'weekend_worked':
      return <span className={`flex items-center gap-0.5 ${c.a?.approval_status === 'pending' ? 'text-amber-600' : 'text-leaf-700'}`}><Check size={s} strokeWidth={3} />{c.wfhDay && <span className="rounded bg-sky-100 px-0.5 text-[9px] font-bold text-sky-800">W</span>}</span>
    case 'half': return <span className="text-center leading-none text-amber-700"><span className={compact ? 'text-xs font-bold' : 'text-lg font-bold'}>½</span>{!compact && <span className="block text-[10px] font-semibold">{halfLabel(c.session)}</span>}{compact && <span className="block text-[8px] font-bold">{c.session === 'morning' ? 'AM' : c.session === 'afternoon' ? 'PM' : ''}</span>}</span>
    case 'leave': return <span className="flex items-center gap-0.5 text-red-600"><X size={s} strokeWidth={3} />{!compact && <span className="text-[10px] font-bold">{leaveAbbr(refs.leaveType(c.leave?.leave_type_id)?.name || 'Leave')}</span>}</span>
    case 'leave_pending': return <span className="flex items-center gap-0.5 text-red-400"><X size={compact ? 12 : 18} />{!compact && <span className="text-[10px]">pending</span>}</span>
    case 'absent': return <span className={`${compact ? 'text-xs' : 'text-lg'} font-bold text-red-700`}>A</span>
    case 'holiday': return <span className={`${compact ? 'text-[10px]' : 'text-sm'} font-bold text-sky-700`}>HD</span>
    case 'holiday_worked': return (
      <span className="text-center leading-tight">
        <span className={`flex items-center gap-0.5 ${compact ? 'text-[10px]' : 'text-sm'} font-bold text-sky-700`}>HD<Check size={compact ? 11 : 16} strokeWidth={3} className="text-leaf-700" /></span>
        {!compact && c.earned && <span className={`block text-[9px] font-bold ${c.earned.remaining > 0 ? 'text-leaf-700' : 'text-gray-500'}`}>{c.earned.remaining > 0 ? 'C/O open' : 'C/O used'}</span>}
      </span>
    )
    case 'weekoff': return compact ? null : <span className="text-[11px] text-gray-400">Weekend</span>
    case 'unmarked': return <span className="text-gray-300">—</span>
    default: return null
  }
}

export function Legend() {
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px] text-gray-600">
      <span className="rounded bg-lime-50 px-1.5 py-0.5">✓ Present</span><span className="rounded bg-sky-100 px-1.5 py-0.5">W Work from home</span>
      <span className="rounded bg-red-50 px-1.5 py-0.5">✗ Leave</span><span className="rounded bg-amber-50 px-1.5 py-0.5">½ Half day (AM/PM off)</span>
      <span className="rounded bg-red-100 px-1.5 py-0.5">A Absent</span><span className="rounded bg-sky-50 px-1.5 py-0.5">HD Holiday · HD✓ worked → comp-off</span>
      <span className="rounded bg-gray-100 px-1.5 py-0.5">Sat / Sun weekend</span>
    </div>
  )
}

export default function EmployeeCalendar({ employee, onEdit, reloadKey = 0, showIp = false }) {
  const refs = useRefs()
  const today = todayIST()
  const [month, setMonth] = useState(ym(today))
  const [data, setData] = useState(null)
  const [picked, setPicked] = useState(null)

  const load = useCallback(async () => {
    setData(null)
    setData(await loadMonth({ month, employeeId: employee.id, leaveTypes: refs.leaveTypes }))
  }, [employee.id, month, refs.leaveTypes])
  useEffect(() => { load() }, [load, reloadKey])
  useEffect(() => { setPicked(null) }, [month, employee.id])

  const cells = useMemo(() => {
    if (!data) return []
    const first = monthStart(month)
    const lead = (dow(first) + 6) % 7
    return [...Array(lead).fill(null), ...daysOf(first, monthEnd(month)).map((d) => dayInfo(data, employee, d, today))]
  }, [data, month, today, employee])
  const summary = useMemo(() => monthSummary(cells, data, employee.id), [cells, data, employee.id])
  const p = picked && cells.find((c) => c?.d === picked)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <input type="month" className="input w-auto" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        <div className="ml-auto"><Legend /></div>
      </div>

      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEK.map((w) => <div key={w} className={`pb-1 text-center text-[11px] font-semibold uppercase ${w === 'Sat' || w === 'Sun' ? 'text-red-400' : 'text-gray-500'}`}>{w}</div>)}
            {cells.map((c, i) => c ? (
              <button key={c.d} type="button" onClick={() => setPicked(c.d === picked ? null : c.d)}
                title={c.holiday?.name}
                className={`flex min-h-[64px] flex-col items-center justify-between rounded-lg border p-1 text-left transition sm:min-h-[80px] ${CELL_STYLE[c.kind]} ${picked === c.d ? 'ring-2 ring-leaf-600' : ''} ${c.future && !c.holiday && !c.leave ? 'opacity-50' : 'hover:shadow-sm'} ${c.d === today ? 'outline outline-2 outline-lime-400' : ''}`}>
                <span className="self-start text-[11px] font-semibold text-gray-500">{Number(c.d.slice(8))}</span>
                <DayMark c={c} refs={refs} />
                <span className="w-full truncate text-center text-[9px] font-medium text-sky-800">{c.holiday?.name ?? ''}</span>
              </button>
            ) : <div key={`x${i}`} />)}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-8">
            {[['Present', summary.present], ['WFH', summary.wfh], ['Half days', summary.half], ['Leave', summary.leave], ['Absent', summary.absent], ['Not marked', summary.unmarked], ['Holidays worked', summary.holidayWorked], ['Comp-off left', `${summary.compLeft} / ${summary.compEarned}`]].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-gray-50 px-3 py-2"><div className="text-[11px] font-semibold uppercase text-gray-500">{l}</div><div className="text-lg font-bold">{v}</div></div>
            ))}
          </div>

          <p className="mt-3 text-center text-xs text-gray-500">Click a date to see its details{onEdit ? ' or mark attendance' : ''}.</p>
        </>
      )}

      <Modal open={!!p} onClose={() => setPicked(null)} size="xl"
        title={p ? `${employee.full_name} · ${fmtDate(p.d)} · ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow(p.d)]}` : ''}>
        {p && (
          <div className="-m-5">
            <AttendanceTable rows={[p]} refs={refs} showIp={showIp}
              onEdit={onEdit ? (r) => { setPicked(null); onEdit({ employee, date: r.d, rec: r.a, leave: r.leave }) } : undefined} />
          </div>
        )}
      </Modal>
    </div>
  )
}
