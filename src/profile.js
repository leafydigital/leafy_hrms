// My Profile: every employee can see their own record and update their personal contact details.
// Job, pay, bank and identity fields stay with HR. Every change is logged for HR (employee_profile_changes).
import express from 'express'
import { asOwner, pool } from './db.js'
import { notifyEmployees } from './chat.js'
import { activeEmployeesByRole, fail, withMe, wrap } from './common.js'

const EDITABLE = ['phone', 'personal_email', 'address', 'pincode', 'emergency_contact', 'emergency_contact_name', 'emergency_contact_relation', 'blood_group']
const LABELS = {
  phone: 'Mobile number', personal_email: 'Personal email', address: 'Address', pincode: 'PIN code',
  emergency_contact: 'Emergency contact number', emergency_contact_name: 'Emergency contact name',
  emergency_contact_relation: 'Emergency contact relationship', blood_group: 'Blood group',
}
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const mask = (v, keep = 4) => (v ? `${'•'.repeat(Math.max(0, String(v).length - keep))}${String(v).slice(-keep)}` : null)

function validate(v) {
  const f = {}
  const has = (k) => v[k] != null && String(v[k]).trim() !== ''
  if (!has('phone')) f.phone = 'Mobile number is required.'
  else if (!/^(\+?91[\s-]?)?[6-9]\d{9}$/.test(String(v.phone).replace(/\s+/g, ''))) f.phone = 'Enter a valid 10-digit mobile number.'
  if (has('personal_email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.personal_email).trim())) f.personal_email = 'Enter a valid email address.'
  if (has('pincode') && !/^\d{6}$/.test(String(v.pincode).trim())) f.pincode = 'PIN code must be 6 digits.'
  if (has('emergency_contact') && !/^(\+?91[\s-]?)?\d{10}$/.test(String(v.emergency_contact).replace(/\s+/g, ''))) f.emergency_contact = 'Enter a valid 10-digit number.'
  if (has('blood_group') && !BLOOD.includes(String(v.blood_group))) f.blood_group = 'Choose a blood group.'
  if (has('address') && String(v.address).length > 500) f.address = 'Address is too long.'
  return f
}

async function loadProfile(employeeId) {
  const { rows } = await pool.query(
    `select e.id, e.emp_code, e.full_name, e.email, e.phone, e.gender, e.date_of_birth::text, e.address, e.pincode,
            e.personal_email, e.emergency_contact, e.emergency_contact_name, e.emergency_contact_relation, e.blood_group,
            e.aadhaar_number, e.role, e.employment_type, e.date_of_joining::text, e.status,
            e.bank_name, e.bank_account, e.ifsc, e.pan,
            d.name as department, g.name as designation, m.full_name as reporting_to_name, m.email as reporting_to_email
       from public.employees e
       left join public.departments d on d.id = e.department_id
       left join public.designations g on g.id = e.designation_id
       left join public.employees m on m.id = e.reporting_to
      where e.id = $1`, [employeeId])
  const p = rows[0]
  if (!p) return null
  // Identity and bank numbers are shown masked on the profile screen.
  return { ...p, aadhaar_number: mask(p.aadhaar_number), bank_account: mask(p.bank_account), pan: mask(p.pan, 3) }
}

export function profileRouter(auth) {
  const r = express.Router()
  r.use(auth, withMe)

  r.post('/me', wrap(async (req, res) => {
    const profile = await loadProfile(req.me.id)
    const { rows: changes } = await pool.query(
      `select field, old_value, new_value, created_at from public.employee_profile_changes
        where employee_id = $1 order by created_at desc limit 20`, [req.me.id])
    res.json({ profile, editable: EDITABLE, changes: changes.map((c) => ({ ...c, label: LABELS[c.field] ?? c.field })) })
  }))

  r.post('/update', wrap(async (req, res) => {
    const me = req.me
    const input = req.body?.values || {}
    const values = {}
    for (const k of EDITABLE) if (k in input) values[k] = input[k] == null ? null : String(input[k]).trim() || null
    const { rows } = await pool.query(`select ${EDITABLE.map((c) => `"${c}"`).join(', ')} from public.employees where id = $1`, [me.id])
    const current = rows[0]
    const merged = { ...current, ...values }
    const fields = validate(merged)
    if (Object.keys(fields).length) return fail(res, 400, Object.keys(fields).length === 1 ? Object.values(fields)[0] : 'Please correct the highlighted fields.', { fields })
    const changed = Object.keys(values).filter((k) => (current[k] ?? null) !== (values[k] ?? null))
    if (!changed.length) return res.json({ ok: true, changed: [], profile: await loadProfile(me.id) })
    await asOwner(async (c) => {
      await c.query(
        `update public.employees set ${changed.map((k, i) => `"${k}" = $${i + 2}`).join(', ')} where id = $1`,
        [me.id, ...changed.map((k) => values[k])])
      for (const k of changed) {
        await c.query(
          `insert into public.employee_profile_changes (employee_id, changed_by, field, old_value, new_value) values ($1, $1, $2, $3, $4)`,
          [me.id, k, current[k], values[k]])
      }
    })
    const hr = await activeEmployeesByRole(['hr'])
    notifyEmployees(hr.filter((h) => h.id !== me.id).map((h) => h.id), {
      title: 'Profile updated', body: `${me.full_name} updated: ${changed.map((k) => LABELS[k]).join(', ')}.`, link: '/employees',
    })
    res.json({ ok: true, changed, profile: await loadProfile(me.id) })
  }))

  return r
}
