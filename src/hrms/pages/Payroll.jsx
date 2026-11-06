import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, Pencil, Send, Trash2, Wand2 } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { can } from '../lib/permissions'
import { currentMonth, inr, inr2, monthEnd, monthLabel, monthStart, todayIST } from '../lib/format'
import Payslip from '../components/Payslip'
import { Empty, FormGrid, Loading, Modal, PageHeader, StatCard, StatusBadge, cleanValues, useToast } from '../components/ui'

const num = (v) => Number(v || 0)
const monthlyGross = (r) => num(r.basic) + num(r.hra) + num(r.allowances) + num(r.conveyance_allowance) + num(r.defray_expenses)
// Per-day salary = monthly gross ÷ calendar days in that month (31 for October, 30 for November...).
const perDay = (r) => monthlyGross(r) / Math.max(1, num(r.working_days))
const lopAmount = (r) => Math.round(perDay(r) * num(r.lop_days))

const FIELDS = [
  { name: 'working_days', label: 'Days in month', type: 'number', step: 1, required: true, hint: 'Per-day salary = monthly gross ÷ days in month.', onChange: (v, cur) => ({ lop_amount: lopAmount({ ...cur, working_days: v }) }) },
  { name: 'lop_days', label: 'Loss-of-pay days', type: 'number', step: 0.5, min: 0, hint: 'Unpaid leave on working days (Saturdays, Sundays and holidays are not counted).', onChange: (v, cur) => ({ lop_amount: lopAmount({ ...cur, lop_days: v }) }) },
  { name: 'basic', label: 'Basic (₹)', type: 'number', min: 0 },
  { name: 'hra', label: 'HRA (₹)', type: 'number', min: 0 },
  { name: 'allowances', label: 'Other allowances (₹)', type: 'number', min: 0 },
  { name: 'conveyance_allowance', label: 'Conveyance allowance (₹)', type: 'number', min: 0 },
  { name: 'defray_expenses', label: 'Defray expenses (₹)', type: 'number', min: 0 },
  { name: 'bonus', label: 'Bonus / incentive (₹)', type: 'number', min: 0 },
  { name: 'pf', label: 'Employee PF deduction (₹)', type: 'number', min: 0 },
  { name: 'employer_pf', label: 'Employer PF contribution (₹)', type: 'number', min: 0, hint: 'Included in fixed CTC, not deducted from net pay.' },
  { name: 'employer_esi', label: 'Employer ESI contribution (₹)', type: 'number', min: 0, hint: 'Included in fixed CTC, not deducted from net pay.' },
  { name: 'tax', label: 'TDS / tax (₹)', type: 'number', min: 0 },
  { name: 'other_deductions', label: 'Other deductions (₹)', type: 'number', min: 0 },
  { name: 'lop_amount', label: 'LOP deduction (₹)', type: 'number', min: 0, hint: 'Auto-calculated from LOP days; you can override.' },
  { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'paid', label: 'Paid' }] },
  { name: 'paid_on', label: 'Paid on', type: 'date' },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
]

export default function Payroll() {
  const { role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const canEdit = can(role, 'payroll', 'edit')

  const [month, setMonth] = useState(currentMonth())
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(null)
  const [view, setView] = useState(null)
  const [staff, setStaff] = useState({})

  const load = useCallback(async () => {
    setRows(null)
    const { data, error } = await db.from('payroll').select('*').eq('month', monthStart(month))
    if (error) toast.error(error.message)
    setRows((data ?? []).sort((a, b) => refs.empName(a.employee_id).localeCompare(refs.empName(b.employee_id))))
  }, [month, refs.directory])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    db.from('employees').select('id,bank_account,pan').then(({ data }) => setStaff(Object.fromEntries((data ?? []).map((e) => [e.id, e]))))
  }, [])

  const totals = useMemo(() => {
    const r = rows ?? []
    return {
      gross: r.reduce((s, x) => s + num(x.gross), 0),
      net: r.reduce((s, x) => s + num(x.net_pay), 0),
      draft: r.filter((x) => x.status === 'draft').length,
      published: r.filter((x) => x.status === 'published').length,
      paid: r.filter((x) => x.status === 'paid').length,
    }
  }, [rows])

  const generate = async () => {
    setBusy(true)
    try {
      const first = monthStart(month)
      const [s, l] = await Promise.all([
        db.from('salary_structures').select('*'),
        db.functions.invoke('payroll-lop-summary', { body: { month } }),
      ])
      if (s.error) throw s.error
      if (l.error) throw new Error(l.error.message || 'Could not calculate unpaid leave for payroll')
      const active = new Set(refs.activeStaff.map((e) => e.id))
      const lop = l.data?.lop_days ?? {}
      // Per-day rate uses every calendar day of the month (31 / 30 / 28 / 29).
      const wd = Number(monthEnd(month).slice(8, 10))

      const toInsert = (s.data ?? []).filter((x) => active.has(x.employee_id)).map((x) => {
        const row = {
          employee_id: x.employee_id, month: first, working_days: wd, lop_days: lop[x.employee_id] ?? 0,
          basic: x.basic, hra: x.hra, allowances: x.allowances,
          conveyance_allowance: x.conveyance_allowance, defray_expenses: x.defray_expenses, bonus: 0,
          pf: x.pf, employer_pf: x.employer_pf, employer_esi: x.employer_esi, tax: x.tax, other_deductions: x.other_deductions, status: 'draft',
        }
        return { ...row, lop_amount: lopAmount(row) }
      })
      if (!toInsert.length) throw new Error('No salary structures found. Set salaries first on the Salary page.')

      const { error } = await db.from('payroll').upsert(toInsert, { onConflict: 'employee_id,month', ignoreDuplicates: true })
      if (error) throw error
      toast.success(`Payroll for ${monthLabel(first)} generated (existing rows were left untouched)`)
      await load()
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(false)
  }

  const setStatus = async (ids, status) => {
    if (!ids.length) return
    const patch = { status, ...(status === 'paid' ? { paid_on: todayIST() } : {}) }
    const { error } = await db.from('payroll').update(patch).in('id', ids)
    if (error) return toast.error(error.message)
    toast.success(status === 'published' ? 'Published — employees can now see their payslips' : 'Marked as paid')
    load()
  }

  const openEdit = (r) => setEdit(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? ''])))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    const payload = cleanValues(FIELDS, edit)
    if (payload.status === 'paid' && !payload.paid_on) payload.paid_on = todayIST()
    const { error } = await db.from('payroll').update(payload).eq('id', edit.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Payroll updated')
    setEdit(null)
    load()
  }

  const remove = async (r) => {
    if (!window.confirm(`Delete the draft for ${refs.empName(r.employee_id)}?`)) return
    const { error } = await db.from('payroll').delete().eq('id', r.id)
    if (error) return toast.error(error.message)
    load()
  }

  const gross = edit ? monthlyGross(edit) + num(edit.bonus) : 0
  const ded = edit ? num(edit.pf) + num(edit.tax) + num(edit.other_deductions) + num(edit.lop_amount) : 0

  const personFor = (r) => {
    const e = refs.emp(r.employee_id), p = staff[r.employee_id]
    return {
      name: e?.full_name ?? '—', code: e?.emp_code ?? '', department: refs.deptName(e?.department_id),
      designation: refs.desigName(e?.designation_id),
      bank: p?.bank_account ? `••••${p.bank_account.slice(-4)}` : null, pan: p?.pan ? `••••${p.pan.slice(-4)}` : null,
    }
  }

  return (
    <>
      <PageHeader title="Payroll" subtitle="Generate monthly payroll from salary structures, review, publish payslips, then mark as paid.">
        <input type="month" className="input w-auto" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        {canEdit && (
          <>
            <button className="btn btn-ghost" onClick={generate} disabled={busy}><Wand2 size={16} /> Generate payroll</button>
            <button className="btn btn-primary" disabled={!totals.draft} onClick={() => setStatus(rows.filter((r) => r.status === 'draft').map((r) => r.id), 'published')}>
              <Send size={16} /> Publish all drafts
            </button>
          </>
        )}
      </PageHeader>

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total gross" value={inr(totals.gross)} />
        <StatCard label="Total net payable" value={inr(totals.net)} />
        <StatCard label="Drafts" value={totals.draft} hint="Not visible to employees" />
        <StatCard label="Published / paid" value={`${totals.published} / ${totals.paid}`} />
      </div>

      <div className="card overflow-hidden">
        {rows === null ? <Loading /> : rows.length === 0 ? (
          <Empty>No payroll for {monthLabel(monthStart(month))} yet. Click “Generate payroll”.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="th">Employee</th><th className="th text-right">Gross</th><th className="th text-right">LOP days</th>
                  <th className="th text-right">Deductions</th><th className="th text-right">Net pay</th><th className="th">Status</th><th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td"><div className="font-semibold">{refs.empName(r.employee_id)}</div><div className="text-xs text-gray-500">{refs.empCode(r.employee_id)}</div></td>
                    <td className="td text-right tabular-nums">{inr(r.gross)}</td>
                    <td className="td text-right tabular-nums">{num(r.lop_days)}</td>
                    <td className="td text-right tabular-nums text-red-600">{inr(r.total_deductions)}</td>
                    <td className="td text-right font-semibold tabular-nums text-leaf-700">{inr(r.net_pay)}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100" onClick={() => setView(r)} aria-label="Preview"><Eye size={15} /></button>
                        {canEdit && (
                          <>
                            <button className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100" onClick={() => openEdit(r)} aria-label="Edit"><Pencil size={15} /></button>
                            {r.status === 'draft' && (
                              <>
                                <button className="btn btn-leaf btn-sm" onClick={() => setStatus([r.id], 'published')}>Publish</button>
                                <button className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600" onClick={() => remove(r)} aria-label="Delete"><Trash2 size={15} /></button>
                              </>
                            )}
                            {r.status === 'published' && <button className="btn btn-dark btn-sm" onClick={() => setStatus([r.id], 'paid')}>Mark paid</button>}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        size="lg"
        title={edit ? `${refs.empName(edit.employee_id)} · ${monthLabel(edit.month)}` : ''}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button form="pay-form" className="btn btn-primary" disabled={busy}>Save</button>
          </>
        }
      >
        {edit && (
          <form id="pay-form" onSubmit={save}>
            <FormGrid fields={FIELDS} values={edit} setValues={setEdit} refs={refs} />
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-gray-50 p-3 text-center text-sm">
              <div><div className="text-xs text-gray-500">Gross</div><b>{inr2(gross)}</b></div>
              <div><div className="text-xs text-gray-500">Deductions</div><b className="text-red-600">{inr2(ded)}</b></div>
              <div><div className="text-xs text-gray-500">Net pay</div><b className="text-leaf-700">{inr2(gross - ded)}</b></div>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} size="xl" title="Payslip preview" footer={<button className="btn btn-dark" onClick={() => setView(null)}>Close</button>}>
        {view && <Payslip row={view} person={personFor(view)} />}
      </Modal>
    </>
  )
}
