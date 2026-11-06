import { useEffect, useState } from 'react'
import { Lock, Pencil } from 'lucide-react'
import { api } from '../lib/db'
import { fmtDate, initials, label } from '../lib/format'
import { FormGrid, Loading, PageHeader, StatusBadge, focusFirstError, useToast } from '../components/ui'

// Employees see their whole record; they can change their own contact details.
// Job, bank and identity details are changed by HR (shown read-only, numbers masked).
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((x) => ({ value: x, label: x }))
const EDIT_FIELDS = [
  { name: 'phone', label: 'Mobile number', type: 'tel', required: true },
  { name: 'personal_email', label: 'Personal email', type: 'email' },
  { name: 'emergency_contact_name', label: 'Emergency contact name' },
  { name: 'emergency_contact_relation', label: 'Emergency contact relationship' },
  { name: 'emergency_contact', label: 'Emergency contact number', type: 'tel' },
  { name: 'blood_group', label: 'Blood group', type: 'select', options: BLOOD },
  { name: 'address', label: 'Address', type: 'textarea', rows: 2 },
  { name: 'pincode', label: 'PIN code' },
]

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-4 border-b border-gray-50 py-2 text-sm last:border-0">
      <span className="text-gray-500">{k}</span>
      <span className="text-right font-medium">{v || <span className="text-gray-300">—</span>}</span>
    </div>
  )
}

export default function Profile() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState({})
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const { data, error } = await api('/api/profile/me', {})
    if (error) return toast.error(error.message)
    setData(data)
  }
  useEffect(() => { load() }, [])

  const startEdit = () => {
    setValues(Object.fromEntries(EDIT_FIELDS.map((f) => [f.name, data.profile[f.name] ?? ''])))
    setErrors({})
    setEditing(true)
  }
  // Fill the PIN code from a 6-digit number typed in the address.
  useEffect(() => {
    if (!editing) return
    const m = String(values.address ?? '').match(/(?:^|\D)(\d{6})(?:\D|$)/)
    if (m && values.pincode !== m[1]) setValues((v) => ({ ...v, pincode: m[1] }))
  }, [values.address, editing])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    const { data: res, error } = await api('/api/profile/update', { values })
    setSaving(false)
    if (error) {
      if (error.fields) { setErrors(error.fields); focusFirstError(error.fields, EDIT_FIELDS.map((f) => f.name)) }
      return toast.error(error.message)
    }
    toast.success(res.changed.length ? 'Profile updated. HR has been notified.' : 'Nothing changed')
    setEditing(false)
    load()
  }

  if (!data) return <Loading />
  const p = data.profile

  return (
    <>
      <PageHeader title="My Profile" subtitle="Your employee record. Update your contact details here; ask HR to change job, bank or ID details.">
        {!editing && <button className="btn btn-primary" onClick={startEdit}><Pencil size={15} /> Edit my details</button>}
      </PageHeader>

      <div className="card mb-6 flex flex-wrap items-center gap-4 p-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-lime-500 text-xl font-bold text-ink">{initials(p.full_name)}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold">{p.full_name}</div>
          <div className="text-sm text-gray-600">{p.designation ?? '—'}{p.department ? ` · ${p.department}` : ''}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500"><span>{p.emp_code}</span>·<span>{p.email}</span><StatusBadge status={p.status} /></div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 font-bold">Personal &amp; contact</h2>
          {editing ? (
            <form onSubmit={save} noValidate>
              <FormGrid fields={EDIT_FIELDS} values={values} setValues={setValues} errors={errors} setErrors={setErrors} />
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
              </div>
            </form>
          ) : (
            <>
              <Row k="Mobile number" v={p.phone} />
              <Row k="Personal email" v={p.personal_email} />
              <Row k="Gender" v={p.gender} />
              <Row k="Date of birth" v={p.date_of_birth && fmtDate(p.date_of_birth)} />
              <Row k="Blood group" v={p.blood_group} />
              <Row k="Address" v={p.address} />
              <Row k="PIN code" v={p.pincode} />
              <Row k="Emergency contact" v={[p.emergency_contact_name, p.emergency_contact_relation && `(${p.emergency_contact_relation})`, p.emergency_contact].filter(Boolean).join(' ')} />
            </>
          )}
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-bold">Job <Lock size={13} className="text-gray-400" /></h2>
            <Row k="Employee code" v={p.emp_code} />
            <Row k="Work email" v={p.email} />
            <Row k="Department" v={p.department} />
            <Row k="Designation" v={p.designation} />
            <Row k="Reports to" v={p.reporting_to_name} />
            <Row k="Employment type" v={p.employment_type} />
            <Row k="Date of joining" v={p.date_of_joining && fmtDate(p.date_of_joining)} />
            <Row k="Access role" v={label(p.role ?? '')} />
          </div>
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-bold">Bank &amp; ID <Lock size={13} className="text-gray-400" /></h2>
            <Row k="Bank" v={p.bank_name} />
            <Row k="Account number" v={p.bank_account} />
            <Row k="IFSC" v={p.ifsc} />
            <Row k="PAN" v={p.pan} />
            <Row k="Aadhaar" v={p.aadhaar_number} />
            <p className="mt-2 text-xs text-gray-500">To change these, contact HR.</p>
          </div>
        </div>
      </div>

      {data.changes.length > 0 && (
        <div className="card mt-6 p-5">
          <h2 className="mb-3 font-bold">Recent changes</h2>
          <ul className="divide-y divide-gray-100 text-sm">
            {data.changes.map((c, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                <span><b>{c.label}</b>: <span className="text-gray-500 line-through">{c.old_value || '—'}</span> → {c.new_value || '—'}</span>
                <span className="text-xs text-gray-500">{fmtDate(c.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
