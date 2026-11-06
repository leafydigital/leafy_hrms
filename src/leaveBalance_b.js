// Leave balance rules — the SAME file lives in the frontend at src/hrms/lib/leaveBalance.js.
// If you change a rule, change it in both places so the screen and the server always agree.
//
// Rules (unchanged from the existing Leave page):
// - LOP / Unpaid: no limit.
// - Comp-off: days earned (comp_off_ledger) minus approved + pending comp-off leave.
// - Monthly-accrual types (e.g. Casual Leave 2/month): the month's quota is available only in that month;
//   Interns (probation) get probation_monthly_accrual (default 1) with no carry-forward;
//   regular employees carry forward unused days from previous years if carry_forward is on.
// - Yearly types (days_per_year > 0): days_per_year minus this year's approved + pending.
// - Anything else (no yearly or monthly limit configured): no fixed cap.

const COUNTED = ['approved', 'pending', 'cancellation_requested']
const sumDays = (list) => list.reduce((s, r) => s + Number(r.days || 0), 0)

export const isUnlimitedType = (t) => /lop|unpaid/i.test(t?.name || '')
export const isCompOffType = (t) => /comp.?off/i.test(t?.name || '')

export function isEligible(type, gender) {
  const g = String(gender || '').toLowerCase()
  const rule = String(type?.eligible_gender || 'any').toLowerCase()
  if (rule === 'female' || /maternity/i.test(type?.name || '')) return g === 'female'
  if (rule === 'male' || /paternity/i.test(type?.name || '')) return g === 'male'
  return true
}

/** Working days between two dates, Sundays not counted; a single-day half day is 0.5. */
export function countLeaveDays(start, end, half = false) {
  if (!start || !end || end < start) return 0
  let n = 0
  for (let d = new Date(`${start}T00:00:00Z`), e = new Date(`${end}T00:00:00Z`); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0) n++
  }
  return half && n === 1 ? 0.5 : n
}

/**
 * Balance of one leave type for one employee.
 * @param {object} p
 * @param {object} p.employee   { date_of_joining, employment_type }
 * @param {object} p.type       leave_types row
 * @param {Array}  p.leaves     this employee's leave rows (any status)
 * @param {number} p.compOffEarned total comp-off days earned
 * @param {string} p.asOf       'YYYY-MM-DD' — the month/year the leave falls in (default: today)
 * @returns {{ limited: boolean, left: number|null, used: number, pending: number, carry: number, entitlement: number, period: 'month'|'year'|'total'|null }}
 */
export function leaveBalance({ employee, type, leaves, compOffEarned = 0, asOf }) {
  const day = asOf || new Date().toISOString().slice(0, 10)
  const year = day.slice(0, 4), month = day.slice(0, 7)
  const ofType = (leaves || []).filter((r) => r.leave_type_id === type.id && COUNTED.includes(r.status))
  const approved = ofType.filter((r) => r.status === 'approved')
  const waiting = ofType.filter((r) => r.status !== 'approved')
  const inYear = (l) => l.filter((r) => String(r.start_date).slice(0, 4) === year)
  const inMonth = (l) => l.filter((r) => String(r.start_date).slice(0, 7) === month)
  const used = sumDays(inYear(approved)), pending = sumDays(inYear(waiting))

  if (isUnlimitedType(type)) return { limited: false, left: null, used, pending, carry: 0, entitlement: 0, period: null }

  if (isCompOffType(type)) {
    const taken = sumDays(approved) + sumDays(waiting)
    return { limited: true, left: Math.max(0, Number(compOffEarned || 0) - taken), used: sumDays(approved), pending: sumDays(waiting), carry: 0, entitlement: Number(compOffEarned || 0), period: 'total' }
  }

  const monthly = Number(type.monthly_accrual || 0)
  const intern = String(employee?.employment_type || '').toLowerCase() === 'intern'
  if (monthly > 0) {
    const accrual = intern && type.is_paid ? Number(type.probation_monthly_accrual || 1) : monthly
    let carry = 0
    if (!intern && type.carry_forward) {
      const join = employee?.date_of_joining || `${year}-01-01`
      const joinYear = Number(String(join).slice(0, 4)), joinMonth = Number(String(join).slice(5, 7))
      const priorMonths = Math.max(0, (Number(year) - joinYear) * 12 - (joinMonth - 1))
      const prior = (l) => l.filter((r) => String(r.start_date).slice(0, 4) < year)
      carry = Math.max(0, priorMonths * monthly - sumDays(prior(approved)) - sumDays(prior(waiting)))
    }
    const monthUsed = sumDays(inMonth(approved)), monthPending = sumDays(inMonth(waiting))
    return { limited: true, left: Math.max(0, carry + accrual - monthUsed - monthPending), used: monthUsed, pending: monthPending, carry, entitlement: accrual, period: 'month' }
  }

  const perYear = Number(type.days_per_year || 0)
  if (perYear > 0) return { limited: true, left: Math.max(0, perYear - used - pending), used, pending, carry: 0, entitlement: perYear, period: 'year' }

  return { limited: false, left: null, used, pending, carry: 0, entitlement: 0, period: null }
}
