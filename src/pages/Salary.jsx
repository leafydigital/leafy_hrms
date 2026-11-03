import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { IndianRupee } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { can } from '../lib/permissions'
import { fmtDate, inr } from '../lib/format'
import { Empty, FormGrid, Loading, Modal, PageHeader, StatCard, cleanValues, useToast } from '../components/ui'

const FIELDS = [
  { name: 'basic', label: 'Basic salary (₹ / month)', type: 'number', required: true, min: 0 },
  { name: 'hra', label: 'HRA (₹ / month)', type: 'number', min: 0 },
  { name: 'conveyance_allowance', label: 'Conveyance allowance (₹ / month)', type: 'number', min: 0 },
  { name: 'defray_expenses', label: 'Defray expenses (₹ / month)', type: 'number', min: 0 },
  { name: 'allowances', label: 'Other allowances (₹ / month)', type: 'number', min: 0 },
  { name: 'employer_pf', label: 'Employer PF contribution (₹ / month)', type: 'number', min: 0, hint: 'Defaults to ₹0 until the company enables PF.' },
  { name: 'employer_esi', label: 'Employer ESI contribution (₹ / month)', type: 'number', min: 0, hint: 'Defaults to ₹0 until the company enables ESI.' },
  { name: 'effective_from', label: 'Effective from', type: 'date' },
  { name: 'pf', label: 'Employee PF deduction (₹ / month)', type: 'number', min: 0 },
  { name: 'tax', label: 'TDS / tax (₹ / month)', type: 'number', min: 0 },
  { name: 'other_deductions', label: 'Other employee deductions (₹ / month)', type: 'number', min: 0 },
]

const num = (v) => Number(v || 0)

export default function Salary() {
  const { role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const canEdit = can(role, 'salary', 'edit')
  const canUseSlabs = can(role, 'salarySlabs')

  const [staff, setStaff] = useState(null)
  const [structs, setStructs] = useState({})
  const [slabs, setSlabs] = useState([])
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null) // {employee, ...values}
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [e, s, slabResult] = await Promise.all([
      db.from('employees').select('id,emp_code,full_name,department_id,designation_id,status').eq('status', 'active').order('emp_code'),
      db.from('salary_structures').select('*'),
      canUseSlabs ? db.from('salary_slabs').select('*').eq('active', true).order('monthly_gross') : Promise.resolve({ data: [], error: null }),
    ])
    if (e.error) toast.error(e.error.message)
    setStaff(e.data ?? [])
    setStructs(Object.fromEntries((s.data ?? []).map((x) => [x.employee_id, x])))
    if (slabResult.error) toast.error(slabResult.error.message)
    setSlabs(slabResult.data ?? [])
  }, [canUseSlabs])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return (staff ?? []).filter((e) => !n || e.full_name.toLowerCase().includes(n) || e.emp_code.toLowerCase().includes(n))
  }, [staff, q])

  const calc = (s) => {
    const gross = num(s?.basic) + num(s?.hra) + num(s?.allowances) + num(s?.conveyance_allowance) + num(s?.defray_expenses)
    const ded = num(s?.pf) + num(s?.tax) + num(s?.other_deductions)
    const employerContributions = num(s?.employer_pf) + num(s?.employer_esi)
    return { gross, ded, net: gross - ded, employerContributions, annualCtc: (gross + employerContributions) * 12 }
  }
  const totalGross = Object.values(structs).reduce((t, s) => t + calc(s).gross, 0)
  const totalNet = Object.values(structs).reduce((t, s) => t + calc(s).net, 0)

  const openEdit = (emp) => {
    const s = structs[emp.id]
    setEdit({
      employee: emp, id: s?.id, salary_slab_id: s?.salary_slab_id ?? '',
      basic: s?.basic ?? 12500, hra: s?.hra ?? 6250, conveyance_allowance: s?.conveyance_allowance ?? 3750,
      defray_expenses: s?.defray_expenses ?? 2500, allowances: s?.allowances ?? 0,
      employer_pf: s?.employer_pf ?? 0, employer_esi: s?.employer_esi ?? 0,
      pf: s?.pf ?? 0, tax: s?.tax ?? 0, other_deductions: s?.other_deductions ?? 0,
      effective_from: s?.effective_from ?? '',
    })
  }

  const applySlab = (slabId) => {
    const slab = slabs.find((x) => x.id === slabId)
    if (!slab) return setEdit((cur) => ({ ...cur, salary_slab_id: '' }))
    setEdit((cur) => ({
      ...cur,
      salary_slab_id: slab.id,
      basic: slab.basic, hra: slab.hra, conveyance_allowance: slab.conveyance_allowance,
      defray_expenses: slab.defray_expenses, allowances: slab.allowances,
      employer_pf: slab.employer_pf, employer_esi: slab.employer_esi,
      pf: slab.pf, tax: slab.tax, other_deductions: slab.other_deductions,
    }))
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = { ...cleanValues(FIELDS, edit), employee_id: edit.employee.id }
    const calculated = calc(payload)
    payload.annual_ctc = calculated.annualCtc
    payload.salary_slab_id = edit.salary_slab_id || null
    const { error } = await db.from('salary_structures').upsert(payload, { onConflict: 'employee_id' })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Salary details saved')
    setEdit(null)
    load()
  }

  const preview = edit ? calc(edit) : null

  return (
    <>
      <PageHeader title="Salary" subtitle="Monthly salary structure for each employee. Payroll is generated from these." />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Employees with salary set" value={`${Object.keys(structs).length} / ${staff?.length ?? 0}`} />
        <StatCard label="Monthly gross" value={inr(totalGross)} icon={IndianRupee} />
        <StatCard label="Annual gross" value={inr(totalGross * 12)} icon={IndianRupee} />
        <StatCard label="Monthly net" value={inr(totalNet)} icon={IndianRupee} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-gray-100 p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input pl-9" placeholder="Search employee…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {staff === null ? <Loading /> : shown.length === 0 ? <Empty /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">Employee</th><th className="th text-right">Basic</th><th className="th text-right">HRA</th>
                  <th className="th text-right">Conveyance</th><th className="th text-right">Defray</th><th className="th text-right">Gross / month</th><th className="th text-right">Fixed CTC / year</th>
                  <th className="th text-right">Deductions</th><th className="th text-right">Net</th><th className="th">Effective</th><th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((emp) => {
                  const s = structs[emp.id]
                  const c = calc(s)
                  return (
                    <tr key={emp.id}>
                      <td className="td"><div className="font-semibold">{emp.full_name}</div><div className="text-xs text-gray-500">{emp.emp_code} · {refs.desigName(emp.designation_id)}</div></td>
                      {s ? (
                        <>
                          <td className="td text-right tabular-nums">{inr(s.basic)}</td>
                          <td className="td text-right tabular-nums">{inr(s.hra)}</td>
                          <td className="td text-right tabular-nums">{inr(s.conveyance_allowance)}</td>
                          <td className="td text-right tabular-nums">{inr(s.defray_expenses)}</td>
                          <td className="td text-right font-semibold tabular-nums">{inr(c.gross)}</td>
                          <td className="td text-right tabular-nums">{inr(c.annualCtc)}</td>
                          <td className="td text-right tabular-nums text-red-600">{inr(c.ded)}</td>
                          <td className="td text-right font-semibold tabular-nums text-leaf-700">{inr(c.net)}</td>
                          <td className="td">{fmtDate(s.effective_from)}</td>
                        </>
                      ) : (
                        <td className="td text-sm text-amber-700" colSpan={9}>Salary not set</td>
                      )}
                      <td className="td text-right">
                        {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(emp)}>{s ? 'Edit' : 'Set salary'}</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `Salary · ${edit.employee.full_name}` : ''}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button form="sal-form" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }
      >
        {edit && (
          <form id="sal-form" onSubmit={save}>
            {canUseSlabs && <div className="mb-4">
              <label className="label">Salary slab template</label>
              <select className="input" value={edit.salary_slab_id ?? ''} onChange={(e) => applySlab(e.target.value)}>
                <option value="">Choose a slab (optional)</option>
                {slabs.map((slab) => <option key={slab.id} value={slab.id}>{slab.name} · {inr(slab.monthly_gross)} / month</option>)}
              </select>
              <p className="mt-1 text-xs text-gray-500">Choosing a slab fills the salary fields below. You can edit any value before saving.</p>
            </div>}
            <FormGrid fields={FIELDS} values={edit} setValues={setEdit} refs={refs} />
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-center text-sm sm:grid-cols-4">
              <div><div className="text-xs text-gray-500">Gross / month</div><b>{inr(preview.gross)}</b></div>
              <div><div className="text-xs text-gray-500">Employee deductions</div><b className="text-red-600">{inr(preview.ded)}</b></div>
              <div><div className="text-xs text-gray-500">Net / month</div><b className="text-leaf-700">{inr(preview.net)}</b></div>
              <div><div className="text-xs text-gray-500">Fixed CTC / year</div><b>{inr(preview.annualCtc)}</b></div>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
