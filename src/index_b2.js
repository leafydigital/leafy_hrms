import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import cron from 'node-cron'
import { sendEmail, safeHtml, emailConfigured } from './mailer.js'
import { pool, asOwner, friendlyError } from './db.js'
import { runQuery } from './query.js'
import { chatRouter } from './chat.js'
import { attendanceRouter, autoCloseWfhShifts } from './attendance.js'
import { wfhRouter } from './wfh.js'
import { profileRouter } from './profile.js'
import { WEEKLY_OFF } from './leaveBalance.js'

const SECRET = process.env.JWT_SECRET
if (!SECRET || SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters (see server/.env.example).')
  process.exit(1)
}

const app = express()
app.set('trust proxy', 1) // behind Railway / a reverse proxy
app.use(helmet())
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
    allowedHeaders: ['Authorization', 'Content-Type'],
  }),
)
app.use(express.json({ limit: '8mb' }))

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next)
const fail = (res, status, message, extra = {}) => res.status(status).json({ error: message, ...extra })
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10) // keeps login timing the same for unknown emails

function auth(req, res, next) {
  const h = req.headers.authorization || ''
  if (!h.startsWith('Bearer ')) return fail(res, 401, 'Not signed in')
  try {
    const p = jwt.verify(h.slice(7), SECRET)
    req.uid = p.sub
    req.email = p.email
    next()
  } catch {
    fail(res, 401, 'Your session has expired. Please sign in again.')
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('select 1')
    res.json({ ok: true })
  } catch {
    fail(res, 503, 'Database unreachable')
  }
})

// ---------------------------------------------------------------- auth
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } })

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const { rows } = await pool.query(
    `select u.id, u.email, u.password_hash from public.users u
       join public.employees e on e.user_id = u.id
      where lower(u.email) = $1 and e.status = 'active'`,
    [email],
  )
  const user = rows[0]
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH)
  if (!user || !ok) return fail(res, 401, 'Invalid login credentials')
  const token = jwt.sign({ sub: user.id, email: user.email }, SECRET, { expiresIn: '12h' })
  res.json({ access_token: token, user: { id: user.id, email: user.email } })
}))

// ---------------------------------------------------------------- forgot password (4-digit email code)
// 1) forgot-password  : email -> 4-digit code by email (valid 10 min, 5 wrong tries max)
// 2) verify-reset-code: email + code -> one-time reset token (valid 15 min)
// 3) reset-password   : reset token + new password -> password changed, back to login
// Responses never disclose whether an account exists.
const CODE_TTL_MIN = 10
const CODE_MAX_ATTEMPTS = 5
const codeHash = (userId, code) => crypto.createHmac('sha256', SECRET).update(`${userId}:${code}`).digest('hex')
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex')
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in a few minutes.' } })

app.post('/api/auth/forgot-password', resetLimiter, wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid company email address.')
  const { rows } = await pool.query(
    `select u.id as user_id, e.full_name, e.email from public.users u
       join public.employees e on e.user_id = u.id
      where lower(e.email) = $1 and e.status = 'active'`, [email])
  if (rows[0]) {
    const { rows: recent } = await pool.query(
      `select 1 from public.password_reset_codes where user_id = $1 and created_at > now() - interval '60 seconds'`, [rows[0].user_id])
    if (!recent.length) {
      const code = String(crypto.randomInt(0, 10000)).padStart(4, '0')
      await pool.query(`update public.password_reset_codes set used_at = now() where user_id = $1 and used_at is null`, [rows[0].user_id])
      await pool.query(
        `insert into public.password_reset_codes (user_id, code_hash, expires_at) values ($1, $2, now() + make_interval(mins => $3))`,
        [rows[0].user_id, codeHash(rows[0].user_id, code), CODE_TTL_MIN])
      const digits = code.split('').map((d) => `<span style="display:inline-block;width:44px;height:52px;line-height:52px;margin:0 4px;border-radius:8px;background:#f6fbe9;border:1px solid #9ed03e;font-size:28px;font-weight:700;color:#0b0f0a;text-align:center;font-family:Arial,sans-serif">${d}</span>`).join('')
      await sendEmail({ to: rows[0].email, subject: `${code} is your Leafy Digital HRMS password reset code`,
        text: `Hi ${rows[0].full_name},\n\nYour HRMS password reset code is: ${code}\n\nEnter this code in the HRMS app. It expires in ${CODE_TTL_MIN} minutes and can be used once.\n\nIf you did not request this, ignore this email — your password will not change.`,
        html: `<p>Hi ${safeHtml(rows[0].full_name)},</p><p>Use this code to reset your HRMS password:</p><p style="margin:20px 0">${digits}</p><p>It expires in ${CODE_TTL_MIN} minutes and can be used once.</p><p>If you did not request this, ignore this email — your password will not change.</p>` })
        .catch((e) => console.error('Reset code email failed:', e.message))
    }
  }
  res.json({ ok: true, message: 'If an active account exists for that email, a 4-digit code has been sent. Check your inbox (and spam).' })
}))

app.post('/api/auth/verify-reset-code', resetLimiter, wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const code = String(req.body?.code || '').trim()
  const invalid = () => fail(res, 400, 'That code is incorrect or has expired.', { field: 'code' })
  if (!/^\d{4}$/.test(code)) return fail(res, 400, 'Enter the 4-digit code from the email.', { field: 'code' })
  const { rows } = await pool.query(
    `select c.id, c.user_id, c.code_hash, c.attempts from public.password_reset_codes c
       join public.users u on u.id = c.user_id
       join public.employees e on e.user_id = u.id and e.status = 'active'
      where lower(e.email) = $1 and c.used_at is null and c.verified_at is null and c.expires_at > now()
      order by c.created_at desc limit 1`, [email])
  const row = rows[0]
  if (!row) return invalid()
  if (row.attempts >= CODE_MAX_ATTEMPTS) {
    await pool.query('update public.password_reset_codes set used_at = now() where id = $1', [row.id])
    return fail(res, 400, 'Too many wrong codes. Request a new code.', { field: 'code', expired: true })
  }
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(codeHash(row.user_id, code), 'hex'))
  if (!ok) {
    const { rows: upd } = await pool.query('update public.password_reset_codes set attempts = attempts + 1 where id = $1 returning attempts', [row.id])
    const left = CODE_MAX_ATTEMPTS - upd[0].attempts
    if (left <= 0) {
      await pool.query('update public.password_reset_codes set used_at = now() where id = $1', [row.id])
      return fail(res, 400, 'Too many wrong codes. Request a new code.', { field: 'code', expired: true })
    }
    return fail(res, 400, `That code is incorrect. ${left} attempt${left === 1 ? '' : 's'} left.`, { field: 'code' })
  }
  const resetToken = crypto.randomBytes(32).toString('hex')
  await pool.query(
    `update public.password_reset_codes set verified_at = now(), reset_token_hash = $2, reset_expires_at = now() + interval '15 minutes' where id = $1`,
    [row.id, sha256(resetToken)])
  res.json({ ok: true, reset_token: resetToken })
}))

app.post('/api/auth/reset-password', resetLimiter, wrap(async (req, res) => {
  const token = String(req.body?.token || '')
  const password = req.body?.password
  if (token.length < 32) return fail(res, 400, 'Your reset session has expired. Request a new code.')
  if (typeof password !== 'string' || password.length < 8) return fail(res, 400, 'Use at least 8 characters.', { field: 'password' })
  const { rows } = await pool.query(
    `select id, user_id from public.password_reset_codes
      where reset_token_hash = $1 and used_at is null and verified_at is not null and reset_expires_at > now()`, [sha256(token)])
  if (!rows[0]) return fail(res, 400, 'Your reset session has expired. Request a new code.')
  await asOwner(async (c) => {
    await c.query('update public.users set password_hash = $1 where id = $2', [await bcrypt.hash(password, 10), rows[0].user_id])
    await c.query('update public.password_reset_codes set used_at = now() where user_id = $1 and used_at is null', [rows[0].user_id])
    await c.query('update public.password_reset_tokens set used_at = now() where user_id = $1 and used_at is null', [rows[0].user_id])
  })
  res.json({ ok: true, message: 'Password changed. Sign in with your new password.' })
}))

app.post('/api/auth/change-password', auth, wrap(async (req, res) => {
  const { current_password: current, password } = req.body || {}
  if (typeof password !== 'string' || password.length < 8) return fail(res, 400, 'Use at least 8 characters.')
  const { rows } = await pool.query('select password_hash from public.users where id = $1', [req.uid])
  if (!rows[0] || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) {
    return fail(res, 400, 'Your current password is incorrect.')
  }
  await pool.query('update public.users set password_hash = $1 where id = $2', [await bcrypt.hash(password, 10), req.uid])
  res.json({ ok: true })
}))

// ---------------------------------------------------------------- data (RLS-enforced)
app.post('/api/db', auth, wrap(async (req, res) => {
  const { status, body } = await runQuery(req.uid, req.body || {})
  res.status(status).json(body)
}))

// ---------------------------------------------------------------- employee logins (Admin / HR)
function validateEmployee(v, { isNew }) {
  const f = {}
  const has = (k) => v[k] != null && String(v[k]).trim() !== ''
  if (!has('emp_code')) f.emp_code = 'Employee code is required.'
  else if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]{1,39}$/.test(String(v.emp_code))) f.emp_code = 'Use letters, numbers and - _ / only (2–40 characters).'
  if (!has('full_name')) f.full_name = 'Full name is required.'
  if (isNew) {
    if (!has('email')) f.email = 'Work email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.email))) f.email = 'Enter a valid email address.'
  }
  if (has('personal_email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.personal_email))) f.personal_email = 'Enter a valid email address.'
  if (has('phone') && !/^(\+?91[\s-]?)?[6-9]\d{9}$/.test(String(v.phone).replace(/\s+/g, ''))) f.phone = 'Enter a valid 10-digit mobile number.'
  if (has('emergency_contact') && !/^(\+?91[\s-]?)?\d{10}$/.test(String(v.emergency_contact).replace(/\s+/g, ''))) f.emergency_contact = 'Enter a valid 10-digit number.'
  if (has('aadhaar_number') && !/^\d{12}$/.test(String(v.aadhaar_number).replace(/\s+/g, ''))) f.aadhaar_number = 'Aadhaar must be 12 digits.'
  if (has('pincode') && !/^\d{6}$/.test(String(v.pincode))) f.pincode = 'PIN code must be 6 digits.'
  if (has('pan') && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(String(v.pan))) f.pan = 'PAN format is ABCDE1234F.'
  if (has('ifsc') && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(String(v.ifsc))) f.ifsc = 'IFSC format is ABCD0123456.'
  if (!has('department_id')) f.department_id = 'Choose a department.'
  if (!has('designation_id')) f.designation_id = 'Choose a designation.'
  if (!has('role')) f.role = 'Choose an access role.'
  return f
}

function uniqueField(e) {
  const c = String(e.constraint || '')
  if (c.includes('emp_code')) return 'emp_code'
  if (c.includes('email')) return 'email'
  return null
}

const EMP_COLS = [
  'emp_code', 'full_name', 'phone', 'gender', 'date_of_birth', 'address', 'emergency_contact',
  'personal_email', 'emergency_contact_name', 'emergency_contact_relation', 'blood_group', 'pincode', 'aadhaar_number',
  'department_id', 'designation_id', 'reporting_to', 'role', 'employment_type', 'date_of_joining', 'status', 'bank_name', 'bank_account', 'ifsc', 'pan',
]

app.post('/api/admin/manage-employee-login', auth, async (req, res) => {
  try {
    const { rows: meRows } = await pool.query(
      `select role, status from public.employees where user_id = $1`, [req.uid])
    const me = meRows[0]
    if (!me || me.status !== 'active' || !['admin', 'hr'].includes(me.role)) {
      return fail(res, 403, 'Only Admin or HR can do this')
    }
    const body = req.body || {}

    if (body.action === 'reset_password') {
      const { rows } = await pool.query('select user_id, role from public.employees where id = $1', [body.employee_id])
      const target = rows[0]
      if (!target?.user_id) return fail(res, 400, 'This employee has no login yet')
      if (target.role === 'admin' && me.role !== 'admin') return fail(res, 403, 'Only Admin can reset an Admin password')
      if (typeof body.password !== 'string' || body.password.length < 8) return fail(res, 400, 'Password must be at least 8 characters')
      await pool.query('update public.users set password_hash = $1 where id = $2', [await bcrypt.hash(body.password, 10), target.user_id])
      const { rows: targetRows } = await pool.query('select full_name, email from public.employees where id = $1', [body.employee_id])
      if (targetRows[0]) await sendEmail({ to: targetRows[0].email, subject: 'Your Leafy Digital HRMS password was reset',
        text: `Hi ${targetRows[0].full_name},\n\nAn administrator reset your HRMS password. Temporary password: ${body.password}\nPlease sign in and change it immediately.`,
        html: `<p>Hi ${safeHtml(targetRows[0].full_name)},</p><p>An administrator reset your HRMS password.</p><p><b>Temporary password:</b> ${safeHtml(body.password)}</p><p>Please sign in and change it immediately.</p>` })
      return res.json({ ok: true, email_sent: emailConfigured() })
    }

    const email = String(body.email || '').trim().toLowerCase()
    const { password } = body
    const employee = body.employee || {}
    if (employee.emp_code != null) employee.emp_code = String(employee.emp_code).trim()

    // Field-level validation so the form can show the exact problem under each field.
    const fields = validateEmployee({ ...employee, email }, { isNew: true })
    if (typeof password !== 'string' || password.length < 8) fields.password = 'Temporary password must be at least 8 characters.'
    if (!fields.email) {
      const { rows: dupEmail } = await pool.query(
        `select e.full_name, e.emp_code from public.users u left join public.employees e on e.user_id = u.id where lower(u.email) = $1
         union all select full_name, emp_code from public.employees where lower(email) = $1 limit 1`, [email])
      if (dupEmail[0]) fields.email = dupEmail[0].full_name
        ? `This email is already used by ${dupEmail[0].full_name}${dupEmail[0].emp_code ? ` (${dupEmail[0].emp_code})` : ''}.`
        : 'A login with this email already exists.'
    }
    if (!fields.emp_code && employee.emp_code) {
      const { rows: dupCode } = await pool.query(
        'select full_name, email from public.employees where lower(emp_code) = lower($1) limit 1', [employee.emp_code])
      if (dupCode[0]) fields.emp_code = `Employee code ${employee.emp_code} is already assigned to ${dupCode[0].full_name} (${dupCode[0].email}).`
    }
    if (Object.keys(fields).length) {
      return fail(res, 400, Object.keys(fields).length === 1 ? Object.values(fields)[0] : 'Please correct the highlighted fields.', { fields })
    }
    if (employee.role === 'admin' && me.role !== 'admin') return fail(res, 403, 'Only Admin can create Admin users', { fields: { role: 'Only Admin can create Admin users.' } })
    if (['ceo','cto','coo'].includes(employee.role) && !['admin','ceo','cto','coo'].includes(me.role)) return fail(res, 403, 'Only Admin or senior leadership can assign a senior leadership role', { fields: { role: 'Only Admin or senior leadership can assign this role.' } })

    const cols = EMP_COLS.filter((c) => employee[c] !== undefined)
    const hash = await bcrypt.hash(password, 10)
    const row = await asOwner(async (c) => {
      const u = await c.query('insert into public.users (email, password_hash) values ($1, $2) returning id', [email, hash])
      const names = ['email', 'user_id', ...cols]
      const vals = [email, u.rows[0].id, ...cols.map((k) => employee[k])]
      const ins = await c.query(
        `insert into public.employees (${names.map((n) => `"${n}"`).join(', ')})
         values (${names.map((_, i) => `$${i + 1}`).join(', ')}) returning id, emp_code, full_name, email`,
        vals,
      )
      return ins.rows[0]
    })
    await sendEmail({ to: email, subject: 'Your Leafy Digital HRMS account',
      text: `Hi ${employee.full_name},\n\nYour Leafy Digital HRMS account has been created.\nLogin email: ${email}\nTemporary password: ${password}\n\nPlease sign in and change your password immediately.`,
      html: `<p>Hi ${safeHtml(employee.full_name)},</p><p>Your Leafy Digital HRMS account has been created.</p><p><b>Login email:</b> ${safeHtml(email)}<br><b>Temporary password:</b> ${safeHtml(password)}</p><p>Please sign in and change your password immediately.</p>` })
    res.json({ employee: row, email_sent: emailConfigured() })
  } catch (e) {
    if (e.code === '23505') {
      const field = uniqueField(e)
      const msg = field === 'emp_code' ? 'This employee code is already assigned to another employee.'
        : field === 'email' ? 'An employee or login with this email already exists.'
        : 'A record with these details already exists.'
      return fail(res, 400, msg, field ? { fields: { [field]: msg } } : {})
    }
    fail(res, 400, friendlyError(e))
  }
})

// Payroll may need unpaid-leave totals, but Accounts must not receive leave reasons or other private details.
app.post('/api/admin/payroll-lop-summary', auth, wrap(async (req, res) => {
  const month = String(req.body?.month || '')
  if (!/^\d{4}-\d{2}$/.test(month) || Number(month.slice(5, 7)) < 1 || Number(month.slice(5, 7)) > 12) {
    return fail(res, 400, 'Month must be in YYYY-MM format')
  }
  const { rows: roleRows } = await pool.query('select role, status from public.employees where user_id = $1', [req.uid])
  const me = roleRows[0]
  if (!me || me.status !== 'active' || !['admin', 'hr', 'accounts'].includes(me.role)) {
    return fail(res, 403, 'Not allowed to generate payroll summaries')
  }
  const first = `${month}-01`
  const [year, mon] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const last = `${month}-${String(lastDay).padStart(2, '0')}`
  const { rows: leaveRows } = await pool.query(
    `select l.employee_id, l.start_date::text, l.end_date::text, l.half_day
       from public.leaves l join public.leave_types t on t.id = l.leave_type_id
      where l.status = 'approved' and t.is_paid = false
        and l.start_date <= $2::date and l.end_date >= $1::date`, [first, last],
  )
  const { rows: holidayRows } = await pool.query(
    'select holiday_date::text from public.company_holidays where holiday_date between $1::date and $2::date', [first, last],
  )
  const holidays = new Set(holidayRows.map((r) => r.holiday_date))
  const lop_days = {}
  for (const leave of leaveRows) {
    const start = leave.start_date < first ? first : leave.start_date
    const end = leave.end_date > last ? last : leave.end_date
    let days = 0
    for (let cursor = new Date(`${start}T00:00:00Z`), stop = new Date(`${end}T00:00:00Z`); cursor <= stop; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const iso = cursor.toISOString().slice(0, 10)
      if (!WEEKLY_OFF.includes(cursor.getUTCDay()) && !holidays.has(iso)) days += 1
    }
    if (leave.half_day && start === end && days > 0) days = 0.5
    lop_days[leave.employee_id] = (lop_days[leave.employee_id] || 0) + days
  }
  res.json({ month, lop_days })
}))

// Daily overdue-task email at 09:00 IST. One email per task per IST date.
cron.schedule('0 9 * * *', async () => {
  try {
    const { rows } = await pool.query(`select t.id, t.title, t.due_date::text, e.full_name, e.email
      from public.tasks t join public.employees e on e.id = t.assignee_id
      where t.due_date < (now() at time zone 'Asia/Kolkata')::date and t.status <> 'done' and e.status = 'active'`)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    for (const t of rows) {
      const key = `task-overdue:${t.id}:${today}`
      const inserted = await pool.query('insert into public.email_notification_log (notification_key, recipient) values ($1, $2) on conflict do nothing returning id', [key, t.email])
      if (!inserted.rowCount) continue
      try {
        const sent = await sendEmail({ to: t.email, subject: `Overdue task reminder: ${t.title}`,
          text: `Hi ${t.full_name},\n\nYour task "${t.title}" was due on ${t.due_date} and is not marked complete. Please update its status in HRMS.`,
          html: `<p>Hi ${safeHtml(t.full_name)},</p><p>Your task <b>${safeHtml(t.title)}</b> was due on ${safeHtml(t.due_date)} and is not marked complete. Please update its status in HRMS.</p>` })
        if (!sent) await pool.query('delete from public.email_notification_log where notification_key = $1', [key])
      } catch (e) { await pool.query('delete from public.email_notification_log where notification_key = $1', [key]); throw e }
    }
  } catch (e) { console.error('Overdue task reminder job failed:', e.message) }
}, { timezone: 'Asia/Kolkata' })

// Reminder at 18:00 IST for employees who checked in but have not checked out.
cron.schedule('0 18 * * *', async () => {
  try {
    const { rows } = await pool.query(`select a.id, a.date::text, e.full_name, e.email from public.attendance a
      join public.employees e on e.id = a.employee_id
      where a.date = (now() at time zone 'Asia/Kolkata')::date and a.check_in is not null and a.check_out is null and e.status = 'active'`)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    for (const a of rows) {
      const key = `checkout-reminder:${a.id}:${today}`
      const inserted = await pool.query('insert into public.email_notification_log (notification_key, recipient) values ($1, $2) on conflict do nothing returning id', [key, a.email])
      if (!inserted.rowCount) continue
      try {
        const sent = await sendEmail({ to: a.email, subject: 'Reminder: Please mark your HRMS check-out',
          text: `Hi ${a.full_name},\n\nThis is a friendly reminder that your attendance shows a check-in today but no check-out. Please remember to mark your check-out in HRMS.`,
          html: `<p>Hi ${safeHtml(a.full_name)},</p><p>This is a friendly reminder that your attendance shows a check-in today but no check-out. Please remember to mark your check-out in HRMS.</p>` })
        if (!sent) await pool.query('delete from public.email_notification_log where notification_key = $1', [key])
      } catch (e) { await pool.query('delete from public.email_notification_log where notification_key = $1', [key]); throw e }
    }
  } catch (e) { console.error('Checkout reminder job failed:', e.message) }
}, { timezone: 'Asia/Kolkata' })

// ---------------------------------------------------------------- attendance, WFH, chat
app.use('/api/attendance', attendanceRouter(auth))
app.use('/api/wfh', wfhRouter(auth))
app.use('/api/chat', chatRouter(auth))
app.use('/api/profile', profileRouter(auth))

// 22:00 IST: work-from-home access ends — close WFH shifts that are still open.
cron.schedule(`${Number((process.env.WFH_WINDOW_END || '22:00').split(':')[1] || 0)} ${Number((process.env.WFH_WINDOW_END || '22:00').split(':')[0])} * * *`, async () => {
  try {
    const n = await autoCloseWfhShifts()
    if (n) console.log(`Auto-closed ${n} WFH shift(s).`)
  } catch (e) { console.error('WFH auto check-out failed:', e.message) }
}, { timezone: 'Asia/Kolkata' })

app.use('/api', (_req, res) => fail(res, 404, 'Not found'))
app.use((err, _req, res, _next) => {
  console.error(err)
  fail(res, err.status || 500, err.status ? err.message : 'Something went wrong on the server.')
})

const port = Number(process.env.PORT || 4000)
app.listen(port, () => console.log(`Leafy HRMS API listening on :${port}`))
