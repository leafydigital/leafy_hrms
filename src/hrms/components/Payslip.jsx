import { fmtDate, inr2, monthLabel } from '../lib/format'

const num = (v) => Number(v || 0)

/**
 * Payslip document. With `protect` (employee view) it is read-only on screen: no text
 * selection, no right-click menu, hidden when printing, and watermarked with the viewer's name.
 * Note: nothing in a browser can fully stop a screenshot — this deters casual copying.
 */
export default function Payslip({ row, person, protect = false }) {
  const earnings = [
    ['Basic', row.basic], ['HRA', row.hra], ['Conveyance allowance', row.conveyance_allowance], ['Defray expenses', row.defray_expenses], ['Other allowances', row.allowances], ['Bonus / incentive', row.bonus],
  ]
  const deductions = [
    ['Provident fund', row.pf], ['TDS / tax', row.tax], ['Other deductions', row.other_deductions],
    [`Loss of pay (${num(row.lop_days)} day${num(row.lop_days) === 1 ? '' : 's'})`, row.lop_amount],
  ]

  const mark = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><text x="20" y="100" transform="rotate(-24 130 80)" font-family="Arial" font-size="15" fill="#428638" fill-opacity="0.10">Confidential · ${person.name}</text></svg>`,
  )

  return (
    <div
      className={`card relative overflow-hidden ${protect ? 'no-copy no-print' : ''}`}
      style={protect ? { backgroundImage: `url("data:image/svg+xml,${mark}")` } : undefined}
      onContextMenu={protect ? (e) => e.preventDefault() : undefined}
      onCopy={protect ? (e) => e.preventDefault() : undefined}
      onDragStart={protect ? (e) => e.preventDefault() : undefined}
    >
      <div className="flex items-center justify-between border-b-4 border-lime-500 bg-ink px-6 py-4">
        <img src={`${__HRMS_BASE__}/logo-white.png`} alt="Leafy Digital" className="h-14 w-auto" />
        <div className="text-right text-white">
          <div className="text-xs uppercase tracking-widest text-lime-400">Payslip</div>
          <div className="text-lg font-bold">{monthLabel(row.month)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-6 py-5 text-sm sm:grid-cols-4">
        {[
          ['Employee', person.name], ['Employee ID', person.code], ['Department', person.department],
          ['Designation', person.designation], ['Pay days', `${row.working_days - num(row.lop_days)} / ${row.working_days}`],
          ['Bank account', person.bank ?? '—'], ['PAN', person.pan ?? '—'], ['Paid on', row.paid_on ? fmtDate(row.paid_on) : 'Pending'],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</div>
            <div className="font-medium">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-px border-y border-gray-200 bg-gray-200 sm:grid-cols-2">
        {[['Earnings', earnings, row.gross, 'Gross earnings'], ['Deductions', deductions, row.total_deductions, 'Total deductions']].map(([title, items, total, totalLabel]) => (
          <div key={title} className="bg-white">
            <div className="bg-gray-50 px-6 py-2 text-xs font-bold uppercase tracking-wide text-gray-600">{title}</div>
            <div className="divide-y divide-gray-100 px-6">
              {items.map(([k, v]) => (
                <div key={k} className="flex justify-between py-2 text-sm"><span>{k}</span><span className="tabular-nums">{inr2(v)}</span></div>
              ))}
              <div className="flex justify-between py-2.5 text-sm font-bold"><span>{totalLabel}</span><span className="tabular-nums">{inr2(total)}</span></div>
            </div>
          </div>
        ))}
      </div>

      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Employer contributions · included in CTC, not deducted from net pay</div>
        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-gray-500">Employer PF</div><b>{inr2(row.employer_pf)}</b></div>
          <div><div className="text-xs text-gray-500">Employer ESI</div><b>{inr2(row.employer_esi)}</b></div>
          <div><div className="text-xs text-gray-500">Fixed CTC / month</div><b>{inr2(num(row.gross) + num(row.employer_pf) + num(row.employer_esi))}</b></div>
          <div><div className="text-xs text-gray-500">Fixed CTC / year</div><b>{inr2((num(row.gross) + num(row.employer_pf) + num(row.employer_esi)) * 12)}</b></div>
        </div>
      </div>

      <div className="flex items-center justify-between bg-lime-100 px-6 py-4">
        <span className="text-sm font-bold uppercase tracking-wide text-leaf-800">Net pay</span>
        <span className="text-2xl font-bold tabular-nums text-ink">{inr2(row.net_pay)}</span>
      </div>
      <p className="px-6 py-3 text-center text-xs text-gray-400">This is a system-generated payslip and does not require a signature.</p>
    </div>
  )
}
