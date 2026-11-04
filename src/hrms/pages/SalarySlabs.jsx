import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, ToggleLeft, ToggleRight } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { can } from '../lib/permissions'
import { inr } from '../lib/format'
import { Empty, Loading, Modal, PageHeader, StatCard, useToast } from '../components/ui'

const COMPONENTS = [
  ['basic', 'Basic salary'], ['hra', 'HRA'], ['conveyance_allowance', 'Conveyance allowance'],
  ['defray_expenses', 'Defray expenses'], ['allowances', 'Other allowances'],
  ['employer_pf', 'Employer PF'], ['employer_esi', 'Employer ESI'],
  ['pf', 'Employee PF deduction'], ['tax', 'TDS / tax'], ['other_deductions', 'Other deductions'],
]
const n = (v) => Number(v || 0)
const gross = (s) => n(s.basic) + n(s.hra) + n(s.conveyance_allowance) + n(s.defray_expenses) + n(s.allowances)
const ctc = (s) => (gross(s) + n(s.employer_pf) + n(s.employer_esi)) * 12
const blank = () => ({ name: '', description: '', basic: 0, hra: 0, conveyance_allowance: 0, defray_expenses: 0, allowances: 0, employer_pf: 0, employer_esi: 0, pf: 0, tax: 0, other_deductions: 0, active: true })

export default function SalarySlabs() {
  const { role } = useAuth()
  const toast = useToast()
  const canEdit = can(role, 'salarySlabs', 'edit')
  const canCreate = can(role, 'salarySlabs', 'create')
  const canRemove = can(role, 'salarySlabs', 'remove')
  const [rows, setRows] = useState(null)
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await db.from('salary_slabs').select('*').order('monthly_gross')
    if (error) toast.error(error.message)
    setRows(data ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const totals = useMemo(() => ({ active: (rows ?? []).filter((r) => r.active).length, gross: (rows ?? []).filter((r) => r.active).reduce((sum, r) => sum + n(r.monthly_gross), 0) }), [rows])

  const save = async (e) => {
    e.preventDefault()
    if (!edit.name.trim()) return toast.error('Enter a salary slab name.')
    setBusy(true)
    const payload = { ...blank(), ...edit, name: edit.name.trim(), description: edit.description?.trim() || null }
    delete payload.monthly_gross
    delete payload.annual_ctc
    const { error } = edit.id
      ? await db.from('salary_slabs').update(payload).eq('id', edit.id)
      : await db.from('salary_slabs').insert(payload)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(edit.id ? 'Salary slab updated' : 'Salary slab created')
    setEdit(null)
    load()
  }

  const toggleActive = async (row) => {
    const { error } = await db.from('salary_slabs').update({ active: !row.active }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(row.active ? 'Salary slab deactivated' : 'Salary slab activated')
    load()
  }

  return <>
    <PageHeader title="Salary Slabs" subtitle="Create reusable salary templates. Choose a slab when setting an employee's salary; the filled values remain editable.">
      {canCreate && <button className="btn btn-primary" onClick={() => setEdit(blank())}><Plus size={16} /> Create salary slab</button>}
    </PageHeader>
    <div className="mb-4 grid gap-4 sm:grid-cols-2">
      <StatCard label="Active salary slabs" value={totals.active} />
      <StatCard label="Combined monthly gross (active slabs)" value={inr(totals.gross)} />
    </div>
    <div className="card overflow-hidden">
      {rows === null ? <Loading /> : rows.length === 0 ? <Empty>No salary slabs yet. Create one for ₹7,000, ₹8,000, ₹12,000, or any other salary level.</Empty> : <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50"><tr><th className="th">Slab</th><th className="th text-right">Basic</th><th className="th text-right">HRA</th><th className="th text-right">Other components</th><th className="th text-right">Gross / month</th><th className="th text-right">Fixed CTC / year</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-gray-100">{rows.map((r) => <tr key={r.id}>
            <td className="td"><div className="font-semibold">{r.name}</div>{r.description && <div className="text-xs text-gray-500">{r.description}</div>}</td>
            <td className="td text-right">{inr(r.basic)}</td><td className="td text-right">{inr(r.hra)}</td>
            <td className="td text-right">{inr(n(r.conveyance_allowance)+n(r.defray_expenses)+n(r.allowances))}</td>
            <td className="td text-right font-semibold">{inr(r.monthly_gross)}</td><td className="td text-right">{inr(r.annual_ctc)}</td>
            <td className="td"><span className={r.active ? 'badge badge-green' : 'badge'}>{r.active ? 'Active' : 'Inactive'}</span></td>
            <td className="td"><div className="flex justify-end gap-1">{canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ ...r })}><Pencil size={14} /> Edit</button>}{canRemove && <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(r)} title={r.active ? 'Deactivate slab' : 'Activate slab'}>{r.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}{r.active ? 'Deactivate' : 'Activate'}</button>}</div></td>
          </tr>)}</tbody>
        </table>
      </div>}
    </div>
    <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit salary slab' : 'Create salary slab'} footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button form="salary-slab-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save slab'}</button></>}>
      {edit && <form id="salary-slab-form" onSubmit={save} className="space-y-4">
        <div><label className="label">Slab name *</label><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. ₹12,000 Monthly Slab" required /></div>
        <div><label className="label">Description (optional)</label><input className="input" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} placeholder="e.g. Entry-level monthly salary" /></div>
        <div className="grid gap-3 sm:grid-cols-2">{COMPONENTS.map(([key, label]) => <div key={key}><label className="label">{label} (₹ / month)</label><input className="input" type="number" min="0" step="0.01" value={edit[key] ?? 0} onChange={(e) => setEdit({ ...edit, [key]: e.target.value })} /></div>)}</div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active and available when assigning salary</label>
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-center"><div><div className="text-xs text-gray-500">Gross / month</div><b>{inr(gross(edit))}</b></div><div><div className="text-xs text-gray-500">Fixed CTC / year</div><b>{inr(ctc(edit))}</b></div></div>
        <p className="text-xs text-gray-500">Gross is calculated from basic, HRA, conveyance, defray expenses and other allowances. Employer PF/ESI are added to annual fixed CTC. Employee deductions do not reduce gross.</p>
      </form>}
    </Modal>
  </>
}
