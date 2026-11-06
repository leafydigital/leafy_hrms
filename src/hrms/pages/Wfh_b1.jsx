import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Home, Plus, XCircle } from 'lucide-react'
import { api } from '../lib/db'
import { useRealtime } from '../lib/realtime'
import { fmtDate, todayIST } from '../lib/format'
import DayPicker from '../components/DayPicker'
import { Badge, Empty, FieldError, Loading, Modal, PageHeader, StatusBadge, Tabs, useToast } from '../components/ui'

const datesBetween = (a, b) => {
  const out = []
  for (let d = new Date(`${a}T00:00:00Z`), e = new Date(`${b}T00:00:00Z`); d <= e; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10))
  return out
}
const short = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })

function RequestTable({ rows, review, onReview, onCancel }) {
  if (rows === null) return <Loading />
  if (!rows.length) return <Empty>{review ? 'No work-from-home requests from your team.' : 'You have not requested work from home yet.'}</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead className="bg-gray-50"><tr>{review && <th className="th">Employee</th>}<th className="th">Dates</th><th className="th">Days</th><th className="th">Reason</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              {review && <td className="td"><div className="font-semibold">{r.full_name}</div><div className="text-xs text-gray-500">{r.emp_code}</div></td>}
              <td className="td whitespace-nowrap">{fmtDate(r.start_date)}{r.end_date !== r.start_date && <> → {fmtDate(r.end_date)}</>}</td>
              <td className="td">{r.status === 'approved' ? `${r.approved_dates.length} of ${r.days}` : r.days}</td>
              <td className="td max-w-xs text-sm text-gray-700">{r.reason}{r.requested_by !== r.employee_id && r.requested_by_name && <div className="text-xs text-gray-500">Marked by {r.requested_by_name}</div>}</td>
              <td className="td">
                <StatusBadge status={r.status} />
                {r.status === 'approved' && <div className="mt-1 flex max-w-xs flex-wrap gap-1">{r.approved_dates.map((d) => <Badge key={d} tone="blue">{short(d)}</Badge>)}</div>}
                {r.reviewed_by_name && r.status !== 'pending' && <div className="mt-1 text-xs text-gray-500">by {r.reviewed_by_name}{r.review_note && r.review_note !== r.reason ? ` — “${r.review_note}”` : ''}</div>}
              </td>
              <td className="td text-right">
                {review && r.status === 'pending' && <button className="btn btn-primary btn-sm" onClick={() => onReview(r)}>Review</button>}
                {review && r.status === 'approved' && r.end_date > todayIST() && <button className="btn btn-ghost btn-sm text-red-600" onClick={() => onCancel(r, true)}>Revoke</button>}
                {!review && r.status === 'pending' && <button className="btn btn-ghost btn-sm" onClick={() => onCancel(r)}>Cancel</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Wfh() {
  const toast = useToast()
  const { subscribe } = useRealtime()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'mine'
  const setTab = (t) => setParams(t === 'mine' ? {} : { tab: t }, { replace: true })
  const today = todayIST()

  const [mine, setMine] = useState(null)
  const [team, setTeam] = useState(null)
  const [canReview, setCanReview] = useState(false)
  const [people, setPeople] = useState([])
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [review, setReview] = useState(null)
  const [assign, setAssign] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api('/api/wfh/list', { scope: 'mine' }), api('/api/wfh/list', { scope: 'review' })])
    if (a.error) toast.error(a.error.message)
    setMine(a.data?.rows ?? [])
    setTeam(b.data?.rows ?? [])
    setCanReview(!!b.data?.can_review)
    setPeople(b.data?.team ?? [])
  }, [])
  useEffect(() => { load() }, [load])
  // Dashboard "Request WFH" (/wfh?request=1) opens the request form straight away.
  useEffect(() => {
    if (params.get('request')) { setErrors({}); setForm({ start_date: today, end_date: today, reason: '' }); setParams({}, { replace: true }) }
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => subscribe((evt, data) => { if (evt === 'notice' && /WFH|Work-from-home/i.test(data.title)) load() }), [subscribe, load])

  const pending = useMemo(() => (team ?? []).filter((r) => r.status === 'pending').length, [team])
  const formDays = form?.start_date && form?.end_date && form.end_date >= form.start_date ? datesBetween(form.start_date, form.end_date).length : 0

  const submitRequest = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.start_date) errs.start_date = 'Choose a start date.'
    else if (form.start_date < today) errs.start_date = 'Start date cannot be in the past.'
    if (!form.end_date) errs.end_date = 'Choose an end date.'
    else if (form.start_date && form.end_date < form.start_date) errs.end_date = 'End date must be on or after the start date.'
    if ((form.reason ?? '').trim().length < 3) errs.reason = 'Tell your reporting person why you need to work from home.'
    if (Object.keys(errs).length) return setErrors(errs)
    setBusy(true)
    const { data, error } = await api('/api/wfh/request', form)
    setBusy(false)
    if (error) { if (error.fields) setErrors(error.fields); return toast.error(error.message) }
    toast.success(`Request sent to ${data.notified} approver${data.notified === 1 ? '' : 's'} (reporting person, HR, Admin)`)
    setForm(null)
    load()
  }

  const submitReview = async (decision) => {
    if (decision === 'approve' && !review.dates.length) return toast.error('Tick at least one day to approve.')
    setBusy(true)
    const { error } = await api('/api/wfh/review', { request_id: review.row.id, decision, dates: review.dates, note: review.note })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(decision === 'approve' ? `Approved ${review.dates.length} day(s) — ${review.row.full_name} has been emailed` : 'Request rejected — employee has been emailed')
    setReview(null)
    load()
  }

  const submitAssign = async () => {
    const errs = {}
    if (!assign.employee_id) errs.employee_id = 'Choose an employee.'
    if (!assign.dates.length) errs.dates = 'Tick at least one day.'
    if (Object.keys(errs).length) return setErrors(errs)
    setBusy(true)
    const { error } = await api('/api/wfh/assign', assign)
    setBusy(false)
    if (error) { if (error.fields) setErrors(error.fields); return toast.error(error.message) }
    toast.success('Marked as work from home — employee has been emailed')
    setAssign(null)
    load()
  }

  const cancel = async (r, revoke) => {
    if (!window.confirm(revoke ? `Revoke the remaining WFH days for ${r.full_name}?` : 'Cancel this request?')) return
    const { error } = await api('/api/wfh/cancel', { request_id: r.id })
    if (error) return toast.error(error.message)
    toast.success(revoke ? 'Remaining days revoked' : 'Request cancelled')
    load()
  }

  return (
    <>
      <PageHeader title="Work from home" subtitle="Ask your reporting person, HR or Admin — any one of them can approve. WFH check-in is open 09:00–22:00 IST.">
        <button className="btn btn-primary" onClick={() => { setErrors({}); setForm({ start_date: today, end_date: today, reason: '' }) }}><Plus size={16} /> Request WFH</button>
        {canReview && <button className="btn btn-ghost" onClick={() => { setErrors({}); setAssign({ employee_id: '', dates: [], note: '' }) }}><Home size={16} /> Mark employee as WFH</button>}
      </PageHeader>

      {canReview && (
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'mine', label: 'My requests' }, { value: 'review', label: `Review${pending ? ` (${pending})` : ''}` }]} />
      )}
      <div className="card overflow-hidden">
        {tab === 'review' && canReview
          ? <RequestTable rows={team} review onReview={(r) => setReview({ row: r, dates: datesBetween(r.start_date, r.end_date).filter((d) => new Date(`${d}T00:00:00`).getDay() !== 0), note: '' })} onCancel={cancel} />
          : <RequestTable rows={mine} onCancel={cancel} />}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title="Request work from home"
        footer={<><button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button><button form="wfh-form" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button></>}>
        {form && (
          <form id="wfh-form" onSubmit={submitRequest} noValidate className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={`label${errors.start_date ? ' text-red-600' : ''}`} htmlFor="wfh-start">From</label>
                <input id="wfh-start" type="date" min={today} className={`input${errors.start_date ? ' border-red-500 bg-red-50/40' : ''}`} value={form.start_date} onChange={(e) => { setForm((f) => ({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date })); setErrors((x) => ({ ...x, start_date: undefined })) }} />
                <FieldError>{errors.start_date}</FieldError>
              </div>
              <div>
                <label className={`label${errors.end_date ? ' text-red-600' : ''}`} htmlFor="wfh-end">To</label>
                <input id="wfh-end" type="date" min={form.start_date || today} className={`input${errors.end_date ? ' border-red-500 bg-red-50/40' : ''}`} value={form.end_date} onChange={(e) => { setForm((f) => ({ ...f, end_date: e.target.value })); setErrors((x) => ({ ...x, end_date: undefined })) }} />
                <FieldError>{errors.end_date}</FieldError>
              </div>
            </div>
            <p className="rounded-lg bg-lime-50 px-3 py-2 text-sm text-leaf-800">How many days: <b>{formDays}</b> calendar day{formDays === 1 ? '' : 's'}. Your approver can tick only the days they agree to.</p>
            <div>
              <label className={`label${errors.reason ? ' text-red-600' : ''}`} htmlFor="wfh-reason">Reason</label>
              <textarea id="wfh-reason" rows={3} className={`input${errors.reason ? ' border-red-500 bg-red-50/40' : ''}`} value={form.reason} onChange={(e) => { setForm((f) => ({ ...f, reason: e.target.value })); setErrors((x) => ({ ...x, reason: undefined })) }} />
              <FieldError>{errors.reason}</FieldError>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!review} onClose={() => setReview(null)} size="lg" title={review ? `WFH request · ${review.row.full_name}` : ''}
        footer={<>
          <button className="btn btn-ghost mr-auto text-red-600" onClick={() => submitReview('reject')} disabled={busy}><XCircle size={15} /> Reject</button>
          <button className="btn btn-ghost" onClick={() => setReview(null)}>Close</button>
          <button className="btn btn-leaf" onClick={() => submitReview('approve')} disabled={busy || !review?.dates.length}><CheckCircle2 size={15} /> Approve {review?.dates.length || ''} day{review?.dates.length === 1 ? '' : 's'}</button>
        </>}>
        {review && (
          <div className="grid gap-4 md:grid-cols-[1fr_300px]">
            <DayPicker value={review.dates} onChange={(dates) => setReview((r) => ({ ...r, dates }))} initialMonth={review.row.start_date}
              allowed={(d) => d >= review.row.start_date && d <= review.row.end_date} />
            <div className="space-y-3 text-sm">
              <div className="rounded-lg bg-gray-50 p-3">
                <div className="font-semibold">{fmtDate(review.row.start_date)} → {fmtDate(review.row.end_date)}</div>
                <div className="text-gray-600">{review.row.days} day(s) requested</div>
                <div className="mt-2 text-gray-700">“{review.row.reason}”</div>
              </div>
              <p className="text-xs text-gray-500">Tick the days you approve. Sundays start unticked. The employee gets an email with the approved days.</p>
              <div>
                <label className="label" htmlFor="wfh-note">Note (optional)</label>
                <textarea id="wfh-note" rows={3} className="input" value={review.note} onChange={(e) => setReview((r) => ({ ...r, note: e.target.value }))} />
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!assign} onClose={() => setAssign(null)} size="lg" title="Mark employee as work from home"
        footer={<><button className="btn btn-ghost" onClick={() => setAssign(null)}>Cancel</button><button className="btn btn-primary" onClick={submitAssign} disabled={busy}>Mark {assign?.dates.length || ''} day{assign?.dates.length === 1 ? '' : 's'} as WFH</button></>}>
        {assign && (
          <div className="grid gap-4 md:grid-cols-[1fr_300px]">
            <div>
              <DayPicker value={assign.dates} onChange={(dates) => { setAssign((a) => ({ ...a, dates })); setErrors((x) => ({ ...x, dates: undefined })) }} allowed={(d) => d >= today} />
              <FieldError>{errors.dates}</FieldError>
            </div>
            <div className="space-y-3">
              <div>
                <label className={`label${errors.employee_id ? ' text-red-600' : ''}`} htmlFor="as-emp">Employee</label>
                <select id="as-emp" className={`input${errors.employee_id ? ' border-red-500 bg-red-50/40' : ''}`} value={assign.employee_id} onChange={(e) => { setAssign((a) => ({ ...a, employee_id: e.target.value })); setErrors((x) => ({ ...x, employee_id: undefined })) }}>
                  <option value="">Select…</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                <FieldError>{errors.employee_id}</FieldError>
              </div>
              <div>
                <label className="label" htmlFor="as-note">Note (optional)</label>
                <textarea id="as-note" rows={3} className="input" value={assign.note} onChange={(e) => setAssign((a) => ({ ...a, note: e.target.value }))} />
              </div>
              <p className="text-xs text-gray-500">The employee is emailed the selected days. On those days they can check in from any network (location is still recorded).</p>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
