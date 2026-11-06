import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { can } from '../lib/permissions'
import { fmtDate, todayIST } from '../lib/format'
import { WEEKLY_OFF } from '../lib/leaveBalance'
import { FieldError, Modal, PageHeader, confirmDelete, useToast } from '../components/ui'

// Holiday Calendar: everyone sees it; Admin / HR click a date to add a festival or holiday.
// Holidays (and Saturdays / Sundays) are not counted as leave or loss-of-pay days, and working
// on a holiday earns comp-off.
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const KINDS = {
  festival: { label: 'Festival', cls: 'bg-amber-100 text-amber-900 border-amber-200' },
  national: { label: 'National holiday', cls: 'bg-sky-100 text-sky-900 border-sky-200' },
  company: { label: 'Company holiday', cls: 'bg-lime-100 text-leaf-900 border-lime-200' },
}
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export default function Holidays() {
  const { role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const canManage = can(role, 'holidays', 'manage')
  const today = todayIST()
  const [cursor, setCursor] = useState(() => { const d = new Date(`${today}T00:00:00`); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [edit, setEdit] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const y = cursor.getFullYear(), m = cursor.getMonth()
  const byDate = useMemo(() => Object.fromEntries(refs.holidays.map((h) => [h.holiday_date, h])), [refs.holidays])
  const cells = useMemo(() => {
    const lead = (new Date(y, m, 1).getDay() + 6) % 7
    const n = new Date(y, m + 1, 0).getDate()
    return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => iso(y, m, i + 1))]
  }, [y, m])
  const yearList = refs.holidays.filter((h) => h.holiday_date.startsWith(String(y)))
  const monthCount = refs.holidays.filter((h) => h.holiday_date.startsWith(iso(y, m, 1).slice(0, 7))).length

  const open = (d) => {
    const h = byDate[d]
    if (!canManage && !h) return
    setErrors({})
    setEdit(h ? { ...h, description: h.description ?? '' } : { holiday_date: d, name: '', kind: 'festival', description: '' })
  }

  const save = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!edit.holiday_date) errs.holiday_date = 'Choose a date.'
    if (!edit.name.trim()) errs.name = 'Enter the festival or holiday name.'
    if (!edit.id && byDate[edit.holiday_date]) errs.holiday_date = `${fmtDate(edit.holiday_date)} already has ${byDate[edit.holiday_date].name}.`
    if (Object.keys(errs).length) return setErrors(errs)
    setBusy(true)
    const payload = { holiday_date: edit.holiday_date, name: edit.name.trim(), kind: edit.kind, description: edit.description.trim() || null }
    const { error } = edit.id
      ? await db.from('company_holidays').update(payload).eq('id', edit.id)
      : await db.from('company_holidays').insert(payload)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(edit.id ? 'Holiday updated' : 'Holiday added — shown to everyone')
    setEdit(null)
    refs.reload()
  }
  const remove = async () => {
    if (!confirmDelete(`${edit.name} (${fmtDate(edit.holiday_date)})`)) return
    const { error } = await db.from('company_holidays').delete().eq('id', edit.id)
    if (error) return toast.error(error.message)
    toast.success('Holiday removed')
    setEdit(null)
    refs.reload()
  }

  return (
    <>
      <PageHeader title="Holiday Calendar" subtitle={`Festivals and company holidays. Saturday and Sunday are weekly offs.${canManage ? ' Click a date to add a holiday.' : ''}`}>
        {canManage && <button className="btn btn-primary" onClick={() => open(today)}><Plus size={16} /> Add holiday</button>}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date(y, m - 1, 1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <div className="text-center"><div className="text-lg font-bold">{cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div><div className="text-xs text-gray-500">{monthCount} holiday{monthCount === 1 ? '' : 's'} this month</div></div>
            <button className="btn btn-ghost btn-sm" onClick={() => setCursor(new Date(y, m + 1, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEK.map((w) => <div key={w} className={`pb-1 text-center text-[11px] font-semibold uppercase ${w === 'Sat' || w === 'Sun' ? 'text-red-400' : 'text-gray-500'}`}>{w}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`x${i}`} />
              const h = byDate[d]
              const weekend = WEEKLY_OFF.includes(new Date(`${d}T00:00:00Z`).getUTCDay())
              return (
                <button key={d} type="button" onClick={() => open(d)} disabled={!canManage && !h}
                  className={`flex min-h-[72px] flex-col rounded-lg border p-1.5 text-left transition sm:min-h-[92px] ${h ? KINDS[h.kind]?.cls ?? KINDS.festival.cls : weekend ? 'border-gray-100 bg-gray-100/70' : 'border-gray-100 bg-white'} ${canManage || h ? 'hover:shadow-sm' : 'cursor-default'} ${d === today ? 'outline outline-2 outline-lime-400' : ''}`}>
                  <span className={`text-xs font-semibold ${weekend && !h ? 'text-red-400' : 'text-gray-600'}`}>{Number(d.slice(8))}</span>
                  {h ? <span className="mt-1 line-clamp-3 text-[11px] font-bold leading-tight sm:text-xs">{h.name}</span>
                    : weekend ? <span className="mt-auto text-[10px] text-gray-400">Weekend</span> : null}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            {Object.entries(KINDS).map(([k, v]) => <span key={k} className={`rounded border px-2 py-0.5 ${v.cls}`}>{v.label}</span>)}
            <span className="rounded border border-gray-100 bg-gray-100 px-2 py-0.5 text-gray-600">Weekend (Sat / Sun)</span>
          </div>
        </div>

        <div className="card p-4">
          <h2 className="mb-3 font-bold">{y} holidays ({yearList.length})</h2>
          {yearList.length === 0 ? <p className="text-sm text-gray-500">No holidays added for {y} yet.</p> : (
            <ul className="divide-y divide-gray-100">
              {yearList.map((h) => (
                <li key={h.id}>
                  <button className={`flex w-full items-start gap-3 py-2 text-left ${h.holiday_date < today ? 'opacity-50' : ''}`} onClick={() => { setCursor(new Date(Number(h.holiday_date.slice(0, 4)), Number(h.holiday_date.slice(5, 7)) - 1, 1)); open(h.holiday_date) }}>
                    <span className={`w-14 shrink-0 rounded border px-1 py-1 text-center text-[11px] font-bold leading-tight ${KINDS[h.kind]?.cls ?? KINDS.festival.cls}`}>{new Date(`${h.holiday_date}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{h.name}</span><span className="text-xs text-gray-500">{new Date(`${h.holiday_date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long' })} · {KINDS[h.kind]?.label ?? 'Holiday'}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? (canManage ? 'Edit holiday' : edit.name) : 'Add holiday'}
        footer={canManage ? <>
          {edit?.id && <button type="button" className="btn btn-ghost mr-auto text-red-600" onClick={remove}><Trash2 size={14} /> Remove</button>}
          <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
          <button form="hol-form" className="btn btn-primary" disabled={busy}>{edit?.id ? 'Save' : 'Add holiday'}</button>
        </> : <button className="btn btn-dark" onClick={() => setEdit(null)}>Close</button>}>
        {edit && (canManage ? (
          <form id="hol-form" onSubmit={save} noValidate className="space-y-4">
            <div>
              <label className={`label${errors.holiday_date ? ' text-red-600' : ''}`} htmlFor="h-date">Date</label>
              <input id="h-date" type="date" className={`input${errors.holiday_date ? ' border-red-500 bg-red-50/40' : ''}`} value={edit.holiday_date} onChange={(e) => { setEdit((x) => ({ ...x, holiday_date: e.target.value })); setErrors((x) => ({ ...x, holiday_date: undefined })) }} />
              <FieldError>{errors.holiday_date}</FieldError>
              {edit.holiday_date && WEEKLY_OFF.includes(new Date(`${edit.holiday_date}T00:00:00Z`).getUTCDay()) && <p className="mt-1 text-xs text-amber-700">This date is already a weekend.</p>}
            </div>
            <div>
              <label className={`label${errors.name ? ' text-red-600' : ''}`} htmlFor="h-name">Festival / holiday name</label>
              <input id="h-name" className={`input${errors.name ? ' border-red-500 bg-red-50/40' : ''}`} placeholder="e.g. Onam, Diwali, Republic Day" value={edit.name} onChange={(e) => { setEdit((x) => ({ ...x, name: e.target.value })); setErrors((x) => ({ ...x, name: undefined })) }} autoFocus />
              <FieldError>{errors.name}</FieldError>
            </div>
            <div>
              <label className="label" htmlFor="h-kind">Type</label>
              <select id="h-kind" className="input" value={edit.kind} onChange={(e) => setEdit((x) => ({ ...x, kind: e.target.value }))}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="h-desc">Note (optional)</label>
              <textarea id="h-desc" className="input" rows={2} value={edit.description} onChange={(e) => setEdit((x) => ({ ...x, description: e.target.value }))} />
            </div>
            <p className="text-xs text-gray-500">Everyone sees this day as a holiday in their attendance calendar. It is not counted in leave or loss-of-pay days, and working on it earns comp-off.</p>
          </form>
        ) : (
          <div className="space-y-2 text-sm">
            <div><b>{fmtDate(edit.holiday_date)}</b> · {KINDS[edit.kind]?.label ?? 'Holiday'}</div>
            {edit.description && <p className="text-gray-600">{edit.description}</p>}
          </div>
        ))}
      </Modal>
    </>
  )
}
