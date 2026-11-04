import { pool } from './db.js'
import nodemailer from 'nodemailer'

const from = process.env.MAIL_FROM || 'hello@leafydigital.in'
const configured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
let transporter
if (configured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

export function emailConfigured() { return Boolean(transporter) }
export async function sendEmail({ to, subject, text, html }) {
  if (!to) return false
  if (!transporter) {
    console.warn(`Email not sent (SMTP not configured): ${subject} -> ${to}`)
    return false
  }
  await transporter.sendMail({ from: `Leafy Digital HRMS <${from}>`, to, subject, text, html })
  return true
}

export function safeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export async function sendLeaveDecisionEmail(leaveId) {
  const { rows } = await pool.query(`select l.status, l.start_date::text, l.end_date::text, l.days, l.review_note,
      e.full_name, e.email, t.name as leave_type
    from public.leaves l join public.employees e on e.id = l.employee_id
    join public.leave_types t on t.id = l.leave_type_id where l.id = $1`, [leaveId])
  const l = rows[0]
  if (!l || !['approved','rejected','cancelled'].includes(l.status)) return
  await sendEmail({ to: l.email, subject: `Leave ${l.status} · Leafy Digital HRMS`,
    text: `Hi ${l.full_name},\n\nYour ${l.leave_type} request (${l.start_date} to ${l.end_date}, ${l.days} day(s)) is ${l.status}.${l.review_note ? `\nReview note: ${l.review_note}` : ''}\n\nLeafy Digital HRMS`,
    html: `<p>Hi ${safeHtml(l.full_name)},</p><p>Your <b>${safeHtml(l.leave_type)}</b> request (${safeHtml(l.start_date)} to ${safeHtml(l.end_date)}, ${safeHtml(l.days)} day(s)) is <b>${safeHtml(l.status)}</b>.</p>${l.review_note ? `<p>Review note: ${safeHtml(l.review_note)}</p>` : ''}<p>Leafy Digital HRMS</p>` })
}

export async function sendLeaveRequestEmail(leaveId) {
  const { rows } = await pool.query(`select l.start_date::text, l.end_date::text, l.days, l.reason,
      e.full_name as employee_name, e.email as employee_email, manager.full_name as manager_name,
      manager.email as manager_email, t.name as leave_type
    from public.leaves l
    join public.employees e on e.id = l.employee_id
    left join public.employees manager on manager.id = e.reporting_to and manager.status = 'active'
    join public.leave_types t on t.id = l.leave_type_id
    where l.id = $1 and l.status = 'pending'`, [leaveId])
  const l = rows[0]
  if (!l?.manager_email) {
    if (l) console.warn(`Leave request ${leaveId} has no active reporting person with a company email.`)
    return false
  }
  return sendEmail({
    to: l.manager_email,
    subject: `Leave request from ${l.employee_name} · Leafy Digital HRMS`,
    text: `Hi ${l.manager_name},\n\n${l.employee_name} (${l.employee_email}) has requested ${l.leave_type} from ${l.start_date} to ${l.end_date} (${l.days} day(s)). Please sign in to HRMS to review the request.${l.reason ? `\nReason: ${l.reason}` : ''}`,
    html: `<p>Hi ${safeHtml(l.manager_name)},</p><p><b>${safeHtml(l.employee_name)}</b> (${safeHtml(l.employee_email)}) has requested <b>${safeHtml(l.leave_type)}</b> from ${safeHtml(l.start_date)} to ${safeHtml(l.end_date)} (${safeHtml(l.days)} day(s)).</p>${l.reason ? `<p>Reason: ${safeHtml(l.reason)}</p>` : ''}<p>Please sign in to HRMS to review the request.</p>`,
  })
}
