import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarPlus, CheckCircle2, Coffee, Home, LogIn, LogOut, MapPin, Play, Trash2, Wifi, WifiOff, XCircle } from 'lucide-react'
import { api, db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { useRealtime } from '../lib/realtime'
import { can } from '../lib/permissions'
import { getLocation, mapLink } from '../lib/geo'
import { currentMonth, daysInMonth, fmtDate, fmtTime, label, monthEnd, monthStart, timeInput, toTimestamp, todayIST } from '../lib/format'
import { Badge, Empty, FieldError, FormGrid, Loading, Modal, PageHeader, StatCard, StatusBadge, Tabs, useToast } from '../components/ui'

const STATUS_OPTIONS = ['present', 'wfh', 'half_day', 'absent', 'leave', 'holiday'].map((s) => ({ value: s, label: label(s) }))
const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + m }
const nowHHMM = () => timeInput(new Date().toISOString())
const REASON_TEXT = {
  late: (r) => `Checking in after ${r.late_after} IST`,
  time_edited: (r) => `Typed time is more than ${r.time_edit_tolerance_min} min away from now`,
  other_network: () => 'Not on the office network',
}
const APPROVAL_TONE = { pending: 'amber', approved: 'green', rejected: 'red' }

/** Typed time, with the actual (system) time underneath when they differ. */
function TimePair({ typed, system }) {
  if (!typed && !system) return <span className="text-gray-400">—</span>
  const differs = system && typed && Math.abs(new Date(typed) - new Date(system)) >= 60000
  return (
    <div>
      <div className="font-medium">{fmtTime(typed ?? system)}</div>
      {differs && <div className="text-[11px] text-gray-500">actual {fmtTime(system)}</div>}
    </div>
  )
}

function Where({ lat, lng, accuracy, office, ip }) {
  const link = mapLink(lat, lng)
  return (
    <div className="space-y-0.5 text-xs">
      {office != null && (office
        ? <span className="inline-flex items-center gap-1 text-leaf-700"><Wifi size={12} /> Office network</span>
        : <span className="inline-flex items-center gap-1 text-amber-700"><WifiOff size={12} /> Other network</span>)}
      {ip && <div className="text-gray-400">{ip}</div>}
      {link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-leaf-700 hover:underline"><MapPin size={12} /> Map{accuracy ? ` ±${Math.round(accuracy)}m` : ''}</a>}
    </div>
  )
}

function ShiftCard({ onChanged }) {
  const toast = useToast()
  const [info, setInfo] = useState(null)
  const [time, setTime] = useState(nowHHMM())
  const [touched, setTouched] = useState(false)
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [locState, setLocState] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await api('/api/attendance/today', {})
    if (error) return toast.error(error.message)
    setInfo(data)
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [load])
  // Keep the time box on "now" until the employee edits it.
  useEffect(() => {
    if (touched) return
    setTime(nowHHMM())
    const t = setInterval(() => setTime(nowHHMM()), 15000)
    return () => clearInterval(t)
  }, [touched])

  if (!info) return <div className="card mb-4 p-5"><Loading text="Checking your shift…" /></div>

  const row = info.row
  const rules = info.rules
  const checkedIn = !!row?.check_in
  const checkedOut = !!row?.check_out
  const wfh = info.wfh_today || row?.work_mode === 'wfh'
  const nowMin = toMin(nowHHMM())
  const edited = Math.abs(toMin(time) - nowMin) > rules.time_edit_tolerance_min
  const needs = !checkedIn ? [
    nowMin > toMin(rules.late_after) && 'late',
    edited && 'time_edited',
    !info.wfh_today && !info.office_network && 'other_network',
  ].filter(Boolean) : []
  const wfhBlocked = wfh && !info.wfh_window_open
  const reasonRequired = checkedIn ? edited : needs.length > 0

  const submit = async (kind) => {
    const errs = {}
    if (!/^\d{2}:\d{2}$/.test(time)) errs.time = 'Enter the time as HH:MM.'
    else if (toMin(time) > nowMin + 2) errs.time = `${kind === 'in' ? 'Check-in' : 'Check-out'} time cannot be in the future.`
    if (reasonRequired && reason.trim().length < 3) errs.reason = kind === 'in' ? 'Give a reason — this check-in goes to HR for approval.' : 'Give a reason for the changed check-out time.'
    if (Object.keys(errs).length) return setErrors(errs)
    setErrors({})
    setBusy(true)
    let loc = null
    try {
      setLocState('Getting your location…')
      loc = await getLocation()
      setLocState(`Location captured (±${Math.round(loc.accuracy)} m)`)
    } catch (e) {
      setLocState('')
      if (rules.require_location) { setBusy(false); setErrors({ location: e.message }); return }
    }
    const { data, error } = await api(`/api/attendance/${kind === 'in' ? 'check-in' : 'check-out'}`, { time, reason: reason.trim() || undefined, ...(loc ?? {}) })
    setBusy(false)
    if (error) {
      if (error.field) setErrors({ [error.field]: error.message })
      else toast.error(error.message)
      return
    }
    toast.success(kind === 'in' ? (data.pending ? 'Checked in — sent to HR for approval' : 'Checked in') : 'Checked out')
    setReason(''); setTouched(false); setLocState('')
    await load()
    onChanged?.()
  }

  const toggleBreak = async () => {
    setBusy(true)
    const { error } = await api('/api/attendance/break', { action: info.open_break ? 'end' : 'start' })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(info.open_break ? 'Welcome back' : 'Break started')
    load()
  }

  const breakMinutes = (info.breaks ?? []).reduce((s, b) => s + ((b.ended_at ? new Date(b.ended_at) : new Date()) - new Date(b.started_at)) / 60000, 0)

  return (
    <div className="card mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50/70 px-5 py-3 text-xs">
        <span className="font-semibold uppercase tracking-wide text-gray-500">Today · {fmtDate(info.date)}</span>
        {wfh ? <Badge tone="blue"><Home size={12} className="mr-1" />Work from home approved</Badge>
          : info.office_network ? <Badge tone="green"><Wifi size={12} className="mr-1" />On office network</Badge>
            : <Badge tone="amber"><WifiOff size={12} className="mr-1" />Not on office network</Badge>}
        {wfh && <span className="text-gray-500">WFH hours {rules.wfh_start}–{rules.wfh_end}</span>}
        {row?.approval_status && row.approval_status !== 'not_required' && <Badge tone={APPROVAL_TONE[row.approval_status]}>Check-in {row.approval_status === 'pending' ? 'awaiting HR approval' : row.approval_status}</Badge>}
      </div>

      <div className="p-5">
        {info.approved_leave && !checkedIn && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">You are on approved {info.approved_leave.name}{info.approved_leave.half_day ? ' (half day)' : ''} today.</div>}
        {wfhBlocked && !checkedOut && <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">Work-from-home check-in and check-out are open {rules.wfh_start}–{rules.wfh_end} IST. Please rest outside those hours.</div>}

        {checkedIn && (
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <StatusBadge status={row.status} />
            <span>In <b>{fmtTime(row.check_in)}</b>{row.check_in_system && Math.abs(new Date(row.check_in) - new Date(row.check_in_system)) >= 60000 && <span className="text-gray-500"> (actual {fmtTime(row.check_in_system)})</span>}</span>
            {checkedOut && <span>Out <b>{fmtTime(row.check_out)}</b>{row.check_out_system && Math.abs(new Date(row.check_out) - new Date(row.check_out_system)) >= 60000 && <span className="text-gray-500"> (actual {fmtTime(row.check_out_system)})</span>}</span>}
            {breakMinutes > 0 && <span className="text-gray-600">Breaks {Math.round(breakMinutes)} min</span>}
            {info.open_break && <Badge tone="amber"><Coffee size={12} className="mr-1" />On break since {fmtTime(info.open_break.started_at)}</Badge>}
          </div>
        )}

        {checkedOut ? (
          <p className="text-sm font-medium text-leaf-700">Done for today ✓</p>
        ) : row?.status === 'leave' ? (
          <p className="text-sm text-gray-600">Today is recorded as leave{row.review_note ? ` — ${row.review_note}` : ''}.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[180px_1fr_auto] md:items-start">
            <div>
              <label className={`label${errors.time ? ' text-red-600' : ''}`} htmlFor="shift-time">{checkedIn ? 'Check-out time' : 'Check-in time'}</label>
              <input id="shift-time" type="time" className={`input text-lg font-semibold${errors.time ? ' border-red-500 bg-red-50/40' : ''}`} value={time}
                onChange={(e) => { setTime(e.target.value); setTouched(true); setErrors((x) => ({ ...x, time: undefined })) }} disabled={busy || wfhBlocked} />
              {errors.time ? <FieldError>{errors.time}</FieldError>
                : <p className="mt-1 text-xs text-gray-500">{touched ? <button type="button" className="underline" onClick={() => setTouched(false)}>Reset to now</button> : 'Filled with the current time — edit if needed.'}</p>}
            </div>
            <div>
              {(reasonRequired || reason) && (
                <>
                  <label className={`label${errors.reason ? ' text-red-600' : ''}`} htmlFor="shift-reason">Reason {reasonRequired && <span className="text-red-500">*</span>}</label>
                  <textarea id="shift-reason" rows={2} className={`input${errors.reason ? ' border-red-500 bg-red-50/40' : ''}`} value={reason}
                    placeholder={needs.includes('other_network') ? 'e.g. Visiting client site at Technopark — office Wi-Fi not available' : 'e.g. Traffic block near Kazhakkoottam'}
                    onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, reason: undefined })) }} disabled={busy} />
                  <FieldError>{errors.reason}</FieldError>
                </>
              )}
              {!checkedIn && needs.length > 0 && (
                <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div><b>HR approval needed:</b> {needs.map((n) => REASON_TEXT[n](rules)).join(' · ')}. Your check-in, time, reason and location are sent to HR.{needs.includes('other_network') && ' If HR rejects it, the day is recorded as leave.'}</div>
                </div>
              )}
              {errors.location && <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700"><MapPin size={14} className="mt-0.5 shrink-0" />{errors.location}</div>}
              {locState && <p className="mt-2 text-xs text-gray-500">{locState}</p>}
            </div>
            <div className="flex flex-wrap gap-2 md:pt-5">
              {!checkedIn && (
                <button className="btn btn-primary" onClick={() => submit('in')} disabled={busy || wfhBlocked || row?.status === 'leave'}>
                  <LogIn size={16} /> {needs.length ? 'Send check-in for approval' : 'Check in'}
                </button>
              )}
              {checkedIn && (
                <>
                  <button className="btn btn-ghost" onClick={toggleBreak} disabled={busy}>{info.open_break ? <><Play size={15} /> End break</> : <><Coffee size={15} /> Start break</>}</button>
                  <button className="btn btn-dark" onClick={() => submit('out')} disabled={busy || wfhBlocked}><LogOut size={16} /> Check out</button>
                </>
              )}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-gray-400">Your location and network address are recorded with each check-in and check-out. Network: {info.ip || 'unknown'}.</p>
      </div>
    </div>
  )
}

function Approvals() {
  const toast = useToast()
  const { me } = useAuth()
  const { subscribe } = useRealtime()
  const [view, setView] = useState('pending')
  const [rows, setRows] = useState(null)
  const [labels, setLabels] = useState({})
  const [review, setReview] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await api('/api/attendance/approvals', { status: view })
    if (error) return toast.error(error.message)
    setRows(data.rows); setLabels(data.reason_labels)
  }, [view])
  useEffect(() => { setRows(null); load() }, [load])
  useEffect(() => subscribe((evt) => { if (evt === 'shift') load() }), [subscribe, load])

  const open = (r, decision) => setReview({
    row: r, decision, note: '', time: timeInput(r.check_in),
    reject_action: r.approval_reasons.includes('other_network') ? 'leave' : 'system_time',
  })
  const submit = async () => {
    setBusy(true)
    const { data, error } = await api('/api/attendance/review', {
      attendance_id: review.row.id, decision: review.decision, note: review.note,
      ...(review.decision === 'approve' ? { check_in_time: review.time } : { reject_action: review.reject_action }),
    })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(`${review.row.full_name}: ${data.summary}`)
    setReview(null)
    load()
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <Tabs value={view} onChange={setView} tabs={[{ value: 'pending', label: 'Waiting for review' }, { value: 'reviewed', label: 'Reviewed (60 days)' }]} />
      </div>
      <div className="card overflow-hidden">
        {rows === null ? <Loading /> : rows.length === 0 ? <Empty>{view === 'pending' ? 'No check-ins waiting for approval.' : 'Nothing reviewed recently.'}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-gray-50"><tr><th className="th">Employee</th><th className="th">Date</th><th className="th">Check-in</th><th className="th">Why</th><th className="th">Where</th><th className="th">{view === 'pending' ? '' : 'Decision'}</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="td"><div className="font-semibold">{r.full_name}</div><div className="text-xs text-gray-500">{r.emp_code} · {r.work_mode === 'wfh' ? 'WFH' : 'Office'}</div></td>
                    <td className="td whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td className="td"><div>Typed <b>{fmtTime(r.check_in)}</b></div><div className="text-xs text-gray-500">Actual {fmtTime(r.check_in_system)}</div></td>
                    <td className="td max-w-xs">
                      <div className="mb-1 flex flex-wrap gap-1">{r.approval_reasons.map((x) => <Badge key={x} tone="amber">{labels[x] ?? x}</Badge>)}</div>
                      {r.check_in_reason && <div className="text-xs text-gray-700">“{r.check_in_reason}”</div>}
                    </td>
                    <td className="td"><Where lat={r.check_in_lat} lng={r.check_in_lng} accuracy={r.check_in_accuracy} office={r.check_in_office_network} ip={r.check_in_ip} /></td>
                    <td className="td text-right">
                      {view === 'pending' ? (
                        r.employee_id === me.id && me.role !== 'admin' ? <span className="text-xs text-gray-400">Another approver must review</span> : (
                          <div className="flex justify-end gap-2">
                            <button className="btn btn-leaf btn-sm" onClick={() => open(r, 'approve')}><CheckCircle2 size={14} /> Approve</button>
                            <button className="btn btn-ghost btn-sm text-red-600" onClick={() => open(r, 'reject')}><XCircle size={14} /> Reject</button>
                          </div>
                        )
                      ) : (
                        <div className="text-left text-xs">
                          <Badge tone={APPROVAL_TONE[r.approval_status]}>{label(r.approval_status)}</Badge>
                          <div className="mt-1 text-gray-600">{r.review_action === 'leave' ? 'Marked as leave' : r.review_action === 'system_time' ? 'Actual time kept' : `Accepted ${fmtTime(r.check_in)}`}</div>
                          <div className="text-gray-400">by {r.reviewed_by_name ?? '—'}</div>
                          {r.review_note && <div className="text-gray-600">“{r.review_note}”</div>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!review} onClose={() => setReview(null)} title={review ? `${review.decision === 'approve' ? 'Approve' : 'Reject'} check-in · ${review.row.full_name}` : ''}
        footer={<><button className="btn btn-ghost" onClick={() => setReview(null)}>Cancel</button><button className={`btn ${review?.decision === 'approve' ? 'btn-leaf' : 'btn-danger'}`} onClick={submit} disabled={busy}>{review?.decision === 'approve' ? 'Approve' : 'Reject'}</button></>}>
        {review && (
          <div className="space-y-4 text-sm">
            <div className="rounded-lg bg-gray-50 p-3">
              {fmtDate(review.row.date)} · typed <b>{fmtTime(review.row.check_in)}</b> · actual <b>{fmtTime(review.row.check_in_system)}</b>
              {review.row.check_in_reason && <div className="mt-1 text-gray-600">Reason: “{review.row.check_in_reason}”</div>}
            </div>
            {review.decision === 'approve' ? (
              <div>
                <label className="label" htmlFor="rv-time">Check-in time to record</label>
                <input id="rv-time" type="time" className="input w-40" value={review.time} onChange={(e) => setReview((x) => ({ ...x, time: e.target.value }))} />
                <p className="mt-1 text-xs text-gray-500">Defaults to the time the employee typed. Correct it if needed.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <span className="label">When rejected</span>
                <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-leaf-600" checked={review.reject_action === 'system_time'} onChange={() => setReview((x) => ({ ...x, reject_action: 'system_time' }))} /><span>Keep the shift, but record the <b>actual</b> check-in time ({fmtTime(review.row.check_in_system)})</span></label>
                <label className="flex items-start gap-2"><input type="radio" className="mt-1 accent-leaf-600" checked={review.reject_action === 'leave'} onChange={() => setReview((x) => ({ ...x, reject_action: 'leave' }))} /><span>Record the day as <b>leave (LOP)</b> — used for unverified check-ins from another network</span></label>
              </div>
            )}
            <div>
              <label className="label" htmlFor="rv-note">Note to employee (optional)</label>
              <textarea id="rv-note" rows={2} className="input" value={review.note} onChange={(e) => setReview((x) => ({ ...x, note: e.target.value }))} />
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

export default function Attendance() {
  const { me, role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const { subscribe } = useRealtime()
  const [params, setParams] = useSearchParams()
  const canManage = can(role, 'attendance', 'manage')
  const canApprove = can(role, 'attendance', 'approve')
  const canManageHolidays = ['admin', 'hr'].includes(role)
  const canViewTeam = canManage || refs.activeStaff.some((e) => e.reporting_to === me?.id)
  const today = todayIST()

  const tab = params.get('tab') || 'mine'
  const setTab = (t) => setParams(t === 'mine' ? {} : { tab: t }, { replace: true })
  const [month, setMonth] = useState(currentMonth())
  const [mine, setMine] = useState(null)
  const [busy, setBusy] = useState(false)

  // team view
  const [date, setDate] = useState(today)
  const [team, setTeam] = useState(null)
  const [onLeave, setOnLeave] = useState([])
  const [edit, setEdit] = useState(null)
  const [holidays, setHolidays] = useState([])
  const [holidayDate, setHolidayDate] = useState(today)
  const [holidayName, setHolidayName] = useState('')
  const [compOffTeam, setCompOffTeam] = useState([])

  const loadMine = useCallback(async () => {
    const { data, error } = await db
      .from('attendance').select('*').eq('employee_id', me.id)
      .gte('date', monthStart(month)).lte('date', monthEnd(month)).order('date', { ascending: false })
    if (error) toast.error(error.message)
    setMine(data ?? [])
  }, [month, me.id])
  useEffect(() => { loadMine() }, [loadMine])

  const loadTeam = useCallback(async () => {
    if (!canViewTeam) return
    const [a, l, h, c] = await Promise.all([
      db.from('attendance').select('*').eq('date', date),
      db.from('leaves').select('employee_id').eq('status', 'approved').lte('start_date', date).gte('end_date', date),
      db.from('company_holidays').select('*').order('holiday_date'),
      db.from('comp_off_ledger').select('*').order('earned_on', { ascending: false }),
    ])
    setTeam(a.data ?? [])
    setOnLeave((l.data ?? []).map((x) => x.employee_id))
    setHolidays(h.data ?? [])
    setCompOffTeam(c.data ?? [])
  }, [date, canViewTeam])
  useEffect(() => { if (tab === 'team') loadTeam() }, [tab, loadTeam])
  useEffect(() => subscribe((evt) => { if (evt === 'shift' && tab === 'team') loadTeam() }), [subscribe, tab, loadTeam])
  useEffect(() => { if (me) db.from('company_holidays').select('*').order('holiday_date').then(({ data }) => setHolidays(data ?? [])) }, [me?.id])

  const summary = useMemo(() => {
    const c = { present: 0, wfh: 0, half_day: 0, absent: 0, leave: 0 }
    for (const r of mine ?? []) if (r.status in c) c[r.status]++
    return c
  }, [mine])

  // ---- team editing ----
  const teamRows = useMemo(() => {
    const byEmp = Object.fromEntries((team ?? []).map((r) => [r.employee_id, r]))
    const staff = canManage ? refs.activeStaff : refs.activeStaff.filter((e) => e.reporting_to === me.id)
    return staff.map((e) => ({ emp: e, rec: byEmp[e.id], leave: onLeave.includes(e.id) }))
  }, [team, onLeave, refs.activeStaff, canManage, me.id])

  const counts = useMemo(() => {
    let present = 0, leave = 0, unmarked = 0
    for (const r of teamRows) {
      if (r.rec && ['present', 'wfh', 'half_day'].includes(r.rec.status)) present++
      else if (r.leave || r.rec?.status === 'leave') leave++
      else if (!r.rec) unmarked++
    }
    return { present, leave, unmarked }
  }, [teamRows])

  const openEdit = ({ emp, rec, leave }) =>
    setEdit({
      employee: emp, id: rec?.id,
      status: rec?.status ?? (leave ? 'leave' : 'present'),
      check_in: timeInput(rec?.check_in), check_out: timeInput(rec?.check_out), note: rec?.note ?? '',
    })

  const addHoliday = async (e) => {
    e.preventDefault()
    if (!holidayDate || !holidayName.trim()) return toast.error('Holiday date and name are required.')
    const { error } = await db.from('company_holidays').insert({ holiday_date: holidayDate, name: holidayName.trim() })
    if (error) return toast.error(error.message)
    toast.success('Company holiday added')
    setHolidayName('')
    await loadTeam()
  }
  const removeHoliday = async (h) => {
    if (!window.confirm(`Remove company holiday ${h.name}?`)) return
    const { error } = await db.from('company_holidays').delete().eq('id', h.id)
    if (error) return toast.error(error.message)
    await loadTeam()
  }

  const saveEdit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await db.from('attendance').upsert(
      {
        employee_id: edit.employee.id, date, status: edit.status,
        check_in: toTimestamp(date, edit.check_in), check_out: toTimestamp(date, edit.check_out), note: edit.note || null,
      },
      { onConflict: 'employee_id,date' },
    )
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Attendance saved')
    setEdit(null)
    loadTeam()
    if (edit.employee.id === me.id) loadMine()
  }

  const tabs = [{ value: 'mine', label: 'My attendance' }]
  if (canViewTeam) tabs.push({ value: 'team', label: 'Team attendance' })
  if (canApprove) tabs.push({ value: 'approvals', label: 'Approvals' })

  return (
    <>
      <PageHeader title="Attendance" subtitle="Check in when you start and check out when you finish." />
      {tabs.length > 1 && <div className="max-w-full overflow-x-auto"><Tabs value={tab} onChange={setTab} tabs={tabs} /></div>}

      {tab === 'approvals' && canApprove ? <Approvals /> : tab === 'mine' || !canViewTeam ? (
        <>
          {holidays.some((h) => h.holiday_date === today) && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Company holiday: {holidays.find((h) => h.holiday_date === today)?.name}. If you work and complete check-in/check-out, comp-off is credited automatically after verification.</div>}
          <ShiftCard onChanged={() => { if (month !== currentMonth()) setMonth(currentMonth()); else loadMine() }} />

          <div className="mb-4 flex items-center gap-3">
            <input type="month" className="input w-auto" value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            <span className="text-sm text-gray-500">{daysInMonth(month)} days in month</span>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Present" value={summary.present} />
            <StatCard label="WFH" value={summary.wfh} />
            <StatCard label="Half day" value={summary.half_day} />
            <StatCard label="Absent" value={summary.absent} />
            <StatCard label="Leave" value={summary.leave} />
          </div>

          <div className="card overflow-hidden">
            {mine === null ? <Loading /> : mine.length === 0 ? <Empty>No attendance recorded this month.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="bg-gray-50"><tr><th className="th">Date</th><th className="th">Status</th><th className="th">In</th><th className="th">Out</th><th className="th">Where</th><th className="th">Approval / note</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {mine.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="td whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="td"><StatusBadge status={r.status} /></td>
                        <td className="td"><TimePair typed={r.check_in} system={r.check_in_system} /></td>
                        <td className="td"><TimePair typed={r.check_out} system={r.check_out_system} /></td>
                        <td className="td"><Where lat={r.check_in_lat} lng={r.check_in_lng} accuracy={r.check_in_accuracy} office={r.check_in_office_network} /></td>
                        <td className="td text-xs text-gray-600">
                          {r.approval_status && r.approval_status !== 'not_required' && <Badge tone={APPROVAL_TONE[r.approval_status]}>{label(r.approval_status)}</Badge>}
                          {r.review_note && <div className="mt-1">HR: {r.review_note}</div>}
                          {r.check_in_reason && <div className="mt-1">You: {r.check_in_reason}</div>}
                          {r.note && <div className="mt-1">{r.note}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {canManageHolidays && <div className="card mb-4 p-4"><h3 className="mb-3 font-semibold">Company off days</h3><form onSubmit={addHoliday} className="flex flex-wrap gap-2"><input type="date" className="input w-auto" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} required /><input className="input min-w-[180px] flex-1" placeholder="Holiday name" value={holidayName} onChange={(e) => setHolidayName(e.target.value)} required /><button className="btn btn-primary" type="submit"><CalendarPlus size={15} /> Add holiday</button></form><div className="mt-3 space-y-2">{holidays.map((h) => <div key={h.id} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm"><span>{fmtDate(h.holiday_date)} · {h.name}</span><button className="btn btn-ghost btn-sm text-red-600" onClick={() => removeHoliday(h)}><Trash2 size={14} /> Remove</button></div>)}</div></div>}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input type="date" className="input w-auto" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Present / WFH" value={counts.present} />
            <StatCard label="On leave" value={counts.leave} />
            <StatCard label="Not marked" value={counts.unmarked} />
            <StatCard label="Comp-off earned" value={compOffTeam.reduce((sum, x) => sum + Number(x.days || 0), 0)} hint="Team total, where visible" />
          </div>
          <div className="card overflow-hidden">
            {team === null ? <Loading /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px]">
                  <thead className="bg-gray-50"><tr><th className="th">Employee</th><th className="th">Status</th><th className="th">In</th><th className="th">Out</th><th className="th">Check-in place</th><th className="th">Check-out place</th><th className="th" /></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {teamRows.map((r) => (
                      <tr key={r.emp.id} className="align-top">
                        <td className="td"><div className="font-semibold">{r.emp.full_name}</div><div className="text-xs text-gray-500">{refs.desigName(r.emp.designation_id)}</div></td>
                        <td className="td">
                          {r.rec ? <StatusBadge status={r.rec.status} /> : r.leave ? <StatusBadge status="leave" /> : <span className="text-xs text-gray-400">Not marked</span>}
                          {r.rec?.approval_status === 'pending' && <div className="mt-1"><Badge tone="amber">Awaiting approval</Badge></div>}
                        </td>
                        <td className="td"><TimePair typed={r.rec?.check_in} system={r.rec?.check_in_system} /></td>
                        <td className="td"><TimePair typed={r.rec?.check_out} system={r.rec?.check_out_system} /></td>
                        <td className="td"><Where lat={r.rec?.check_in_lat} lng={r.rec?.check_in_lng} accuracy={r.rec?.check_in_accuracy} office={r.rec?.check_in_office_network} /></td>
                        <td className="td"><Where lat={r.rec?.check_out_lat} lng={r.rec?.check_out_lng} accuracy={r.rec?.check_out_accuracy} office={r.rec?.check_out_office_network} /></td>
                        <td className="td text-right">{canManage && <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>{r.rec ? 'Edit' : 'Mark'}</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? `${edit.employee.full_name} · ${fmtDate(date)}` : ''}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button form="att-form" className="btn btn-primary" disabled={busy}>Save</button>
          </>
        }
      >
        {edit && (
          <form id="att-form" onSubmit={saveEdit}>
            <FormGrid
              values={edit}
              setValues={setEdit}
              refs={refs}
              fields={[
                { name: 'status', label: 'Status', type: 'select', required: true, options: STATUS_OPTIONS, full: true },
                { name: 'check_in', label: 'Check in', type: 'time' },
                { name: 'check_out', label: 'Check out', type: 'time' },
                { name: 'note', label: 'Note', type: 'textarea', rows: 2 },
              ]}
            />
          </form>
        )}
      </Modal>
    </>
  )
}
