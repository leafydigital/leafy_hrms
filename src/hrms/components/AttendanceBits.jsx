import { MapPin, Pencil, Wifi, WifiOff } from 'lucide-react'
import { mapLink } from '../lib/geo'
import { fmtDate, fmtTime, label } from '../lib/format'
import { halfLabel } from '../lib/attendanceMonth'
import { Badge, StatusBadge } from './ui'

export const APPROVAL_TONE = { pending: 'amber', approved: 'green', rejected: 'red' }

/** Typed time, with the actual (system) time underneath when they differ. */
export function TimePair({ typed, system }) {
  if (!typed && !system) return <span className="text-gray-400">—</span>
  const differs = system && typed && Math.abs(new Date(typed) - new Date(system)) >= 60000
  return (
    <div>
      <div className="font-medium">{fmtTime(typed ?? system)}</div>
      {differs && <div className="text-[11px] text-gray-500">actual {fmtTime(system)}</div>}
    </div>
  )
}

export function Where({ lat, lng, accuracy, office, ip }) {
  const link = mapLink(lat, lng)
  if (office == null && !ip && !link) return <span className="text-gray-300">—</span>
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

/**
 * The attendance table (Date · Status · In · Out · Where · Approval / note).
 * rows: [{ d, a (attendance row), leave, holiday, kind, session }] — e.g. dayInfo() results.
 * onEdit(row) shows a Mark / Edit button (HR / Admin).
 */
export function AttendanceTable({ rows, refs, onEdit, showIp }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead className="bg-gray-50"><tr><th className="th">Date</th><th className="th">Status</th><th className="th">In</th><th className="th">Out</th><th className="th">Where</th><th className="th">Approval / note</th>{onEdit && <th className="th" />}</tr></thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => {
            const a = r.a
            const leaveName = r.leave && refs?.leaveType(r.leave.leave_type_id)?.name
            return (
              <tr key={r.d} className="align-top">
                <td className="td whitespace-nowrap">{fmtDate(r.d)}</td>
                <td className="td">
                  {a ? <StatusBadge status={a.status} /> : r.holiday ? <Badge tone="blue">Holiday</Badge> : r.leave ? <Badge tone={r.leave.status === 'approved' ? 'amber' : 'gray'}>Leave{r.leave.status !== 'approved' ? ' (pending)' : ''}</Badge> : r.weekend ? <Badge tone="gray">Weekend</Badge> : <span className="text-xs text-gray-400">Not marked</span>}
                  {a?.work_mode === 'wfh' && a.status !== 'wfh' && <div className="mt-1"><Badge tone="blue">WFH</Badge></div>}
                  {r.kind === 'half' && <div className="mt-1 text-xs text-amber-700">{halfLabel(r.session)}</div>}
                </td>
                <td className="td"><TimePair typed={a?.check_in} system={a?.check_in_system} /></td>
                <td className="td"><TimePair typed={a?.check_out} system={a?.check_out_system} /></td>
                <td className="td"><Where lat={a?.check_in_lat} lng={a?.check_in_lng} accuracy={a?.check_in_accuracy} office={a?.check_in_office_network} ip={showIp ? a?.check_in_ip : null} /></td>
                <td className="td max-w-md text-xs text-gray-600">
                  {a?.approval_status && a.approval_status !== 'not_required' && <Badge tone={APPROVAL_TONE[a.approval_status]}>{label(a.approval_status)}</Badge>}
                  {a?.review_note && <div className="mt-1">HR: {a.review_note}</div>}
                  {a?.check_in_reason && <div className="mt-1">Employee: {a.check_in_reason}</div>}
                  {a?.check_out_reason && <div className="mt-1">Check-out: {a.check_out_reason}</div>}
                  {a?.note && <div className="mt-1">{a.note}</div>}
                  {r.holiday && <div className="mt-1 font-medium text-sky-800">{r.holiday.name}</div>}
                  {leaveName && <div className="mt-1">{leaveName}{r.leave.half_day ? ` · ${halfLabel(r.leave.half_day_session)}` : ''}{r.leave.reason ? ` — “${r.leave.reason}”` : ''}</div>}
                  {r.earned && <div className="mt-1 text-sky-800">Comp-off earned ({r.earned.days} day): {r.earned.remaining <= 0 ? `used on ${r.earned.usedOn.map(fmtDate).join(', ')}` : r.earned.usedOn.length ? `partly used, ${r.earned.remaining} left` : 'not used yet'}</div>}
                </td>
                {onEdit && <td className="td text-right"><button className="btn btn-ghost btn-sm" onClick={() => onEdit(r)}><Pencil size={13} /> {a ? 'Edit' : 'Mark'}</button></td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
