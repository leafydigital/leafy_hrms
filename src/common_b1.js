// Shared helpers for the attendance, WFH and chat routes.
import net from 'node:net'
import { pool } from './db.js'

export const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next)
export const fail = (res, status, message, extra = {}) => res.status(status).json({ error: message, ...extra })

export const LEADER_ROLES = ['admin', 'hr', 'ceo', 'cto', 'coo']
export const ATTENDANCE_APPROVER_ROLES = ['admin', 'hr']

// ---------------------------------------------------------------- config (server/.env)
const hhmmToMin = (s, fallback) => {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback
}
export const CONFIG = {
  lateAfterMin: hhmmToMin(process.env.LATE_CHECKIN_AFTER, 9 * 60 + 30),   // 09:30 IST
  wfhStartMin: hhmmToMin(process.env.WFH_WINDOW_START, 9 * 60),          // 09:00 IST
  wfhEndMin: hhmmToMin(process.env.WFH_WINDOW_END, 22 * 60),             // 22:00 IST
  timeEditToleranceMin: Number(process.env.TIME_EDIT_TOLERANCE_MIN ?? 15),
  requireLocation: process.env.REQUIRE_LOCATION !== 'false',
  // Roles whose check-in never waits for approval (time, IP and location are still recorded).
  selfApprovedRoles: (process.env.ATTENDANCE_SELF_APPROVED_ROLES || 'admin,hr,ceo,cto,coo').split(',').map((s) => s.trim()).filter(Boolean),
}

// OFFICE_IPS: comma-separated IPv4/IPv6 addresses or CIDR ranges, e.g. "49.37.232.136,2401:4900:1c2a::/48"
const officeList = new net.BlockList()
const officeEntries = (process.env.OFFICE_IPS || '49.37.232.136').split(',').map((s) => s.trim()).filter(Boolean)
for (const entry of officeEntries) {
  const [addr, bits] = entry.split('/')
  const type = net.isIPv6(addr) ? 'ipv6' : 'ipv4'
  if (!net.isIP(addr)) { console.warn(`OFFICE_IPS: ignoring invalid entry "${entry}"`); continue }
  if (bits) officeList.addSubnet(addr, Number(bits), type)
  else officeList.addAddress(addr, type)
}
export const officeIps = officeEntries

export function clientIp(req) {
  // app.set('trust proxy', 1) makes req.ip the real client address behind Railway's proxy.
  let ip = String(req.ip || req.socket?.remoteAddress || '')
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  return ip
}
export function isOfficeIp(ip) {
  if (!net.isIP(ip)) return false
  return officeList.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4')
}

// ---------------------------------------------------------------- India time
const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
export function nowIST(d = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), hhmm: `${p.hour}:${p.minute}` }
}
export const istTimestamp = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`)
export const fmtHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export function fmt12(d) {
  return new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
}
export const isHHMM = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''))
export const isISODate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())
export function datesBetween(start, end) {
  const out = []
  for (let d = new Date(`${start}T00:00:00Z`), stop = new Date(`${end}T00:00:00Z`); d <= stop; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

// ---------------------------------------------------------------- who is calling
export async function getMe(uid) {
  const { rows } = await pool.query(
    `select id, user_id, full_name, email, role, reporting_to, status from public.employees where user_id = $1`, [uid])
  const me = rows[0]
  return me && me.status === 'active' ? me : null
}

/** Middleware: attaches req.me (active employee) or responds 403. Run after auth. */
export const withMe = wrap(async (req, res, next) => {
  req.me = await getMe(req.uid)
  if (!req.me) return fail(res, 403, 'No active employee profile is linked to this login.')
  next()
})

/** Is `me` allowed to approve things for `employeeId` (WFH)? Leaders, or the employee's reporting person. */
export async function isApproverFor(me, employeeId) {
  if (LEADER_ROLES.includes(me.role)) return true
  const { rows } = await pool.query('select reporting_to from public.employees where id = $1', [employeeId])
  return rows[0]?.reporting_to === me.id
}

export async function activeEmployeesByRole(roles) {
  const { rows } = await pool.query(
    `select id, user_id, full_name, email from public.employees where status = 'active' and role = any($1)`, [roles])
  return rows
}
