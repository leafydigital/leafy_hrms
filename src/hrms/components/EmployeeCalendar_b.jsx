import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, MapPin, X } from 'lucide-react'
import { db } from '../lib/db'
import { useRefs } from '../lib/refs'
import { mapLink } from '../lib/geo'
import { fmtDate, fmtTime, monthEnd, monthStart, todayIST } from '../lib/format'
import { isCompOffType } from '../lib/leaveBalance'
import { Badge, Loading } from './ui'

// Month calendar of one employee's attendance for HR / Admin / leadership (and reporting persons).
//   ✓ present (W = work from home)   ✗ leave   ½ half day (AM off / PM off)   A absent
//   HD company holiday — HD ✓ = worked on the holiday → comp-off earned (shows whether it was used)
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WORKED = ['present', 'wfh', 'half_day']
const ym = (d) => d.slice(0, 7)
const addMonths = (month, n) => { const d = new Date(`${month}-01T00:00:00`); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const daysOf = (start, end) => {
  const out = []
  for (let d = new Date(`${start}T00:00:00Z`), e = new Date(`${end}T00:00:00Z`); d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Sunday
const abbr = (name = '') => (isCompOffType({ name }) ? 'C/O' : /lop|unpaid/i.test(name) ? 'LOP' : name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase())
const halfLabel = (s) => (s === 'morning' ? 'AM off' : s === 'afternoon' ? 'PM off' : 'Half')
// Half-day attendance without a stored session: a late start means the morning was off.
const sessionFromTimes = (a) => {
  if (a?.half_day_session) return a.half_day_session
  const t = (ts) => (ts ? Number(new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })) : null)
  if (t(a?.check_in) != null && t(a.check_in) >= 12) return 'morning'
  if (t(a?.check_out) != null && t(a.check_out) <= 14) return 'afternoon'
  return null
}

/** Spread comp-off days taken (approved Comp Off leave) over the days earned, oldest first. */
function allocateCompOff(earned, takenLeaves) {
  const units = []
  for (const l of takenLeaves) {
    const ds = daysOf(l.start_date, l.end_date).filter((d) => dow(d) !== 0)
    ds.forEach((d) => units.push({ date: d, amount: l.half_day && ds.length === 1 ? 0.5 : 1 }))
  }
  units.sort((a, b) => a.date.localeCompare(b.date))
  const result = {}
  let i = 0, carry = 0
  for (const e of [...earned].sort((a, b) => a.earned_on.localeCompare(b.earned_on))) {
    let need = Number(e.days)
    const usedOn = []
    while (need > 0 && i < units.length) {
      const avail = units[i].amount - carry
      const take = Math.min(avail, need)
      usedOn.push(units[i].date)
      need -= take
      carry += take
      if (carry >= units[i].amount) { i++; carry = 0 }
    }
    result[e.earned_on] = { days: Number(e.days), usedOn: [...new Set(usedOn)], remaining: need }
  }
  return result
}

export default function EmployeeCalendar({ employee }) {
  const refs = useRefs()
  const today = todayIST()
  const [month, setMonth] = useState(ym(today))
  const [data, setData] = useState(null)
  const [picked, setPicked] = useState(null)
  const compType = refs.leaveTypes.find(isCompOffType)

  const load = useCallback(async () => {
    setData(null); setPicked(null)
    const first = monthStart(month), last = monthEnd(month)
    const [att, lv, hol, comp, compLeaves, wfh] = await Promise.all([
      db.from('attendance').select('*').eq('employee_id', employee.id).gte('date', first).lte('date', last),
      db.from('leaves').select('*').eq('employee_id', employee.id).in('status', ['approved', 'pending', 'cancellation_requested']).lte('start_date', last).gte('end_date', first),
      db.from('company_holidays').select('*').gte('holiday_date', first).lte('holiday_date', last),
      db.from('comp_off_ledger').select('*').eq('employee_id', employee.id).order('earned_on'),
      compType ? db.from('leaves').select('*').eq('employee_id', employee.id).eq('leave_type_id', compType.id).eq('status', 'approved') : Promise.resolve({ data: [] }),
      db.from('wfh_days').select('*').eq('employee_id', employee.id).gte('wfh_date', first).lte('wfh_date', last),
    ])
    setData({
      att: Object.fromEntries((att.data ?? []).map((a) => [a.date, a])),
      leaves: lv.data ?? [],
      holidays: Object.fromEntries((hol.data ?? []).map((h) => [h.holiday_date, h])),
      comp: comp.data ?? [],
      compAlloc: allocateCompOff(comp.data ?? [], compLeaves.data ?? []),
      wfh: Object.fromEntries((wfh.data ?? []).map((w) => [w.wfh_date, w])),
    })
  }, [employee.id, month, compType?.id])
  useEffect(() => { load() }, [load])

  const cells = useMemo(() => {
    if (!data) return []
    const first = monthStart(month)
    const lead = (dow(first) + 6) % 7
    const days = daysOf(first, monthEnd(month)).map((d) => {
      const a = data.att[d]
      const leave = data.leaves.find((l) => l.start_date <= d && l.end_date >= d && dow(d) !== 0)
      const holiday = data.holidays[d]
      const worked = !!a && WORKED.includes(a.status)
      const half = a?.status === 'half_day' || (leave?.half_day && leave.status === 'approved')
      const session = a?.status === 'half_day' ? sessionFromTimes(a) ?? leave?.half_day_session : leave?.half_day_session
      const earned = data.compAlloc[d]
      let kind = 'none'
      if (holiday) kind = worked ? 'holiday_worked' : 'holiday'
      else if (half) kind = 'half'
      else if (worked) kind = 'present'
      else if (a?.status === 'leave' || (leave && leave.status === 'approved')) kind = 'leave'
      else if (leave) kind = 'leave_pending'
      else if (a?.status === 'absent') kind = 'absent'
      else if (dow(d) === 0) kind = 'weekoff'
      else if (d < today && d >= (employee.date_of_joining || '0000')) kind = 'unmarked'
      const wfhDay = a?.work_mode === 'wfh' || a?.status === 'wfh' || (data.wfh[d] && !data.wfh[d].opted_out_at)
      return { d, a, leave, holiday, kind, session, earned, wfhDay, future: d > today }
    })
    return [...Array(lead).fill(null), ...days]
  }, [data, month, today, employee.date_of_joining])

  const summary = useMemo(() => {
    const s = { present: 0, wfh: 0, leave: 0, half: 0, absent: 0, holidayWorked: 0, unmarked: 0 }
    for (const c of cells) {
      if (!c) continue
      if (c.kind === 'present') { s.present += 1; if (c.wfhDay) s.wfh += 1 }
      if (c.kind === 'half') { s.half += 1; s.present += 0.5 }
      if (c.kind === 'leave') s.leave += 1
      if (c.kind === 'absent') s.absent += 1
      if (c.kind === 'holiday_worked') s.holidayWorked += 1
      if (c.kind === 'unmarked') s.unmarked += 1
    }
    const earned = (data?.comp ?? []).reduce((t, x) => t + Number(x.days), 0)
    const left = Object.values(data?.compAlloc ?? {}).reduce((t, x) => t + x.remaining, 0)
    return { ...s, compEarned: earned, compUsed: earned - left, compLeft: left }
  }, [cells, data])

  const style = {
    present: 'bg-lime-50 border-lime-200', half: 'bg-amber-50 border-amber-200', leave: 'bg-red-50 border-red-200',
    leave_pending: 'bg-red-50/40 border-dashed border-red-300', absent: 'bg-red-100 border-red-300', holiday: 'bg-sky-50 border-sky-200',
    holiday_worked: 'bg-sky-50 border-sky-300', weekoff: 'bg-gray-50 border-gray-100', unmarked: 'bg-white border-gray-200', none: 'bg-white border-gray-100',
  }

  const Mark = ({ c }) => {
    switch (c.kind) {
      case 'present': return <span className={`flex items-center gap-1 ${c.a?.approval_status === 'pending' ? 'text-amber-600' : 'text-leaf-700'}`}><Check size={20} strokeWidth={3} />{c.wfhDay && <span className="rounded bg-sky-100 px-1 text-[10px] font-bold text-sky-800">W</span>}</span>
      case 'half': return <span className="text-center leading-none text-amber-700"><span className="text-lg font-bold">½</span><span className="block text-[10px] font-semibold">{halfLabel(c.session)}</span></span>
      case 'leave': return <span className="flex items-center gap-1 text-red-600"><X size={20} strokeWidth={3} /><span className="text-[10px] font-bold">{abbr(refs.leaveType(c.leave?.leave_type_id)?.name || (c.a?.status === 'leave' ? 'Leave' : ''))}</span></span>
      case 'leave_pending': return <span className="flex items-center gap-1 text-red-400"><X size={18} /><span className="text-[10px]">pending</span></span>
      case 'absent': return <span className="text-lg font-bold text-red-700">A</span>
      case 'holiday': return <span className="text-sm font-bold text-sky-700">HD</span>
      case 'holiday_worked': return (
        <span className="text-center leading-tight">
          <span className="flex items-center gap-0.5 text-sm font-bold text-sky-700">HD<Check size={16} strokeWidth={3} className="text-leaf-700" /></span>
          {c.earned && <span className={`block text-[9px] font-bold ${c.earned.remaining > 0 ? 'text-leaf-700' : 'text-gray-500'}`}>{c.earned.remaining > 0 ? 'C/O open' : 'C/O used'}</span>}
        </span>
      )
      case 'weekoff': return <span className="text-[11px] text-gray-400">Off</span>
      case 'unmarked': return <span className="text-gray-300">—</span>
      default: return null
    }
  }

  const p = picked && cells.find((c) => c?.d === picked)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <input type="month" className="input w-auto" value={month} max={ym(today)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => addMonths(m, 1))} disabled={month >= ym(today)} aria-label="Next month"><ChevronRight size={16} /></button>
        <div className="ml-auto flex flex-wrap gap-1.5 text-[11px] text-gray-600">
          <span className="rounded bg-lime-50 px-1.5 py-0.5">✓ Present</span><span className="rounded bg-sky-100 px-1.5 py-0.5">W Work from home</span>
          <span className="rounded bg-red-50 px-1.5 py-0.5">✗ Leave</span><span className="rounded bg-amber-50 px-1.5 py-0.5">½ Half day (AM/PM off)</span>
          <span className="rounded bg-red-100 px-1.5 py-0.5">A Absent</span><span className="rounded bg-sky-50 px-1.5 py-0.5">HD Holiday · HD✓ worked → comp-off</span>
        </div>
      </div>

      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEK.map((w) => <div key={w} className={`pb-1 text-center text-[11px] font-semibold uppercase ${w === 'Sun' ? 'text-red-400' : 'text-gray-500'}`}>{w}</div>)}
            {cells.map((c, i) => c ? (
              <button key={c.d} type="button" onClick={() => setPicked(c.d)} disabled={c.future}
                className={`flex min-h-[64px] flex-col items-center justify-between rounded-lg border p-1 text-left transition sm:min-h-[76px] ${style[c.kind]} ${picked === c.d ? 'ring-2 ring-leaf-600' : ''} ${c.future ? 'opacity-40' : 'hover:shadow-sm'} ${c.d === today ? 'outline outline-2 outline-lime-400' : ''}`}>
                <span className="self-start text-[11px] font-semibold text-gray-500">{Number(c.d.slice(8))}</span>
                <Mark c={c} />
                <span className="h-2" />
              </button>
            ) : <div key={`x${i}`} />)}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-8">
            {[['Present', summary.present], ['WFH', summary.wfh], ['Half days', summary.half], ['Leave', summary.leave], ['Absent', summary.absent], ['Not marked', summary.unmarked], ['Holidays worked', summary.holidayWorked], ['Comp-off left', `${summary.compLeft} / ${summary.compEarned}`]].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-gray-50 px-3 py-2"><div className="text-[11px] font-semibold uppercase text-gray-500">{l}</div><div className="text-lg font-bold">{v}</div></div>
            ))}
          </div>

          {p && (
            <div className="mt-4 rounded-xl border border-gray-200 p-4 text-sm">
              <div className="mb-2 font-bold">{fmtDate(p.d)} · {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(p.d)]}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  {p.holiday && <div><Badge tone="blue">Company holiday</Badge> {p.holiday.name}</div>}
                  {p.a ? (
                    <>
                      <div>Status: <b>{p.a.status.replace('_', ' ')}</b>{p.a.work_mode === 'wfh' && ' · work from home'}{p.a.approval_status === 'pending' && <> · <Badge tone="amber">awaiting approval</Badge></>}</div>
                      <div>In <b>{fmtTime(p.a.check_in)}</b>{p.a.check_in_system && ` (actual ${fmtTime(p.a.check_in_system)})`} · Out <b>{fmtTime(p.a.check_out)}</b>{p.a.check_out_system && ` (actual ${fmtTime(p.a.check_out_system)})`}</div>
                      {p.kind === 'half' && <div>Half day: {halfLabel(p.session)}</div>}
                      {mapLink(p.a.check_in_lat, p.a.check_in_lng) && <a className="inline-flex items-center gap-1 font-semibold text-leaf-700 hover:underline" href={mapLink(p.a.check_in_lat, p.a.check_in_lng)} target="_blank" rel="noreferrer"><MapPin size={13} /> Check-in location</a>}
                      {p.a.check_in_reason && <div className="text-gray-600">Reason: “{p.a.check_in_reason}”</div>}
                      {p.a.note && <div className="text-gray-600">Note: {p.a.note}</div>}
                    </>
                  ) : !p.leave && !p.holiday && <div className="text-gray-500">{p.kind === 'weekoff' ? 'Weekly off (Sunday).' : 'No attendance recorded.'}</div>}
                </div>
                <div className="space-y-1">
                  {p.leave && (
                    <div>
                      <div><b>{refs.leaveType(p.leave.leave_type_id)?.name}</b> · <Badge tone={p.leave.status === 'approved' ? 'green' : 'amber'}>{p.leave.status.replace('_', ' ')}</Badge></div>
                      <div className="text-gray-600">{fmtDate(p.leave.start_date)}{p.leave.end_date !== p.leave.start_date && ` → ${fmtDate(p.leave.end_date)}`} · {Number(p.leave.days)} day(s){p.leave.half_day && ` · ${halfLabel(p.leave.half_day_session)}`}</div>
                      {p.leave.reason && <div className="text-gray-600">“{p.leave.reason}”</div>}
                    </div>
                  )}
                  {p.earned && (
                    <div className="rounded-lg bg-sky-50 p-2">
                      Comp-off earned: <b>{p.earned.days} day</b>.{' '}
                      {p.earned.remaining <= 0
                        ? <>Used on {p.earned.usedOn.map(fmtDate).join(', ')}.</>
                        : p.earned.usedOn.length ? <>Partly used ({p.earned.usedOn.map(fmtDate).join(', ')}); {p.earned.remaining} day left.</>
                          : <>Not used yet — available.</>}
                    </div>
                  )}
                  {p.kind === 'holiday_worked' && !p.earned && <div className="text-xs text-gray-500">No comp-off credited yet (needs both check-in and check-out).</div>}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
