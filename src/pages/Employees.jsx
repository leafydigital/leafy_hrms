import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, KeyRound, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { can } from '../lib/permissions'
import { fmtDate, initials, randomPassword } from '../lib/format'
import { Empty, FieldError, FormGrid, Loading, Modal, PageHeader, StatusBadge, cleanValues, confirmDelete, focusFirstError, useToast } from '../components/ui'

const GENDERS = ['Male', 'Female', 'Other'].map((g) => ({ value: g, label: g }))
const TYPES = ['Full-time', 'Part-time', 'Intern', 'Contract'].map((g) => ({ value: g, label: g }))
const STATUSES = ['active', 'inactive', 'resigned'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))

async function callFn(body) {
  const { data, error } = await db.functions.invoke('manage-employee-login', { body })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).error ?? msg } catch { /* keep default */ }
    const err = new Error(msg)
    err.fields = error.fields
    throw err
  }
  if (data?.error) throw new Error(data.error)
  return data
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FIELD_ORDER = ['emp_code', 'full_name', 'email', 'phone', 'gender', 'date_of_birth', 'personal_email', 'emergency_contact',
  'emergency_contact_name', 'emergency_contact_relation', 'blood_group', 'aadhaar_number', 'address', 'pincode',
  'department_id', 'designation_id', 'role', 'employment_type', 'date_of_joining', 'reporting_to', 'status',
  'bank_name', 'bank_account', 'ifsc', 'pan', 'password']

/** Same rules as the API (server/src/index.js validateEmployee) plus duplicate checks against the loaded list. */
function validateEmployee(v, { isNew, rows, selfId, password }) {
  const f = {}
  const has = (k) => v[k] != null && String(v[k]).trim() !== ''
  const code = String(v.emp_code ?? '').trim()
  if (!code) f.emp_code = 'Employee code is required.'
  else if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]{1,39}$/.test(code)) f.emp_code = 'Use letters, numbers and - _ / only (2–40 characters).'
  else {
    const dup = (rows ?? []).find((r) => r.id !== selfId && String(r.emp_code ?? '').toLowerCase() === code.toLowerCase())
    if (dup) f.emp_code = `Employee code ${code} is already assigned to ${dup.full_name} (${dup.email}).`
  }
  if (!has('full_name')) f.full_name = 'Full name is required.'
  if (isNew) {
    const email = String(v.email ?? '').trim().toLowerCase()
    if (!email) f.email = 'Work email is required.'
    else if (!EMAIL_RE.test(email)) f.email = 'Enter a valid email address.'
    else {
      const dup = (rows ?? []).find((r) => String(r.email ?? '').toLowerCase() === email)
      if (dup) f.email = `This email is already used by ${dup.full_name} (${dup.emp_code}).`
    }
    if (String(password ?? '').length < 8) f.password = 'Temporary password must be at least 8 characters.'
  }
  if (has('personal_email') && !EMAIL_RE.test(String(v.personal_email).trim())) f.personal_email = 'Enter a valid email address.'
  if (has('phone') && !/^(\+?91[\s-]?)?[6-9]\d{9}$/.test(String(v.phone).replace(/\s+/g, ''))) f.phone = 'Enter a valid 10-digit mobile number.'
  if (has('emergency_contact') && !/^(\+?91[\s-]?)?\d{10}$/.test(String(v.emergency_contact).replace(/\s+/g, ''))) f.emergency_contact = 'Enter a valid 10-digit number.'
  if (has('aadhaar_number') && !/^\d{12}$/.test(String(v.aadhaar_number).replace(/\s+/g, ''))) f.aadhaar_number = 'Aadhaar must be 12 digits.'
  if (has('pincode') && !/^\d{6}$/.test(String(v.pincode))) f.pincode = 'PIN code must be 6 digits.'
  if (has('pan') && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(String(v.pan))) f.pan = 'PAN format is ABCDE1234F.'
  if (has('ifsc') && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(String(v.ifsc))) f.ifsc = 'IFSC format is ABCD0123456.'
  if (!has('department_id')) f.department_id = 'Choose a department.'
  if (!has('designation_id')) f.designation_id = 'Choose a designation.'
  if (!has('role')) f.role = 'Choose an access role.'
  if (!has('employment_type')) f.employment_type = 'Choose an employment type.'
  if (!has('status')) f.status = 'Choose a status.'
  return f
}

export default function Employees() {
  const { me, role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const canEdit = can(role, 'employees', 'edit')
  const canCreate = can(role, 'employees', 'create')
  const canDelete = can(role, 'employees', 'remove')

  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [status, setStatus] = useState('active')
  const [editing, setEditing] = useState(null) // {} = new
  const [values, setValues] = useState({})
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [creds, setCreds] = useState(null)
  const [errors, setErrors] = useState({})
  const [experiences, setExperiences] = useState([])
  const [customDefs, setCustomDefs] = useState([])
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState('text')

  const load = useCallback(async () => {
    const { data, error } = await db
      .from('employees')
      .select('*, department:departments(name), designation:designations(name)')
      .order('emp_code')
    if (error) toast.error(error.message)
    setRows(data ?? [])
    const { data: defs } = await db.from('employee_custom_field_definitions').select('*').order('field_name')
    setCustomDefs(defs ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (rows ?? []).filter(
      (r) =>
        (!dept || r.department_id === dept) &&
        (!status || r.status === status) &&
        (!n || [r.full_name, r.email, r.emp_code, r.phone].some((v) => (v ?? '').toLowerCase().includes(n))),
    )
  }, [rows, q, dept, status])

  const isNew = editing && !editing.id
  // HR can never touch Admin accounts (the database enforces this too)
  const locked = editing?.id && (!canEdit || (role !== 'admin' && editing.role === 'admin'))

  const openNew = () => {
    const codes = (rows ?? []).map((r) => Number(String(r.emp_code ?? '').match(/(\d+)$/)?.[1] ?? 0))
    const nextCode = `LEAFY-TVM-${String(Math.max(0, ...codes) + 1).padStart(3, '0')}`
    setValues({ emp_code: nextCode, employment_type: 'Full-time', status: 'active', role: 'employee', date_of_joining: new Date().toISOString().slice(0, 10) })
    setExperiences([])
    setPassword(randomPassword())
    setErrors({})
    setEditing({})
  }
  const openEdit = async (r) => {
    setValues(Object.fromEntries(Object.keys(r).map((k) => [k, r[k] ?? ''])))
    setErrors({})
    setEditing(r)
    const { data } = await db.from('employee_experiences').select('*').eq('employee_id', r.id).order('created_at')
    setExperiences((data ?? []).map((x) => ({ ...x, custom_fields: typeof x.custom_fields === 'string' ? JSON.parse(x.custom_fields || '{}') : (x.custom_fields ?? {}) })))
  }

  const roleOptions = [
    { value: 'employee', label: 'Employee' },
    { value: 'hr', label: 'HR' },
    { value: 'accounts', label: 'Accounts' },
    ...(role === 'admin' ? [{ value: 'admin', label: 'Admin (full access)' }] : []),
    ...(role === 'admin' ? [{ value: 'ceo', label: 'CEO' }, { value: 'cto', label: 'CTO' }, { value: 'coo', label: 'COO' }] : []),
  ]

  const personal = [
    { name: 'emp_code', label: 'Employee code', required: true, disabled: locked, hint: isNew ? 'Generated automatically; editable before saving.' : 'Editable employee identifier.' },
    { name: 'full_name', label: 'Full name', required: true, disabled: locked },
    { name: 'email', label: 'Work email', type: 'email', required: true, disabled: locked || !isNew, hint: isNew ? 'This is also their login.' : undefined },
    { name: 'phone', label: 'Phone', type: 'tel', disabled: locked },
    { name: 'gender', label: 'Gender', type: 'select', options: GENDERS, disabled: locked },
    { name: 'date_of_birth', label: 'Date of birth', type: 'date', disabled: locked },
    { name: 'personal_email', label: 'Personal email', type: 'email', disabled: locked },
    { name: 'emergency_contact', label: 'Emergency contact number', type: 'tel', disabled: locked },
    { name: 'emergency_contact_name', label: 'Emergency contact name', disabled: locked },
    { name: 'emergency_contact_relation', label: 'Emergency contact relationship', disabled: locked },
    { name: 'blood_group', label: 'Blood group', type: 'select', options: ['A+','A-','B+','B-','AB+','AB-','O+','O-'].map((x) => ({ value: x, label: x })), disabled: locked },
    { name: 'aadhaar_number', label: 'Aadhaar number', disabled: locked, hint: 'Stored in the private employee record; restrict access.' },
    { name: 'address', label: 'Address', type: 'textarea', rows: 2, disabled: locked, full: true },
    { name: 'pincode', label: 'PIN code', disabled: locked, hint: 'Automatically filled when a six-digit PIN is found in the address; editable.' },
  ]

  const job = [
    {
      name: 'department_id', label: 'Department', type: 'select', required: true, disabled: locked,
      options: (r) => r.departments.map((d) => ({ value: d.id, label: d.name })),
      onChange: () => ({ designation_id: '' }),
    },
    {
      name: 'designation_id', label: 'Designation', type: 'select', required: true, disabled: locked || !values.department_id,
      options: (r) => r.designations.filter((d) => d.department_id === values.department_id).map((d) => ({ value: d.id, label: d.name })),
      onChange: (val, _v, r) => {
        const d = r.designations.find((x) => x.id === val)
        // suggest the access role from the designation (HR can't hand out Admin)
        if (isNew && d) return { role: ['admin','ceo','cto','coo'].includes(d.default_role) && role !== 'admin' ? 'employee' : d.default_role }
        return {}
      },
    },
    { name: 'role', label: 'Access role', type: 'select', required: true, options: roleOptions, disabled: locked, hint: 'Controls what they can see and do.' },
    { name: 'employment_type', label: 'Employment type', type: 'select', options: TYPES, required: true, disabled: locked },
    { name: 'date_of_joining', label: 'Date of joining', type: 'date', disabled: locked },
    {
      name: 'reporting_to', label: 'Reports to', type: 'select', emptyLabel: '— None —', disabled: locked,
      options: (r) => r.activeStaff.filter((e) => e.id !== editing?.id).map((e) => ({ value: e.id, label: e.full_name })),
    },
    { name: 'status', label: 'Status', type: 'select', options: STATUSES, required: true, disabled: locked },
  ]

  const bank = [
    { name: 'bank_name', label: 'Bank name', disabled: locked },
    { name: 'bank_account', label: 'Account number', disabled: locked },
    { name: 'ifsc', label: 'IFSC', disabled: locked },
    { name: 'pan', label: 'PAN', disabled: locked },
  ]

  const showErrors = (fields, message) => {
    setErrors(fields)
    focusFirstError(fields, FIELD_ORDER)
    const n = Object.keys(fields).length
    toast.error(message ?? (n === 1 ? Object.values(fields)[0] : `Please correct the ${n} highlighted fields.`))
  }

  const save = async (e) => {
    e.preventDefault()
    const found = validateEmployee(values, { isNew, rows, selfId: editing.id, password })
    if (Object.keys(found).length) return showErrors(found)
    setErrors({})
    setSaving(true)
    try {
      const allFields = [...personal, ...job, ...bank]
      const payload = cleanValues(allFields, values)
      if (payload.emp_code) payload.emp_code = String(payload.emp_code).trim()
      let employeeId = editing.id
      if (isNew) {
        if (password.length < 8) throw new Error('Password must be at least 8 characters')
        const result = await callFn({ email: values.email.trim(), password, employee: payload })
        employeeId = result.employee?.id
        setCreds({ email: values.email.trim(), password, name: values.full_name })
        toast.success('Employee added')
      } else {
        delete payload.email
        const { error } = await db.from('employees').update(payload).eq('id', editing.id)
        if (error) {
          const err = new Error(error.message)
          if (error.field) err.fields = { [error.field]: error.message }
          throw err
        }
        toast.success('Changes saved')
      }
      if (employeeId) {
        for (const exp of experiences) {
          const expPayload = { employee_id: employeeId, company_name: exp.company_name || null, period: exp.period || null, experience_letter_name: exp.experience_letter_name || null, experience_letter_data: exp.experience_letter_data || null, payslip_name: exp.payslip_name || null, payslip_data: exp.payslip_data || null, custom_fields: JSON.stringify(exp.custom_fields ?? {}) }
          const result = exp.id ? await db.from('employee_experiences').update(expPayload).eq('id', exp.id) : await db.from('employee_experiences').insert(expPayload)
          if (result.error) throw result.error
        }
      }
      setEditing(null)
      await load()
      refs.reload()
    } catch (err) {
      if (err.fields && Object.keys(err.fields).length) showErrors(err.fields, err.message)
      else toast.error(err.message)
    }
    setSaving(false)
  }

  const resetPassword = async () => {
    if (!window.confirm(`Generate a new password for ${editing.full_name}?`)) return
    const pw = randomPassword()
    try {
      await callFn({ action: 'reset_password', employee_id: editing.id, password: pw })
      setCreds({ email: editing.email, password: pw, name: editing.full_name, reset: true })
      setEditing(null)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const remove = async () => {
    if (!confirmDelete(`${editing.full_name} and all their leave, attendance and payroll records`)) return
    const { error } = await db.from('employees').delete().eq('id', editing.id)
    if (error) return toast.error(error.message)
    toast.success('Employee deleted')
    setEditing(null)
    await load()
    refs.reload()
  }

  const addExperience = () => setExperiences((items) => [...items, { company_name: '', period: '', experience_letter_name: '', experience_letter_data: '', payslip_name: '', payslip_data: '', custom_fields: {} }])
  const updateExperience = (index, patch) => setExperiences((items) => items.map((x, i) => i === index ? { ...x, ...patch } : x))
  const readFile = (file, callback) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { toast.error('Each document/image must be 2 MB or smaller.'); return }
    const reader = new FileReader()
    reader.onload = () => callback(String(reader.result || ''), file.name)
    reader.onerror = () => toast.error('Could not read the selected file.')
    reader.readAsDataURL(file)
  }
  const addCustomField = async () => {
    const name = newFieldName.trim()
    if (!name) return toast.error('Enter a field heading first.')
    const { error } = await db.from('employee_custom_field_definitions').insert({ field_name: name, field_type: newFieldType })
    if (error) return toast.error(error.message)
    const { data } = await db.from('employee_custom_field_definitions').select('*').order('field_name')
    setCustomDefs(data ?? [])
    setNewFieldName('')
    toast.success('Custom experience field added')
  }
  useEffect(() => {
    const match = String(values.address ?? '').match(/(?:^|\D)(\d{6})(?:\D|$)/)
    if (match && values.pincode !== match[1]) setValues((v) => ({ ...v, pincode: match[1] }))
  }, [values.address])

  return (
    <>
      <PageHeader title="Employees" subtitle={canEdit ? 'Add and manage employee details.' : 'Read-only view of employee details.'}>
        {canCreate && (
          <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Add employee</button>
        )}
      </PageHeader>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9" placeholder="Search name, email, code…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            {refs.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <span className="ml-auto text-xs text-gray-500">{shown.length} employees</span>
        </div>

        {rows === null ? <Loading /> : shown.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">Employee</th>
                  <th className="th">Department / Designation</th>
                  <th className="th">Access</th>
                  <th className="th">Contact</th>
                  <th className="th">Joined</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-gray-50/70" onClick={() => openEdit(r)}>
                    <td className="td">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-100 text-xs font-bold text-leaf-800">{initials(r.full_name)}</div>
                        <div>
                          <div className="font-semibold">{r.full_name}</div>
                          <div className="text-xs text-gray-500">{r.emp_code}</div>
                        </div>
                      </div>
                    </td>
                    <td className="td"><div>{r.designation?.name ?? '—'}</div><div className="text-xs text-gray-500">{r.department?.name}</div></td>
                    <td className="td"><StatusBadge status={r.role} /></td>
                    <td className="td"><div>{r.email}</div><div className="text-xs text-gray-500">{r.phone}</div></td>
                    <td className="td">{fmtDate(r.date_of_joining)}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        size="xl"
        title={isNew ? 'Add employee' : `${editing?.full_name ?? ''} · ${editing?.emp_code ?? ''}`}
        footer={
          <>
            {!isNew && canDelete && <button type="button" className="btn btn-ghost mr-auto text-red-600" onClick={remove}>Delete</button>}
            {!isNew && !locked && editing?.user_id && (
              <button type="button" className="btn btn-ghost" onClick={resetPassword}><KeyRound size={15} /> Reset password</button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>{locked ? 'Close' : 'Cancel'}</button>
            {!locked && <button form="emp-form" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create employee' : 'Save changes'}</button>}
          </>
        }
      >
        <form id="emp-form" onSubmit={save} noValidate className="space-y-6">
          {Object.keys(errors).length > 0 && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <b>Please correct {Object.keys(errors).length === 1 ? 'this field' : `these ${Object.keys(errors).length} fields`}:</b>
              <ul className="mt-1 list-disc pl-5">{FIELD_ORDER.filter((k) => errors[k]).concat(Object.keys(errors).filter((k) => !FIELD_ORDER.includes(k))).map((k) => <li key={k}>{errors[k]}</li>)}</ul>
            </div>
          )}
          <section>
            <h3 className="mb-3 text-sm font-bold text-leaf-700">Personal</h3>
            <FormGrid fields={personal} values={values} setValues={setValues} refs={refs} errors={errors} setErrors={setErrors} />
          </section>
          <section>
            <h3 className="mb-3 text-sm font-bold text-leaf-700">Job</h3>
            <FormGrid fields={job} values={values} setValues={setValues} refs={refs} errors={errors} setErrors={setErrors} />
          </section>
          <section>
            <h3 className="mb-3 text-sm font-bold text-leaf-700">Bank &amp; statutory</h3>
            <FormGrid fields={bank} values={values} setValues={setValues} refs={refs} errors={errors} setErrors={setErrors} />
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-leaf-700">Previous experience</h3>{!locked && <button type="button" className="btn btn-ghost btn-sm" onClick={addExperience}><Plus size={14} /> Add experience</button>}</div>
            {experiences.length === 0 && <p className="text-sm text-gray-500">No previous experience added.</p>}
            <div className="space-y-4">{experiences.map((exp, index) => <div key={exp.id ?? `new-${index}`} className="rounded-xl border border-gray-200 p-4">
              <div className="mb-3 flex items-center justify-between"><b className="text-sm">Experience {index + 1}</b>{!locked && <button type="button" className="btn btn-ghost btn-sm text-red-600" onClick={async () => { if (exp.id) { const { error } = await db.from('employee_experiences').delete().eq('id', exp.id); if (error) return toast.error(error.message) } setExperiences((x) => x.filter((_, i) => i !== index)) }}><Trash2 size={14} /> Remove</button>}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">Company name<input className="input mt-1" value={exp.company_name ?? ''} disabled={locked} onChange={(e) => updateExperience(index, { company_name: e.target.value })} /></label>
                <label className="text-sm">Period<input className="input mt-1" placeholder="e.g. Jan 2022 – Dec 2024" value={exp.period ?? ''} disabled={locked} onChange={(e) => updateExperience(index, { period: e.target.value })} /></label>
                <label className="text-sm">Experience letter / image<input className="input mt-1" type="file" accept="image/*,.pdf" disabled={locked} onChange={(e) => readFile(e.target.files?.[0], (data, name) => updateExperience(index, { experience_letter_data: data, experience_letter_name: name }))} />{exp.experience_letter_name && <span className="mt-1 block text-xs text-gray-500">{exp.experience_letter_data?.startsWith('data:') ? <a className="underline" href={exp.experience_letter_data} download={exp.experience_letter_name}>View/download {exp.experience_letter_name}</a> : `Stored: ${exp.experience_letter_name}`}</span>}</label>
                <label className="text-sm">Payslip / image<input className="input mt-1" type="file" accept="image/*,.pdf" disabled={locked} onChange={(e) => readFile(e.target.files?.[0], (data, name) => updateExperience(index, { payslip_data: data, payslip_name: name }))} />{exp.payslip_name && <span className="mt-1 block text-xs text-gray-500">{exp.payslip_data?.startsWith('data:') ? <a className="underline" href={exp.payslip_data} download={exp.payslip_name}>View/download {exp.payslip_name}</a> : `Stored: ${exp.payslip_name}`}</span>}</label>
              </div>
              {customDefs.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2">{customDefs.map((def) => <label key={def.id} className="text-sm">{def.field_name}{def.field_type === 'textarea' ? <textarea className="input mt-1" rows={2} disabled={locked} value={exp.custom_fields?.[def.field_name] ?? ''} onChange={(e) => updateExperience(index, { custom_fields: { ...(exp.custom_fields ?? {}), [def.field_name]: e.target.value } })} /> : def.field_type === 'checkbox' ? <input className="ml-2 mt-2 h-4 w-4 accent-leaf-600" type="checkbox" disabled={locked} checked={!!exp.custom_fields?.[def.field_name]} onChange={(e) => updateExperience(index, { custom_fields: { ...(exp.custom_fields ?? {}), [def.field_name]: e.target.checked } })} /> : <input className="input mt-1" type={['text','number','date','email','url'].includes(def.field_type) ? def.field_type : 'text'} disabled={locked} value={exp.custom_fields?.[def.field_name] ?? ''} onChange={(e) => updateExperience(index, { custom_fields: { ...(exp.custom_fields ?? {}), [def.field_name]: e.target.value } })} />}</label>)}</div>}
            </div>)}</div>
            {!locked && <div className="mt-4 rounded-lg bg-gray-50 p-3"><div className="mb-2 text-sm font-semibold">Custom experience fields</div><div className="flex flex-wrap gap-2"><input className="input min-w-[160px] flex-1" placeholder="Field heading" value={newFieldName} onChange={(e) => setNewFieldName(e.target.value)} /><select className="input w-auto" value={newFieldType} onChange={(e) => setNewFieldType(e.target.value)}><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="email">Email</option><option value="url">URL</option><option value="textarea">Long text</option><option value="checkbox">Checkbox</option></select><button type="button" className="btn btn-ghost" onClick={addCustomField}><Plus size={14} /> Add field</button></div></div>}
            <p className="mt-2 text-xs text-gray-500">Documents are stored in the private employee-experience table and are accessible only to HR/Admin. File size limit: 2 MB per file.</p>
          </section>
          {isNew && (
            <section>
              <h3 className="mb-3 text-sm font-bold text-leaf-700">Login</h3>
              <label className={`label${errors.password ? ' text-red-600' : ''}`} htmlFor="f-password">Temporary password</label>
              <div className="flex gap-2">
                <input id="f-password" className={`input font-mono${errors.password ? ' border-red-500 bg-red-50/40' : ''}`} value={password} onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors((x) => { const n = { ...x }; delete n.password; return n }) }} required minLength={8} />
                <button type="button" className="btn btn-ghost" onClick={() => setPassword(randomPassword())} aria-label="Generate"><RefreshCw size={16} /></button>
              </div>
              <FieldError>{errors.password}</FieldError>
              <p className="mt-1 text-xs text-gray-500">You'll see it once after saving — share it securely. They can change it from the account menu.</p>
            </section>
          )}
        </form>
      </Modal>

      <Modal
        open={!!creds}
        onClose={() => setCreds(null)}
        title={creds?.reset ? 'Password reset' : 'Employee created'}
        footer={<button className="btn btn-dark" onClick={() => setCreds(null)}>Done</button>}
      >
        <p className="mb-3 text-sm text-gray-600">Share these sign-in details with <b>{creds?.name}</b>. The password won't be shown again.</p>
        <div className="space-y-2 rounded-lg bg-gray-50 p-4 font-mono text-sm">
          <div>Email: {creds?.email}</div>
          <div>Password: {creds?.password}</div>
        </div>
        <button
          className="btn btn-ghost mt-3"
          onClick={() => { navigator.clipboard.writeText(`Email: ${creds.email}\nPassword: ${creds.password}`); toast.success('Copied') }}
        >
          <Copy size={15} /> Copy
        </button>
      </Modal>
    </>
  )
}
