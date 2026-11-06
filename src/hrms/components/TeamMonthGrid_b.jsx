import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useRefs } from '../lib/refs'
import { monthEnd, monthStart, todayIST } from '../lib/format'
import { dayInfo, daysOf, dow, loadMonth, monthSummary } from '../lib/attendanceMonth'
import { AttendanceTable } from './AttendanceBits'
import { CELL_STYLE, DayMark, Legend } from './EmployeeCalendar'
import { Empty, Loading } from './ui'

// All employees × all days of the month. Click a day to see its details (and Mark / Edit for HR);
// click a name to open that employee's full calendar.
const ym = (d) => d.slice(0, 7)
const addMonths = (month, n) => { const d = new Date(`${month}-01T00:00:00`); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export default function TeamMonthGrid({ employees, onEdit, onOpenEmployee, reloadKey = 0 }) {
  const refs = useRefs()
  const today = todayIST()
  const [month, setMonth] = useState(ym(today))
  const [data, setData] = useState(null)
  const [picked, setPicked] = useState(null) // { empId, d }

  const load = useCallback(async () => {
    setData(null)
    setData(await loadMonth({ month, leaveTypes: refs.leaveTypes }))
  }, [month, refs.leaveTypes])
  useEffect(() => { load() }, [load, reloadKey])
  useEffect(() => { setPicked(null) }, [month])

  const days = useMemo(() => daysOf(monthStart(month), monthEnd(month)), [month])
  const rows = useMemo(() => {
    if (!data) return []
    return employees.map((e) => {
      const cells = days.map((d) => dayInfo(data, e, d, today))
      return { emp: e, cells, sum: monthSummary(cells, data, e.id) }
    })
  }, [data, employees, days, today])

  const pickedRow = picked && rows.find((r) => r.emp.id === picked.empId)
  const pickedCell = pickedRow?.cells.find((c) => c.d === picked.d)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
        <input type="month" className="input w-auto" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        <div className="ml-auto"><Legend /></div>
      </div>

      {!data ? <Loading /> : rows.length === 0 ? <Empty>No employees match your search.</Empty> : (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[180px] border-b border-gray-200 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-500">Employee</th>
                {days.map((d) => {
                  const wk = [0, 6].includes(dow(d)), hol = data.holidays[d]
                  return (
                    <th key={d} title={hol?.name} className={`min-w-[34px] border-b border-gray-200 px-0.5 py-1 text-center font-semibold ${hol ? 'bg-sky-100 text-sky-800' : wk ? 'bg-gray-100 text-red-400' : 'bg-gray-50 text-gray-500'} ${d === today ? 'outline outline-2 outline-lime-400' : ''}`}>
                      <div>{Number(d.slice(8))}</div><div className="text-[9px]">{LETTER[dow(d)]}</div>
                    </th>
                  )
                })}
                <th className="border-b border-gray-200 bg-gray-50 px-2 py-2 text-center font-semibold text-gray-500" title="Present days (half day = 0.5)">P</th>
                <th className="border-b border-gray-200 bg-gray-50 px-2 py-2 text-center font-semibold text-gray-500" title="Leave days">L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.emp.id}>
                  <td className="sticky left-0 z-10 border-b border-gray-100 bg-white px-3 py-1.5">
                    <button className="flex items-center gap-1.5 text-left font-semibold hover:text-leaf-700 hover:underline" onClick={() => onOpenEmployee?.(r.emp)} title="Open full calendar">
                      <CalendarDays size={13} className="shrink-0 text-gray-400" />
                      <span className="truncate">{r.emp.full_name}</span>
                    </button>
                    <div className="pl-5 text-[10px] text-gray-500">{r.emp.emp_code}</div>
                  </td>
                  {r.cells.map((c) => (
                    <td key={c.d} className="border-b border-gray-100 p-0.5">
                      <button type="button" onClick={() => setPicked(picked?.empId === r.emp.id && picked.d === c.d ? null : { empId: r.emp.id, d: c.d })}
                        title={`${r.emp.full_name} · ${c.d}${c.holiday ? ` · ${c.holiday.name}` : ''}`}
                        className={`flex h-8 w-8 items-center justify-center rounded border ${CELL_STYLE[c.kind]} ${picked?.empId === r.emp.id && picked.d === c.d ? 'ring-2 ring-leaf-600' : ''} hover:shadow-sm`}>
                        <DayMark c={c} refs={refs} compact />
                      </button>
                    </td>
                  ))}
                  <td className="border-b border-gray-100 px-2 text-center font-bold">{r.sum.present}</td>
                  <td className="border-b border-gray-100 px-2 text-center font-bold text-red-600">{r.sum.leave}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pickedCell && (
        <div className="card mt-4 overflow-hidden">
          <div className="border-b border-gray-100 px-4 py-2 text-sm font-bold">{pickedRow.emp.full_name} <span className="font-normal text-gray-500">· {pickedRow.emp.emp_code}</span></div>
          <AttendanceTable rows={[pickedCell]} refs={refs} showIp
            onEdit={onEdit ? (row) => onEdit({ employee: pickedRow.emp, date: row.d, rec: row.a, leave: row.leave }) : undefined} />
        </div>
      )}
    </div>
  )
}
