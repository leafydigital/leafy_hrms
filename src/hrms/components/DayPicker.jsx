import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// Month calendar with a checkbox on every day. `allowed(date)` limits which days can be ticked.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function DayPicker({ value = [], onChange, allowed = () => true, initialMonth, highlight = [] }) {
  const selected = useMemo(() => new Set(value), [value])
  const marks = useMemo(() => new Set(highlight), [highlight])
  const [cursor, setCursor] = useState(() => {
    const base = initialMonth ? new Date(`${initialMonth.slice(0, 7)}-01T00:00:00`) : new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const cells = useMemo(() => {
    const first = new Date(cursor)
    const lead = (first.getDay() + 6) % 7 // Monday-first
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))]
  }, [cursor])

  const toggle = (d) => {
    const k = iso(d)
    if (!allowed(k)) return
    const next = new Set(selected)
    next.has(k) ? next.delete(k) : next.add(k)
    onChange([...next].sort())
  }
  const monthDays = cells.filter(Boolean).map(iso).filter(allowed)
  const allPicked = monthDays.length > 0 && monthDays.every((d) => selected.has(d))
  const toggleMonth = () => {
    const next = new Set(selected)
    monthDays.forEach((d) => (allPicked ? next.delete(d) : next.add(d)))
    onChange([...next].sort())
  }

  return (
    <div className="select-none rounded-xl border border-gray-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="rounded-md p-1.5 hover:bg-gray-100" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
        <div className="text-sm font-bold">{cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
        <button type="button" className="rounded-md p-1.5 hover:bg-gray-100" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEK.map((w) => <div key={w} className={`py-1 text-[11px] font-semibold uppercase ${w === 'Sun' || w === 'Sat' ? 'text-red-400' : 'text-gray-500'}`}>{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`x${i}`} />
          const k = iso(d)
          const ok = allowed(k)
          const on = selected.has(k)
          return (
            <label key={k} className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-sm transition ${!ok ? 'cursor-not-allowed text-gray-300' : on ? 'cursor-pointer bg-lime-100 font-bold text-leaf-800' : 'cursor-pointer hover:bg-gray-50'} ${marks.has(k) ? 'ring-1 ring-sky-300' : ''}`}>
              <span className={(d.getDay() === 0 || d.getDay() === 6) && ok && !on ? 'text-red-500' : ''}>{d.getDate()}</span>
              <input type="checkbox" className="h-3.5 w-3.5 accent-leaf-600" checked={on} disabled={!ok} onChange={() => toggle(d)} aria-label={k} />
            </label>
          )
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        <span>{value.length} day{value.length === 1 ? '' : 's'} selected</span>
        {monthDays.length > 0 && <button type="button" className="font-semibold text-leaf-700 hover:underline" onClick={toggleMonth}>{allPicked ? 'Clear this month' : 'Select all available'}</button>}
      </div>
    </div>
  )
}
