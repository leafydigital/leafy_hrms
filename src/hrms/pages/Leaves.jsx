import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Plus, Settings2, X } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { can } from '../lib/permissions'
import { fmtDate, leaveDays, todayIST } from '../lib/format'
import { Empty, FormGrid, Loading, Modal, PageHeader, StatusBadge, Tabs, useToast } from '../components/ui'

export default function Leaves() {
  const { me, role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const canReview = can(role, 'leaves', 'review')
  const canViewTeam = canReview || refs.activeStaff.some((e) => e.reporting_to === me?.id)
  const canManagePolicies = ['admin','hr'].includes(role)

  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState('mine')
  const [statusFilter, setStatusFilter] = useState('')
  const [apply, setApply] = useState(null) // null | values
  const [review, setReview] = useState(null) // {row, decision}
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [compOffDays, setCompOffDays] = useState(0)
  const [showPolicies, setShowPolicies] = useState(false)
  const [policyRows, setPolicyRows] = useState([])
  const [newPolicy, setNewPolicy] = useState({ name: '', days_per_year: '0', monthly_accrual: '0', is_paid: '', carry_forward: false })

  const load = useCallback(async () => {
    const [{ data, error }, comp] = await Promise.all([
      db.from('leaves').select('*').order('created_at', { ascending: false }),
      db.from('comp_off_ledger').select('days'),
    ])
    if (error) toast.error(error.message)
    setRows(data ?? [])
    setCompOffDays((comp.data ?? []).reduce((sum, x) => sum + Number(x.days || 0), 0))
  }, [])
  useEffect(() => { load() }, [load])
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
  const teamBalanceFor = (employee, type) => {
    if (!type) return null
    const name = String(type.name || '').toLowerCase()
    if (/maternity|paternity/.test(name)) return null // gender-specific balances are shown to the employee themselves
    if (/lop|unpaid/.test(name)) return 'No fixed limit'
    const employeeLeaves = (rows || []).filter((r) => r.employee_id === employee.id && r.leave_type_id === type.id)
    const approved = employeeLeaves.filter((r) => r.status === 'approved')
    const pending = employeeLeaves.filter((r) => ['pending','cancellation_requested'].includes(r.status))
    const thisYearUsed = approved.filter((r) => r.start_date.startsWith(year)).reduce((sum, r) => sum + Number(r.days), 0)
    const thisYearPending = pending.filter((r) => r.start_date.startsWith(year)).reduce((sum, r) => sum + Number(r.days), 0)
    const currentMonthKey = todayIST().slice(0, 7)
    const currentMonthUsed = approved.filter((r) => r.start_date.slice(0, 7) === currentMonthKey).reduce((sum, r) => sum + Number(r.days), 0)
    const currentMonthPending = pending.filter((r) => r.start_date.slice(0, 7) === currentMonthKey).reduce((sum, r) => sum + Number(r.days), 0)
    const join = employee.date_of_joining || `${year}-01-01`
    const joinYear = Number(join.slice(0, 4)), joinMonth = Number(join.slice(5, 7))
    const monthsThisYear = Math.max(0, currentMonth - (joinYear === Number(year) ? joinMonth - 1 : 0))
    const intern = String(employee.employment_type || '').toLowerCase() === 'intern'
    const monthly = intern && type.is_paid ? Number(type.probation_monthly_accrual || 1) : Number(type.monthly_accrual || 0)
    let earned = monthly > 0 ? monthly : Number(type.days_per_year || 0)
    let carry = 0
    if (!intern && type.carry_forward && monthly > 0) {
      const priorMonths = Math.max(0, (Number(year) - joinYear) * 12 - (joinMonth - 1))
      const priorEarned = priorMonths * monthly
      const priorUsed = approved.filter((r) => r.start_date.slice(0, 4) < year).reduce((sum, r) => sum + Number(r.days), 0)
      const priorPending = pending.filter((r) => r.start_date.slice(0, 4) < year).reduce((sum, r) => sum + Number(r.days), 0)
      carry = Math.max(0, priorEarned - priorUsed - priorPending)
    }
    return Math.max(0, carry + earned - (monthly > 0 ? currentMonthUsed + currentMonthPending : thisYearUsed + thisYearPending))
  }

  // Leave balances: Interns are in probation and accrue one paid leave per month
  // without carry-forward. Regular employees follow the configured leave type policy.
  const year = todayIST().slice(0, 4)
  const currentMonth = Number(todayIST().slice(5, 7))
  const joinedDate = me.date_of_joining || `${year}-01-01`
  const joinedYear = Number(joinedDate.slice(0, 4))
  const joinedMonth = Number(joinedDate.slice(5, 7))
  const isIntern = String(me.employment_type || '').toLowerCase() === 'intern'
  const eligibleTypes = refs.leaveTypes.filter((t) => {
    const name = String(t.name || '').toLowerCase()
    if (name.includes('maternity')) return String(me.gender || '').toLowerCase() === 'female'
    if (name.includes('paternity')) return String(me.gender || '').toLowerCase() === 'male'
    return true
  })
  const balances = eligibleTypes
    .filter((t) => Number(t.days_per_year) > 0 || Number(t.monthly_accrual) > 0 || /lop|unpaid/i.test(t.name || ''))
    .map((t) => {
      const inYear = mine.filter((r) => r.leave_type_id === t.id && r.start_date.startsWith(year))
      const approved = mine.filter((r) => r.leave_type_id === t.id && r.status === 'approved')
      const pendingRows = mine.filter((r) => r.leave_type_id === t.id && ['pending','cancellation_requested'].includes(r.status))
      const used = inYear.filter((r) => r.status === 'approved').reduce((sum, r) => sum + Number(r.days), 0)
      const pending = inYear.filter((r) => ['pending','cancellation_requested'].includes(r.status)).reduce((sum, r) => sum + Number(r.days), 0)
      const monthsThisYear = Math.max(0, currentMonth - (joinedYear === Number(year) ? joinedMonth - 1 : 0))
      const monthsBeforeYear = Math.max(0, (Number(year) - joinedYear) * 12 - (joinedMonth - 1))
      let earnedThisYear = Number(t.days_per_year || 0)
      let carry = 0
      let currentUsed = used
      let currentPending = pending
      if (Number(t.monthly_accrual) > 0) {
        const accrual = isIntern && t.is_paid ? Number(t.probation_monthly_accrual || 1) : Number(t.monthly_accrual)
        // Monthly entitlement is available only in that month. Unused CL is banked
        // for next year's carry-forward, not added to the next month's quota.
        earnedThisYear = accrual
        currentUsed = inYear.filter((r) => r.status === 'approved' && r.start_date.slice(0, 7) === todayIST().slice(0, 7)).reduce((sum, r) => sum + Number(r.days), 0)
        currentPending = inYear.filter((r) => ['pending','cancellation_requested'].includes(r.status) && r.start_date.slice(0, 7) === todayIST().slice(0, 7)).reduce((sum, r) => sum + Number(r.days), 0)
        if (!isIntern && t.carry_forward) {
          const priorEarned = monthsBeforeYear * Number(t.monthly_accrual)
          const priorUsed = approved.filter((r) => r.start_date.slice(0, 4) < year).reduce((sum, r) => sum + Number(r.days), 0)
          const priorPending = pendingRows.filter((r) => r.start_date.slice(0, 4) < year).reduce((sum, r) => sum + Number(r.days), 0)
          carry = Math.max(0, priorEarned - priorUsed - priorPending)
        }
      }
      if (isIntern && t.is_paid && Number(t.monthly_accrual) > 0) carry = 0
      const unlimited = /lop|unpaid/i.test(t.name || '')
      return { ...t, used, pending, left: unlimited ? Infinity : Math.max(0, carry + earnedThisYear - currentUsed - currentPending), carry, earnedThisYear }
    })

  const openApply = (onBehalf = false) =>
    setApply({
      onBehalf,
      employee_id: onBehalf ? '' : me.id,
      leave_type_id: '',
      start_date: todayIST(),
      end_date: todayIST(),
      half_day: false,
      reason: '',
      status: 'pending',
    })

  const days = apply ? leaveDays(apply.start_date, apply.end_date, apply.half_day) : 0
  const sel = apply && refs.leaveType(apply.leave_type_id)
  const compOffUsed = mine.filter((r) => /comp.?off/i.test(refs.leaveType(r.leave_type_id)?.name ?? '') && r.status === 'approved').reduce((sum, r) => sum + Number(r.days), 0)
  const compOffAvailable = Math.max(0, compOffDays - compOffUsed)
  const overQuota = (() => {
    if (!apply || !sel || apply.employee_id !== me.id) return false
    if (/comp.?off/i.test(sel.name ?? '')) return days > compOffAvailable
    const b = balances.find((x) => x.id === sel.id)
    return b ? days > b.left : false
  })()

  const fields = apply && [
    ...(apply.onBehalf
      ? [{ name: 'employee_id', label: 'Employee', type: 'select', required: true, full: true,
          options: (r) => r.activeStaff.filter((e) => role === 'admin' || e.id !== me.id).map((e) => ({ value: e.id, label: `${e.full_name} (${e.emp_code})` })) }]
      : []),
    { name: 'leave_type_id', label: 'Leave type', type: 'select', required: true, options: (r) => r.leaveTypes.filter((t) => !t.eligible_gender || t.eligible_gender === 'any' || String(t.eligible_gender).toLowerCase() === String(me.gender || '').toLowerCase()).map((t) => ({ value: t.id, label: t.name })) },
    ...(apply.onBehalf
      ? [{ name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }] }]
      : [{ name: 'spacer', label: '', type: 'text', hidden: () => true }]),
    { name: 'start_date', label: 'From', type: 'date', required: true, onChange: (v, cur) => (cur.end_date < v ? { end_date: v } : {}) },
    { name: 'end_date', label: 'To', type: 'date', required: true, min: apply.start_date },
    { name: 'half_day', label: '', type: 'checkbox', checkLabel: 'Half day', hidden: (v) => v.start_date !== v.end_date },
    { name: 'reason', label: 'Reason', type: 'textarea', full: true },
  ]

  const submit = async (e) => {
    e.preventDefault()
    if (days <= 0) return toast.error('The selected dates contain no working days (Sundays are not counted).')
    if (overQuota && !/lop|unpaid/i.test(sel?.name ?? '') && !/comp.?off/i.test(sel?.name ?? '')) return toast.error(`Insufficient ${sel?.name || 'leave'} balance. Remaining: ${balances.find((b) => b.id === sel.id)?.left ?? 0} day(s).` )
    if (overQuota && /comp.?off/i.test(sel?.name ?? '')) return toast.error(`You only have ${compOffAvailable} compensatory day(s) available. Contact HR if a holiday credit is missing.`)
    setSaving(true)
    const { error } = await db.from('leaves').insert({
      employee_id: apply.employee_id,
      leave_type_id: apply.leave_type_id,
      start_date: apply.start_date,
      end_date: apply.end_date,
      days,
      half_day: !!apply.half_day && apply.start_date === apply.end_date,
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
                  <td className="td">{Number(r.days)}{r.half_day && ' (half)'}</td>
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
                <div className="mt-1 text-2xl font-bold">{Number.isFinite(b.left) ? b.left : "No fixed limit"} <span className="text-sm font-medium text-gray-500">{Number.isFinite(b.left) ? "remaining" : ""}</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full bg-lime-500" style={{ width: `${Math.min(100, (b.used / Math.max(1, Number(b.days_per_year || b.left + b.used))) * 100)}%` }} /></div>
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
            <button form="leave-form" className="btn btn-primary" disabled={saving}>{saving ? 'Sending…' : apply?.onBehalf ? 'Save' : 'Send for approval'}</button>
          </>
        }
      >
        {apply && (
          <form id="leave-form" onSubmit={submit}>
            <FormGrid fields={fields} values={apply} setValues={setApply} refs={refs} />
            <div className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <b>{days}</b> working day{days === 1 ? '' : 's'} <span className="text-gray-500">(Sundays not counted)</span>
              {overQuota && <div className="mt-1 text-amber-700">This exceeds your remaining {sel.name} balance.</div>}
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
