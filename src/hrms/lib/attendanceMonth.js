// Month attendance data + day classification shared by the employee calendar and the team grid.
import { db } from './db'
import { monthEnd, monthStart } from './format'
import { isCompOffType, isWeeklyOff } from './leaveBalance'

const WORKED = ['present', 'wfh', 'half_day']
export const daysOf = (start, end) => {
  const out = []
  for (let d = new Date(`${start}T00:00:00Z`), e = new Date(`${end}T00:00:00Z`); d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}
export const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Sunday
export const halfLabel = (s) => (s === 'morning' ? 'AM off' : s === 'afternoon' ? 'PM off' : 'Half')
export const leaveAbbr = (name = '') => (isCompOffType({ name }) ? 'C/O' : /lop|unpaid/i.test(name) ? 'LOP' : name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase())

// Half-day attendance without a stored session: a late start means the morning was off.
const sessionFromTimes = (a) => {
  if (a?.half_day_session) return a.half_day_session
  const h = (ts) => (ts ? Number(new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })) : null)
  if (h(a?.check_in) != null && h(a.check_in) >= 12) return 'morning'
  if (h(a?.check_out) != null && h(a.check_out) <= 14) return 'afternoon'
  return null
}

/** Spread comp-off days taken (approved Comp Off leave) over the days earned, oldest first. */
function allocateCompOff(earned, takenLeaves) {
  const units = []
  for (const l of takenLeaves) {
    const ds = daysOf(l.start_date, l.end_date).filter((d) => !isWeeklyOff(d))
    ds.forEach((d) => units.push({ date: d, amount: l.half_day && ds.length === 1 ? 0.5 : 1 }))
  }
  units.sort((a, b) => a.date.localeCompare(b.date))
  const result = {}
  let i = 0, used = 0
  for (const e of [...earned].sort((a, b) => a.earned_on.localeCompare(b.earned_on))) {
    let need = Number(e.days)
    const usedOn = []
    while (need > 0 && i < units.length) {
      const take = Math.min(units[i].amount - used, need)
      usedOn.push(units[i].date)
      need -= take
      used += take
      if (used >= units[i].amount) { i++; used = 0 }
    }
    result[e.earned_on] = { days: Number(e.days), usedOn: [...new Set(usedOn)], remaining: need }
  }
  return result
}

/** Everything needed to draw one month, for one employee (employeeId) or everyone you can see. */
export async function loadMonth({ month, employeeId, leaveTypes }) {
  const first = monthStart(month), last = monthEnd(month)
  const one = (q) => (employeeId ? q.eq('employee_id', employeeId) : q)
  const compType = (leaveTypes ?? []).find(isCompOffType)
  const [att, lv, hol, comp, compLeaves, wfh] = await Promise.all([
    one(db.from('attendance').select('*')).gte('date', first).lte('date', last),
    one(db.from('leaves').select('*')).in('status', ['approved', 'pending', 'cancellation_requested']).lte('start_date', last).gte('end_date', first),
    db.from('company_holidays').select('*').gte('holiday_date', first).lte('holiday_date', last),
    one(db.from('comp_off_ledger').select('*')),
    compType ? one(db.from('leaves').select('*')).eq('leave_type_id', compType.id).eq('status', 'approved') : Promise.resolve({ data: [] }),
    one(db.from('wfh_days').select('*')).gte('wfh_date', first).lte('wfh_date', last),
  ])
  const byEmp = (rows, key) => {
    const m = {}
    for (const r of rows ?? []) { (m[r.employee_id] ??= {})[r[key]] = r }
    return m
  }
  const group = (rows) => {
    const m = {}
    for (const r of rows ?? []) (m[r.employee_id] ??= []).push(r)
    return m
  }
  const compByEmp = group(comp.data), takenByEmp = group(compLeaves.data)
  const compAlloc = {}
  for (const id of new Set([...Object.keys(compByEmp)])) compAlloc[id] = allocateCompOff(compByEmp[id] ?? [], takenByEmp[id] ?? [])
  return {
    month,
    att: byEmp(att.data, 'date'),
    leaves: group(lv.data),
    holidays: Object.fromEntries((hol.data ?? []).map((h) => [h.holiday_date, h])),
    wfh: byEmp(wfh.data, 'wfh_date'),
    comp: compByEmp,
    compAlloc,
  }
}

/** What happened for `employee` on day `d`. kind drives the mark shown in the calendar. */
export function dayInfo(data, employee, d, today) {
  const a = data.att[employee.id]?.[d]
  const weekend = isWeeklyOff(d)
  const holidayToday = !!data.holidays[d]
  // Leave never covers weekends or company holidays (they are not counted as leave days).
  const leave = weekend || holidayToday ? null : (data.leaves[employee.id] ?? []).find((l) => l.start_date <= d && l.end_date >= d) ?? null
  const holiday = data.holidays[d]
  const worked = !!a && WORKED.includes(a.status)
  const half = a?.status === 'half_day' || (leave?.half_day && leave.status === 'approved')
  const session = a?.status === 'half_day' ? sessionFromTimes(a) ?? leave?.half_day_session : leave?.half_day_session
  const earned = data.compAlloc[employee.id]?.[d]
  const wfhRow = data.wfh[employee.id]?.[d]
  let kind = 'none'
  if (holiday) kind = worked ? 'holiday_worked' : 'holiday'
  else if (half) kind = 'half'
  else if (worked) kind = weekend ? 'weekend_worked' : 'present'
  else if (a?.status === 'leave' || (leave && leave.status === 'approved')) kind = 'leave'
  else if (leave) kind = 'leave_pending'
  else if (a?.status === 'absent') kind = 'absent'
  else if (weekend) kind = 'weekoff'
  else if (d < today && d >= (employee.date_of_joining || '0000')) kind = 'unmarked'
  const wfhDay = a?.work_mode === 'wfh' || a?.status === 'wfh' || (wfhRow && !wfhRow.opted_out_at)
  return { d, a, leave, holiday, kind, session, earned, wfhDay, weekend, future: d > today }
}

export function monthSummary(cells, data, employeeId) {
  const s = { present: 0, wfh: 0, leave: 0, half: 0, absent: 0, holidayWorked: 0, unmarked: 0 }
  for (const c of cells) {
    if (!c) continue
    if (c.kind === 'present' || c.kind === 'weekend_worked') { s.present += 1; if (c.wfhDay) s.wfh += 1 }
    if (c.kind === 'half') { s.half += 1; s.present += 0.5 }
    if (c.kind === 'leave') s.leave += 1
    if (c.kind === 'absent') s.absent += 1
    if (c.kind === 'holiday_worked') s.holidayWorked += 1
    if (c.kind === 'unmarked') s.unmarked += 1
  }
  const earned = (data?.comp[employeeId] ?? []).reduce((t, x) => t + Number(x.days), 0)
  const left = Object.values(data?.compAlloc[employeeId] ?? {}).reduce((t, x) => t + x.remaining, 0)
  return { ...s, compEarned: earned, compUsed: earned - left, compLeft: left }
}
