import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { label as pretty } from '../lib/format'

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

const TONES = {
  green: 'bg-lime-100 text-leaf-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-gray-100 text-gray-700',
  blue: 'bg-sky-100 text-sky-800',
  dark: 'bg-ink text-lime-400',
}
export function Badge({ tone = 'gray', children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  )
}

const STATUS_TONE = {
  active: 'green', inactive: 'gray', resigned: 'red', prospect: 'amber',
  pending: 'amber', cancellation_requested: 'blue', approved: 'green', rejected: 'red', cancelled: 'gray',
  draft: 'amber', published: 'blue', paid: 'green',
  present: 'green', absent: 'red', half_day: 'amber', wfh: 'blue', leave: 'amber', holiday: 'gray',
  planning: 'gray', on_hold: 'amber', completed: 'green',
  todo: 'gray', in_progress: 'blue', review: 'amber', done: 'green',
  low: 'gray', medium: 'blue', high: 'amber', urgent: 'red',
  admin: 'dark', hr: 'blue', accounts: 'amber', employee: 'gray', ceo: 'dark', cto: 'dark', coo: 'dark',
}
export const StatusBadge = ({ status }) =>
  status ? <Badge tone={STATUS_TONE[status] ?? 'gray'}>{pretty(status)}</Badge> : null

export function Spinner({ className = '' }) {
  return <Loader2 className={`animate-spin text-leaf-600 ${className}`} size={20} />
}

export function Loading({ text = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
      <Spinner /> {text}
    </div>
  )
}

export function Empty({ children = 'Nothing here yet.' }) {
  return <div className="px-4 py-12 text-center text-sm text-gray-500">{children}</div>
}

export function StatCard({ label, value, icon: Icon, hint }) {
  return (
    <div className="card flex items-start justify-between p-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
      </div>
      {Icon && (
        <div className="rounded-lg bg-ink p-2 text-lime-400">
          <Icon size={18} />
        </div>
      )}
    </div>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 inline-flex rounded-lg bg-gray-200/70 p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`rounded-md px-3.5 py-1.5 text-sm font-semibold transition ${
            value === t.value ? 'bg-white shadow-sm' : 'text-gray-600 hover:text-ink'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const width = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size]
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/60 p-4 sm:p-8">
      <div className={`card w-full ${width}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-500 hover:bg-gray-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

// ---- Toasts -------------------------------------------------------------
const ToastCtx = createContext(null)
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((type, message) => {
    const id = crypto.randomUUID()
    setItems((x) => [...x, { id, type, message }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4500)
  }, [])
  const api = { success: (m) => push('ok', m), error: (m) => push('err', m) }
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
              t.type === 'ok' ? 'bg-ink text-white' : 'bg-red-600 text-white'
            }`}
          >
            {t.type === 'ok' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-lime-400" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---- Form helpers ---------------------------------------------------------
const INVALID = ' border-red-500 bg-red-50/40 focus:border-red-500 focus:ring-red-300/50'

export function FieldError({ children, id }) {
  if (!children) return null
  return <p id={id} role="alert" className="mt-1 flex items-start gap-1 text-xs font-medium text-red-600"><AlertCircle size={13} className="mt-px shrink-0" />{children}</p>
}

export function FieldInput({ field, value, onChange, refs, invalid }) {
  const { type = 'text', options, placeholder, required, step, disabled, rows = 3 } = field
  const opts = typeof options === 'function' ? options(refs) : options
  const common = {
    required, disabled, placeholder, name: field.name, id: `f-${field.name}`,
    'aria-invalid': invalid ? 'true' : undefined, 'aria-describedby': invalid ? `f-${field.name}-err` : undefined,
  }
  const cls = `input${invalid ? INVALID : ''}`
  if (type === 'select')
    return (
      <select className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common}>
        <option value="">{field.emptyLabel ?? 'Select…'}</option>
        {(opts ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  if (type === 'textarea')
    return <textarea className={cls} rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />
  if (type === 'checkbox')
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-leaf-600" checked={!!value} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
        {field.checkLabel ?? field.label}
      </label>
    )
  return (
    <input
      className={cls}
      type={type}
      step={type === 'number' ? step ?? 'any' : undefined}
      min={field.min}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      {...common}
    />
  )
}

/** errors: { fieldName: message } shown in red under each field; setErrors clears a field's error as it is edited. */
export function FormGrid({ fields, values, setValues, refs, errors = {}, setErrors }) {
  const setField = (f, val) => {
    setValues((v) => ({ ...v, [f.name]: val, ...(f.onChange ? f.onChange(val, v, refs) : {}) }))
    if (errors[f.name] && setErrors) setErrors((e) => { const n = { ...e }; delete n[f.name]; return n })
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields
        .filter((f) => !f.hidden?.(values))
        .map((f) => (
          <div key={f.name} className={f.full || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
            {f.type !== 'checkbox' && (
              <label className={`label${errors[f.name] ? ' text-red-600' : ''}`} htmlFor={`f-${f.name}`}>
                {f.label}
                {f.required && <span className="text-red-500"> *</span>}
              </label>
            )}
            <FieldInput field={f} value={values[f.name]} onChange={(v) => setField(f, v)} refs={refs} invalid={!!errors[f.name]} />
            {errors[f.name] ? <FieldError id={`f-${f.name}-err`}>{errors[f.name]}</FieldError> : f.hint && <p className="mt-1 text-xs text-gray-500">{f.hint}</p>}
          </div>
        ))}
    </div>
  )
}

// Convert form strings into DB-ready values ('' → null, numbers → Number)
export function cleanValues(fields, values) {
  const out = {}
  for (const f of fields) {
    if (f.readOnly) continue
    let v = values[f.name]
    if (f.type === 'checkbox') v = !!v
    else if (f.type === 'number') v = v === '' || v == null ? (f.nullable ? null : 0) : Number(v)
    else if (v === '' || v === undefined) v = null
    out[f.name] = v
  }
  return out
}

/** Scrolls to and focuses the first field that has an error. */
export function focusFirstError(errors, order = []) {
  const names = [...order.filter((n) => errors[n]), ...Object.keys(errors).filter((n) => !order.includes(n))]
  const el = names.length ? document.getElementById(`f-${names[0]}`) : null
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => el.focus({ preventScroll: true }), 250) }
}

export const confirmDelete = (what = 'this record') => window.confirm(`Delete ${what}? This cannot be undone.`)
