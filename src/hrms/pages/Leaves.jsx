import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertCircle, Check, CheckCircle2, Plus, Settings2, X } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { can } from '../lib/permissions'
import { fmtDate, leaveDays, todayIST } from '../lib/format'
import { isCompOffType, isEligible, isUnlimitedType, leaveBalance } from '../lib/leaveBalance'
import { Empty, FormGrid, Loading, Modal, PageHeader, StatusBadge, Tabs, useToast } from '../components/ui'

export default function Leaves() {
  const { me, role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const canReview = can(role, 'leaves', 'review')
  const canViewTeam = canReview || refs.activeStaff.some((e) => e.reporting_to === me?.id)
  const canManagePolicies = ['admin','hr'].includes(role)

  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') || 'mine')
  const [statusFilter, setStatusFilter] = useState('')
  const [apply, setApply] = useState(null) // null | values
  const [review, setReview] = useState(null) // {row, decision}
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [compRows, setCompRows] = useState([])
  const [params, setParams] = useSearchParams()
  const [showPolicies, setShowPolicies] = useState(false)
  const [policyRows, setPolicyRows] = useState([])
  const [newPolicy, setNewPolicy] = useState({ name: '', days_per_year: '0', monthly_accrual: '0', is_paid: '', carry_forward: false })

  const load = useCallback(async () => {
    const [{ data, error }, comp] = await Promise.all([
      db.from('leaves').select('*').order('created_at', { ascending: false }),
      db.from('comp_off_ledger').select('employee_id,days'),
    ])
    if (error) toast.error(error.message)
    setRows(data ?? [])
    setCompRows(comp.data ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  // Dashboard "Apply for leave" (and any link to /leaves?apply=1) opens the form straight away.
  useEffect(() => {
    if (params.get('apply')) { openApply(false); setParams({}, { replace: true }) }
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPolicyRows(refs.leaveTypes.map((t) => ({ ...t }))) }, [refs.leaveTypes])

  const mine = useMemo(() => (rows ?? []).filter((r) => r.employee_id === me.id), [rows, me.id])
  const everyone = useMemo(
    () => (rows ?? []).filter((r) => !statusFilter || r.status === statusFilter),
    [rows, statusFilter],
  )
  const teamLeaves = useMemo(() => (rows ?? []).filter((r) => r.employee_id !== me.id), [rows, me.id])
  const approvalRows = everyone
  const pendingCount = (rows ?? []).filter((r) => ['pending','cancellation_requested'].includes(r.status) && r.employee_id !== me.id).length
  const teamStaff = canReview ? refs.activeStaff : refs.activeStaff.filter((e) => e.reporting_to === me?.id)
  const compEarnedFor = (employeeId) => compRows.filter((x) => x.employee_id === employeeId).reduce((sum, x) => sum + Number(x.days || 0), 0)
  const balanceFor = (employee, type, asOf) => leaveBalance({
    employee, type, asOf,
    leaves: (rows || []).filter((r) => r.employee_id === employee.id),
    compOffEarned: compEarnedFor(employee.id),
  })
  const teamBalanceFor = (employee, type) => {
    if (!type) return null
    if (/maternity|paternity/i.test(type.name || '')) return null // gender-specific balances are shown to the employee themselves
    const b = balanceFor(employee, type)
    return b.limited ? b.left : 'No fixed limit'
  }

  // Leave balances: Interns are in probation and accrue one paid leave per month
  // without carry-forward. Regular employees follow the configured leave type policy.
  const year = todayIST().slice(0, 4)
  const currentMonth = Number(todayIST().slice(5, 7))
  const joinedDate = me.date_of_joining || `${year}-01-01`
  const joinedYear = Number(joinedDate.slice(0, 4))
  const joinedMonth = Number(joinedDate.slice(5, 7))
  const isIntern = String(me.employment_type || '').toLowerCase() === 'intern'
  const eligibleTypes = refs.leaveTypes.filter((t) => isEligible(t, me.gender))
  // Same rules as the API check (lib/leaveBalance.js), so the cards and the server always agree.
  const balances = eligibleTypes
    .filter((t) => !isCompOffType(t) && (Number(t.days_per_year) > 0 || Number(t.monthly_accrual) > 0 || isUnlimitedType(t)))
    .map((t) => {
      const b = balanceFor(me, t)
      return { ...t, ...b, left: b.limited ? b.left : Infinity }
    })

  const openApply = (onBehalf = false) =>
    setApply({
      onBehalf,
      employee_id: onBehalf ? '' : me.id,
      leave_type_id: '',
      start_date: todayIST(),
      end_date: todayIST(),
      half_day: false,
      half_day_session: '',
      reason: '',
      status: 'pending',
    })

  const days = apply ? leaveDays(apply.start_date, apply.end_date, apply.half_day, refs.holidayDates) : 0
  const sel = apply && refs.leaveType(apply.leave_type_id)
  const compType = refs.leaveTypes.find(isCompOffType)
  const compOffAvailable = compType ? balanceFor(me, compType).left : Math.max(0, compEarnedFor(me.id))
  // Balance of the chosen type for the person the leave is for, in the month of the From date.
  const target = apply && (apply.employee_id === me.id ? me : refs.emp(apply.employee_id))
  const selBalance = apply && sel && target ? balanceFor(target, sel, apply.start_date) : null
  const blocked = !!(apply && !apply.onBehalf && selBalance?.limited && (selBalance.left <= 0 || days > selBalance.left))
  const overQuota = !!(apply && selBalance?.limited && days > selBalance.left)
  const periodText = (b) => (b?.period === 'month' ? ` for ${new Date(`${apply.start_date}T00:00:00`).toLocaleDateString('en-GB', { month: 'long' })}` : b?.period === 'year' ? ` for ${apply.start_date.slice(0, 4)}` : '')
  const typeOptions = () => refs.leaveTypes
    .filter((t) => apply?.onBehalf || isEligible(t, me.gender))
    .map((t) => {
      if (apply?.onBehalf) return { value: t.id, label: t.name }
      const b = balanceFor(me, t, apply?.start_date)
      return { value: t.id, label: b.limited ? `${t.name} — ${b.left} day${b.left === 1 ? '' : 's'} left` : t.name }
    })

  const fields = apply && [
    ...(apply.onBehalf
      ? [{ name: 'employee_id', label: 'Employee', type: 'select', required: true, full: true,
          options: (r) => r.activeStaff.filter((e) => role === 'admin' || e.id !== me.id).map((e) => ({ value: e.id, label: `${e.full_name} (${e.emp_code})` })) }]
      : []),
    { name: 'leave_type_id', label: 'Leave type', type: 'select', required: true, full: true, options: typeOptions },
    ...(apply.onBehalf
      ? [{ name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }] }]
      : [{ name: 'spacer', label: '', type: 'text', hidden: () => true }]),
    { name: 'start_date', label: 'From', type: 'date', required: true, onChange: (v, cur) => (cur.end_date < v ? { end_date: v } : {}) },
    { name: 'end_date', label: 'To', type: 'date', required: true, min: apply.start_date },
    { name: 'half_day', label: '', type: 'checkbox', checkLabel: 'Half day', hidden: (v) => v.start_date !== v.end_date, onChange: (v) => (v ? {} : { half_day_session: '' }) },
    { name: 'half_day_session', label: 'Which half', type: 'select', required: true, hidden: (v) => !v.half_day || v.start_date !== v.end_date,
      options: [{ value: 'morning', label: 'Morning (first half)' }, { value: 'afternoon', label: 'Afternoon (second half)' }] },
    { name: 'reason', label: 'Reason', type: 'textarea', full: true },
  ]

  const submit = async (e) => {
    e.preventDefault()
    if (days <= 0) return toast.error('The selected dates have no working days (Saturdays, Sundays and company holidays are not counted).')
    const half = !!apply.half_day && apply.start_date === apply.end_date
    if (half && !apply.half_day_session) return toast.error('Choose morning or afternoon for the half day.')
    if (blocked) return toast.error(selBalance.left <= 0 ? `You have no ${sel.name} left${periodText(selBalance)}.` : `You have only ${selBalance.left} day(s) of ${sel.name} left${periodText(selBalance)}.`)
    setSaving(true)
    const { error } = await db.from('leaves').insert({
      employee_id: apply.employee_id,
      leave_type_id: apply.leave_type_id,
      start_date: apply.start_date,
      end_date: apply.end_date,
      days,
      half_day: half,
      half_day_session: half ? apply.half_day_session : null,
      reason: apply.reason || null,
      status: apply.onBehalf ? apply.status : 'pending',
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(apply.onBehalf ? 'Leave recorded' : 'Leave request sent to HR for approval')
    setApply(null)
    load()
  }

  const decide = async () => {
    setSaving(true)
    const { error } = await db
      .from('leaves')
      .update({ status: review.decision, review_note: note || null })
      .eq('id', review.row.id)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(review.decision === 'approved' && review.row.status === 'cancellation_requested' ? 'Cancellation declined; leave remains approved' : review.decision === 'approved' ? 'Leave approved' : review.decision === 'cancelled' ? 'Leave cancelled' : 'Leave rejected')
    setReview(null)
    setNote('')
    load()
  }

  const savePolicy = async (policy) => {
    const payload = {
      days_per_year: Number(policy.days_per_year || 0),
      monthly_accrual: Number(policy.monthly_accrual || 0),
      is_paid: !!policy.is_paid,
      carry_forward: !!policy.carry_forward,
    }
    const { error } = await db.from('leave_types').update(payload).eq('id', policy.id)
    if (error) return toast.error(error.message)
    toast.success(`${policy.name} policy saved`)
    await refs.reload()
  }
  const addPolicy = async (e) => {
    e.preventDefault()
    if (!newPolicy.name.trim() || newPolicy.is_paid === '') return toast.error('Enter a leave type name and confirm whether it is paid.')
    const payload = {
      name: newPolicy.name.trim(), days_per_year: Number(newPolicy.days_per_year || 0),
      monthly_accrual: Number(newPolicy.monthly_accrual || 0), is_paid: newPolicy.is_paid === 'true',
      carry_forward: !!newPolicy.carry_forward,
    }
    const { error } = await db.from('leave_types').insert(payload)
    if (error) return toast.error(error.message)
    toast.success('Leave type added')
    setNewPolicy({ name: '', days_per_year: '0', monthly_accrual: '0', is_paid: '', carry_forward: false })
    await refs.reload()
  }

  const cancel = async (r) => {
    if (!window.confirm('Send a cancellation request to HR / your authorized approver?')) return
    const { error } = await db.from('leaves').update({ status: 'cancellation_requested' }).eq('id', r.id)
    if (error) return toast.error(error.message)
    toast.success('Cancellation request sent for review')
    load()
  }

  const Table = ({ list, showEmployee }) =>
    list.length === 0 ? <Empty>No leave records.</Empty> : (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {showEmployee && <th className="th">Employee</th>}
              <th className="th">Type</th><th className="th">Dates</th><th className="th">Days</th>
              <th className="th">Reason</th><th className="th">Status</th><th className="th" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {list.map((r) => {
              const own = r.employee_id === me.id
              const canAct = canReview && ['pending','cancellation_requested'].includes(r.status) && !(role === 'hr' && own)
              const canApproveCancellation = canAct && r.status === 'cancellation_requested'
              return (
                <tr key={r.id}>
                  {showEmployee && <td className="td"><div className="font-semibold">{refs.empName(r.employee_id)}</div><div className="text-xs text-gray-500">{refs.empCode(r.employee_id)}</div></td>}
                  <td className="td">{refs.leaveType(r.leave_type_id)?.name}</td>
                  <td className="td whitespace-nowrap">{fmtDate(r.start_date)}{r.end_date !== r.start_date && ` → ${fmtDate(r.end_date)}`}</td>
                  <td className="td">{Number(r.days)}{r.half_day && ` (half${r.half_day_session ? ` · ${r.half_day_session === 'morning' ? 'morning' : 'afternoon'}` : ''})`}</td>
                  <td className="td max-w-xs text-gray-600">{r.reason ?? '—'}{r.review_note && <div className="mt-1 text-xs text-gray-500">HR note: {r.review_note}</div>}</td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                  <td className="td">
                    <div className="flex justify-end gap-1.5">
                      {canAct && (
                        <>
                          {canApproveCancellation ? <button className="btn btn-leaf btn-sm" onClick={() => { setReview({ row: r, decision: 'cancelled' }); setNote('') }}><Check size={14} /> Approve cancel</button> : <button className="btn btn-leaf btn-sm" onClick={() => { setReview({ row: r, decision: 'approved' }); setNote('') }}><Check size={14} /> Approve</button>}
                          <button className="btn btn-ghost btn-sm text-red-600" onClick={() => { setReview({ row: r, decision: canApproveCancellation ? 'approved' : 'rejected' }); setNote('') }}><X size={14} /> {canApproveCancellation ? 'Keep leave' : 'Reject'}</button>
                        </>
                      )}
                      {own && ['pending','approved'].includes(r.status) && !canAct && (
                        <button className="btn btn-ghost btn-sm" onClick={() => cancel(r)}>Request cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )

  return (
    <>
      <PageHeader title="Leave" subtitle="Requests go to HR for approval.">
        {canManagePolicies && <button className="btn btn-ghost" onClick={() => setShowPolicies((v) => !v)}><Settings2 size={15} /> Leave policies</button>}
        {canReview && <button className="btn btn-ghost" onClick={() => openApply(true)}>Add for an employee</button>}
        <button className="btn btn-primary" onClick={() => openApply(false)}><Plus size={16} /> Apply for leave</button>
      </PageHeader>

      {showPolicies && canManagePolicies && <div className="card mb-5 p-4"><h2 className="mb-1 text-base font-bold">Leave policy configuration</h2><p className="mb-4 text-xs text-gray-500">A zero annual limit means no fixed annual cap. Set paid status, accrual, and carry-forward only according to confirmed company policy.</p>
        <div className="space-y-3">{policyRows.map((p) => <div key={p.id} className="rounded-lg border border-gray-200 p-3"><div className="mb-3 font-semibold">{p.name}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-gray-500">Days per year<input className="input mt-1" type="number" min="0" step="0.5" value={p.days_per_year ?? 0} onChange={(e) => setPolicyRows((rows) => rows.map((x) => x.id === p.id ? { ...x, days_per_year: e.target.value } : x))} /></label>
          <label className="text-xs text-gray-500">Monthly accrual<input className="input mt-1" type="number" min="0" step="0.5" value={p.monthly_accrual ?? 0} onChange={(e) => setPolicyRows((rows) => rows.map((x) => x.id === p.id ? { ...x, monthly_accrual: e.target.value } : x))} /></label>
          <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={!!p.is_paid} onChange={(e) => setPolicyRows((rows) => rows.map((x) => x.id === p.id ? { ...x, is_paid: e.target.checked } : x))} /> Paid leave</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!p.carry_forward} onChange={(e) => setPolicyRows((rows) => rows.map((x) => x.id === p.id ? { ...x, carry_forward: e.target.checked } : x))} /> Carry forward</label>
          <div className="flex items-center"><button className="btn btn-ghost btn-sm" onClick={() => savePolicy(p)}>Save policy</button></div>
        </div></div>)}</div>
        <form onSubmit={addPolicy} className="mt-5 rounded-lg bg-gray-50 p-3"><h3 className="mb-3 text-sm font-semibold">Add leave type</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-gray-500">Leave type name<input className="input mt-1" value={newPolicy.name} onChange={(e) => setNewPolicy((x) => ({ ...x, name: e.target.value }))} required /></label>
          <label className="text-xs text-gray-500">Days per year (0 = no fixed cap)<input className="input mt-1" type="number" min="0" step="0.5" value={newPolicy.days_per_year} onChange={(e) => setNewPolicy((x) => ({ ...x, days_per_year: e.target.value }))} /></label>
          <label className="text-xs text-gray-500">Monthly accrual<input className="input mt-1" type="number" min="0" step="0.5" value={newPolicy.monthly_accrual} onChange={(e) => setNewPolicy((x) => ({ ...x, monthly_accrual: e.target.value }))} /></label>
          <label className="text-xs text-gray-500">Paid status<select className="input mt-1" value={newPolicy.is_paid} onChange={(e) => setNewPolicy((x) => ({ ...x, is_paid: e.target.value }))} required><option value="">Confirm paid status…</option><option value="true">Paid</option><option value="false">Unpaid</option></select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={newPolicy.carry_forward} onChange={(e) => setNewPolicy((x) => ({ ...x, carry_forward: e.target.checked }))} /> Carry forward</label>
          <div className="flex items-center"><button className="btn btn-primary" type="submit"><Plus size={14} /> Add leave type</button></div>
        </div></form>
      </div>}

      {canViewTeam && (
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'mine', label: 'My Leaves' },
          ...(canReview ? [{ value: 'approvals', label: `My Approvals${pendingCount ? ` (${pendingCount})` : ''}` }] : []),
          { value: 'team', label: 'Other Employees’ Leaves' },
          { value: 'balances', label: 'Leave Balances' },
        ]} />
      )}

      {tab === 'mine' || !canViewTeam ? (
        <>
          <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{isIntern ? "Intern probation policy: 1 paid leave accrued per month; unused probation leave does not carry forward." : "Regular employee policy applies. Casual Leave carries forward to the next year; Paid Leave does not carry forward."}</div>
          <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-4"><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Comp-Off balance</div><div className="mt-1 text-2xl font-bold">{compOffAvailable} days</div><div className="mt-1 text-xs text-gray-500">Earned from verified work on company holidays.</div></div>
            {balances.map((b) => (
              <div key={b.id} className="card p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{b.name}</div>
                <div className="mt-1 text-2xl font-bold">{Number.isFinite(b.left) ? b.left : "No fixed limit"} <span className="text-sm font-medium text-gray-500">{Number.isFinite(b.left) ? `remaining${b.period === 'month' ? ' this month' : ''}` : ""}</span></div>
                {b.carry > 0 && <div className="text-xs text-gray-500">includes {b.carry} carried forward</div>}
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-lime-500" style={{ width: `${Number.isFinite(b.left) ? Math.min(100, (b.used / Math.max(1, b.used + b.pending + b.left)) * 100) : 0}%` }} /></div>
                {b.pending > 0 && <div className="mt-1.5 text-xs text-amber-700">{b.pending} day(s) awaiting approval</div>}
              </div>
            ))}
          </div>
          <div className="card overflow-hidden">{rows === null ? <Loading /> : <Table list={mine} />}</div>
        </>
      ) : tab === 'balances' ? (
        <div className="card overflow-hidden">
          <div className="border-b border-gray-100 p-3 text-sm text-gray-500">Balances use each employee's employment type and visible approved/pending leave records. Interns accrue 1 paid leave per month with no carry-forward.</div>
          <div className="overflow-x-auto"><table className="table"><thead><tr><th className="th">Employee</th><th className="th">Type</th><th className="th">Casual Leave</th><th className="th">Paid Leave</th><th className="th">Unpaid Leave (LOP)</th></tr></thead><tbody>
            {teamStaff.map((employee) => {
              const casual = refs.leaveTypes.find((t) => /casual/i.test(t.name || ''))
              const paid = refs.leaveTypes.find((t) => /^paid leave$/i.test(t.name || ''))
              const lopType = refs.leaveTypes.find((t) => /lop|unpaid/i.test(t.name || ''))
              const lopUsed = (rows || []).filter((r) => r.employee_id === employee.id && r.leave_type_id === lopType?.id && r.status === 'approved' && r.start_date.startsWith(year)).reduce((sum, r) => sum + Number(r.days), 0)
              return <tr key={employee.id}><td className="td"><div className="font-medium">{employee.full_name}</div><div className="text-xs text-gray-500">{employee.emp_code}</div></td><td className="td">{employee.employment_type || 'Employee'}</td><td className="td">{casual ? teamBalanceFor(employee, casual) : '—'} days</td><td className="td">{paid ? teamBalanceFor(employee, paid) : '—'} days</td><td className="td">{lopUsed} used</td></tr>
            })}
            {!teamStaff.length && <tr><td className="td" colSpan="5">No employee balances are available for your reporting scope.</td></tr>}
          </tbody></table></div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-gray-100 p-3">
            <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {['pending', 'cancellation_requested', 'approved', 'rejected', 'cancelled'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
            <span className="ml-auto text-xs text-gray-500">{everyone.length} records</span>
          </div>
          {rows === null ? <Loading /> : <Table list={tab === 'approvals' ? approvalRows : teamLeaves.filter((r) => !statusFilter || r.status === statusFilter)} showEmployee />}
        </div>
      )}

      <Modal
        open={!!apply}
        onClose={() => setApply(null)}
        title={apply?.onBehalf ? 'Add leave for an employee' : 'Apply for leave'}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setApply(null)}>Cancel</button>
            <button form="leave-form" className="btn btn-primary" disabled={saving || blocked}>{saving ? 'Sending…' : apply?.onBehalf ? 'Save' : 'Send for approval'}</button>
          </>
        }
      >
        {apply && (
          <form id="leave-form" onSubmit={submit}>
            <FormGrid fields={fields} values={apply} setValues={setApply} refs={refs} />
            {sel && selBalance && (
              selBalance.limited ? (
                <div role="status" className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${blocked ? 'border border-red-200 bg-red-50 text-red-700' : overQuota ? 'border border-amber-200 bg-amber-50 text-amber-800' : 'border border-lime-200 bg-lime-50 text-leaf-800'}`}>
                  {blocked ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
                  <div>
                    <b>{selBalance.left} day{selBalance.left === 1 ? '' : 's'}</b> of {sel.name} remaining{periodText(selBalance)}
                    {apply.onBehalf && target ? ` for ${target.full_name}` : ''}
                    {selBalance.pending > 0 && <span className="text-xs"> · {selBalance.pending} awaiting approval</span>}
                    {blocked && <div className="mt-0.5 font-semibold">{selBalance.left <= 0 ? `You can't apply for ${sel.name} — choose another leave type.` : `You can apply for at most ${selBalance.left} day(s).`}</div>}
                    {!blocked && overQuota && apply.onBehalf && <div className="mt-0.5 text-xs">This is more than the remaining balance. You can still record it as HR/Admin.</div>}
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{sel.name}: no fixed limit.</div>
              )
            )}
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <b>{days}</b> working day{days === 1 ? '' : 's'} <span className="text-gray-500">(Saturdays, Sundays and company holidays not counted)</span>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={!!review}
        onClose={() => setReview(null)}
        title={review?.row?.status === 'cancellation_requested' ? (review?.decision === 'cancelled' ? 'Approve cancellation' : 'Keep approved leave') : review?.decision === 'approved' ? 'Approve leave' : 'Reject leave'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setReview(null)}>Cancel</button>
            <button className={`btn ${review?.decision === 'approved' ? 'btn-leaf' : 'btn-danger'}`} disabled={saving} onClick={decide}>
              {review?.row?.status === 'cancellation_requested' ? (review?.decision === 'cancelled' ? 'Confirm cancellation' : 'Keep leave') : review?.decision === 'approved' ? 'Approve' : 'Reject'}
            </button>
          </>
        }
      >
        {review && (
          <>
            <p className="mb-3 text-sm">
              <b>{refs.empName(review.row.employee_id)}</b> · {refs.leaveType(review.row.leave_type_id)?.name} · {Number(review.row.days)} day(s)<br />
              {fmtDate(review.row.start_date)}{review.row.end_date !== review.row.start_date && ` → ${fmtDate(review.row.end_date)}`}
            </p>
            <label className="label">Note (optional)</label>
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        )}
      </Modal>
    </>
  )
}
