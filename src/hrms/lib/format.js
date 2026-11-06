const IST = 'Asia/Kolkata'

export const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n || 0))

export const inr2 = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0))

// 'yyyy-mm-dd' for today in India, regardless of the browser's timezone
export const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date())

export const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d)
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const fmtTime = (ts) =>
  ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: IST }) : '—'

// 'HH:MM' (India time) for an <input type="time">, and the reverse
export const timeInput = (ts) =>
  ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: IST, hour12: false }) : ''
export const toTimestamp = (date, hhmm) => (hhmm ? `${date}T${hhmm}:00+05:30` : null)

export const monthLabel = (d) =>
  new Date(`${String(d).slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

// '2026-10' → '2026-10-01'
export const monthStart = (ym) => `${ym.slice(0, 7)}-01`
export const currentMonth = () => todayIST().slice(0, 7)
export const daysInMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
export const monthEnd = (ym) => `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}`

// Leave days between two dates inclusive: Saturdays, Sundays and company holidays are not counted.
export { countLeaveDays as leaveDays } from './leaveBalance'

export const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')

export const label = (s = '') => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)

export const randomPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('') + '#7'
}
