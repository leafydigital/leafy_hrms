// Check-in / check-out / breaks / HR approval queue / live shift board.
// The server decides the real time, the client IP and whether HR approval is needed,
// so employees can no longer write the attendance table directly (see migration 005).
import express from 'express'
import { pool, asOwner } from './db.js'
import { sendEmail, safeHtml } from './mailer.js'
import { postMessageSafe, notifyEmployees, publish } from './chat.js'
import {
  ATTENDANCE_APPROVER_ROLES, CONFIG, LEADER_ROLES, activeEmployeesByRole, clientIp, fail, fmt12, fmtHHMM,
  isHHMM, isOfficeIp, istTimestamp, nowIST, withMe, wrap,
} from './common.js'

const REASON_LABEL = {
  late: `Checked in after ${fmtHHMM(CONFIG.lateAfterMin)} IST`,
  time_edited: `Typed time differs from the actual time by more than ${CONFIG.timeEditToleranceMin} minutes`,
  other_network: 'Not on the office network (different IP address)',
}

function readLocation(body) {
  const lat = Number(body?.lat), lng = Number(body?.lng), accuracy = Number(body?.accuracy)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy * 10) / 10 : null }
}

async function wfhDay(employeeId, date) {
  const { rows } = await pool.query('select * from public.wfh_days where employee_id = $1 and wfh_date = $2', [employeeId, date])
  return rows[0] || null
}
/** Approved WFH for that day that the employee has not switched back to office. */
async function isWfhDay(employeeId, date) {
  const d = await wfhDay(employeeId, date)
  return !!d && !d.opted_out_at
}
const isSelfApproved = (me) => CONFIG.selfApprovedRoles.includes(me.role)

const inWfhWindow = (minutes) => minutes >= CONFIG.wfhStartMin && minutes < CONFIG.wfhEndMin
const wfhWindowText = () => `${fmtHHMM(CONFIG.wfhStartMin)}–${fmtHHMM(CONFIG.wfhEndMin)} IST`

async function todayRow(employeeId, date) {
  const { rows } = await pool.query('select * from public.attendance where employee_id = $1 and date = $2', [employeeId, date])
  return rows[0] || null
}

async function openBreak(employeeId) {
  const { rows } = await pool.query('select * from public.attendance_breaks where employee_id = $1 and ended_at is null', [employeeId])
  return rows[0] || null
}

/** Push a "something changed" ping so dashboards refresh their live shift board. */
const shiftChanged = () => publish(null, 'shift', { at: new Date().toISOString() })

async function lopLeaveTypeId(client) {
  const { rows } = await client.query(
    `select id from public.leave_types where is_paid = false
      order by (lower(name) like '%lop%') desc, name limit 1`)
  return rows[0]?.id || null
}

export function attendanceRouter(auth) {
  const r = express.Router()
  r.use(auth, withMe)

  // Everything the check-in card needs: today's record, WFH status, network, rules.
  r.post('/today', wrap(async (req, res) => {
    const now = new Date()
    const { date, minutes } = nowIST(now)
    const ip = clientIp(req)
    const [row, wfhRow, brk, leave] = await Promise.all([
      todayRow(req.me.id, date),
      wfhDay(req.me.id, date),
      openBreak(req.me.id),
      pool.query(`select l.id, l.half_day, t.name from public.leaves l join public.leave_types t on t.id = l.leave_type_id
                   where l.employee_id = $1 and l.status = 'approved' and $2::date between l.start_date and l.end_date limit 1`, [req.me.id, date]),
    ])
    const breaks = row
      ? (await pool.query('select * from public.attendance_breaks where attendance_id = $1 order by started_at', [row.id])).rows
      : []
    const wfhToday = !!wfhRow && !wfhRow.opted_out_at
    res.json({
      server_time: now.toISOString(), date, minutes, ip,
      office_network: isOfficeIp(ip), wfh_today: wfhToday,
      wfh_approved_today: !!wfhRow, wfh_opted_out: !!wfhRow?.opted_out_at,
      approval_exempt: isSelfApproved(req.me),
      wfh_window_open: inWfhWindow(minutes),
      row, breaks, open_break: brk, approved_leave: leave.rows[0] || null,
      rules: {
        late_after: fmtHHMM(CONFIG.lateAfterMin), wfh_start: fmtHHMM(CONFIG.wfhStartMin), wfh_end: fmtHHMM(CONFIG.wfhEndMin),
        time_edit_tolerance_min: CONFIG.timeEditToleranceMin, require_location: CONFIG.requireLocation,
      },
    })
  }))

  r.post('/check-in', wrap(async (req, res) => {
    const me = req.me
    const now = new Date()
    const { date, minutes } = nowIST(now)
    const ip = clientIp(req)
    const office = isOfficeIp(ip)
    const wfh = await isWfhDay(me.id, date)
    const body = req.body || {}

    const existing = await todayRow(me.id, date)
    if (existing?.check_in) return fail(res, 409, 'You have already checked in today.')
    if (existing?.status === 'leave') return fail(res, 409, 'Today is marked as leave. Contact HR if this is wrong.')
    if (wfh && !inWfhWindow(minutes)) {
      return fail(res, 403, `Work-from-home check-in is available only between ${wfhWindowText()}.`)
    }

    const time = String(body.time || '')
    if (!isHHMM(time)) return fail(res, 400, 'Enter your check-in time as HH:MM.', { field: 'time' })
    const typed = istTimestamp(date, time)
    if (typed.getTime() > now.getTime() + 2 * 60 * 1000) return fail(res, 400, 'Check-in time cannot be in the future.', { field: 'time' })

    const location = readLocation(body)
    if (CONFIG.requireLocation && !location) {
      return fail(res, 400, 'Allow location access in your browser so your check-in location can be recorded.', { field: 'location' })
    }

    const reasons = []
    if (minutes > CONFIG.lateAfterMin) reasons.push('late')
    if (Math.abs(typed.getTime() - now.getTime()) > CONFIG.timeEditToleranceMin * 60 * 1000) reasons.push('time_edited')
    if (!wfh && !office) reasons.push('other_network')
    const reason = String(body.reason || '').trim()
    const exempt = isSelfApproved(me)
    if (!exempt && reasons.length && reason.length < 3) {
      return fail(res, 400, 'Please give a reason. This check-in needs HR approval.', {
        field: 'reason', reasons, reason_labels: reasons.map((x) => REASON_LABEL[x]),
      })
    }
    // Admin / HR / senior leadership: no approval step, but the reasons are still kept for the record.
    const pending = !exempt && reasons.length > 0

    const values = {
      check_in: typed.toISOString(), check_in_system: now.toISOString(), check_in_ip: ip,
      check_in_lat: location?.lat ?? null, check_in_lng: location?.lng ?? null, check_in_accuracy: location?.accuracy ?? null,
      check_in_office_network: office, check_in_reason: reason || null,
      status: wfh ? 'wfh' : 'present', work_mode: wfh ? 'wfh' : 'office',
      approval_status: pending ? 'pending' : 'not_required', approval_reasons: reasons,
    }
    const cols = Object.keys(values)
    let row
    if (existing) {
      const sets = cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')
      row = (await pool.query(`update public.attendance set ${sets} where id = $1 returning *`, [existing.id, ...cols.map((c) => values[c])])).rows[0]
    } else {
      row = (await pool.query(
        `insert into public.attendance (employee_id, date, ${cols.map((c) => `"${c}"`).join(', ')})
         values ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')}) returning *`,
        [me.id, date, ...cols.map((c) => values[c])],
      )).rows[0]
    }

    postMessageSafe({
      channel: 'shift-updates', senderId: me.id, kind: 'shift',
      body: `shift in @${fmt12(typed)}${wfh ? ' · WFH' : ''}${pending ? ' · awaiting HR approval' : ''}`,
    })
    shiftChanged()

    if (pending) {
      const approvers = await activeEmployeesByRole(ATTENDANCE_APPROVER_ROLES)
      const reasonText = reasons.map((x) => REASON_LABEL[x]).join('; ')
      notifyEmployees(approvers.filter((a) => a.id !== me.id).map((a) => a.id), {
        title: 'Check-in needs approval',
        body: `${me.full_name} checked in at ${fmt12(typed)} (actual ${fmt12(now)}). ${reasonText}.`,
        link: '/attendance?tab=approvals',
      })
      const hrEmails = approvers.filter((a) => a.id !== me.id).map((a) => a.email)
      const mapLink = location ? `https://www.google.com/maps?q=${location.lat},${location.lng}` : null
      for (const to of hrEmails) {
        sendEmail({
          to, subject: `Check-in approval: ${me.full_name} · ${date}`,
          text: `${me.full_name} checked in on ${date}.\nTyped time: ${fmt12(typed)}\nActual time: ${fmt12(now)}\nIP: ${ip}${mapLink ? `\nLocation: ${mapLink}` : ''}\nWhy approval is needed: ${reasonText}\nEmployee's reason: ${reason}\n\nReview it in HRMS → Attendance → Approvals.`,
          html: `<p><b>${safeHtml(me.full_name)}</b> checked in on ${safeHtml(date)}.</p><ul><li>Typed time: <b>${safeHtml(fmt12(typed))}</b></li><li>Actual time: ${safeHtml(fmt12(now))}</li><li>IP: ${safeHtml(ip)}</li>${mapLink ? `<li>Location: <a href="${mapLink}">open map</a></li>` : ''}<li>Why approval is needed: ${safeHtml(reasonText)}</li><li>Employee's reason: ${safeHtml(reason)}</li></ul><p>Review it in HRMS → Attendance → Approvals.</p>`,
        }).catch((e) => console.error('Approval email failed:', e.message))
      }
    }
    res.json({ row, pending, reasons })
  }))

  r.post('/check-out', wrap(async (req, res) => {
    const me = req.me
    const now = new Date()
    const { date, minutes } = nowIST(now)
    const ip = clientIp(req)
    const body = req.body || {}
    const row = await todayRow(me.id, date)
    if (!row?.check_in) return fail(res, 409, 'You have not checked in today.')
    if (row.check_out) return fail(res, 409, 'You have already checked out today.')
    if (row.status === 'leave') return fail(res, 409, 'Today is marked as leave.')
    if (row.work_mode === 'wfh' && !inWfhWindow(minutes)) {
      return fail(res, 403, `Work-from-home check-out is available only between ${wfhWindowText()}.`)
    }
    const time = String(body.time || '')
    if (!isHHMM(time)) return fail(res, 400, 'Enter your check-out time as HH:MM.', { field: 'time' })
    const typed = istTimestamp(date, time)
    if (typed.getTime() > now.getTime() + 2 * 60 * 1000) return fail(res, 400, 'Check-out time cannot be in the future.', { field: 'time' })
    if (typed.getTime() <= new Date(row.check_in).getTime()) return fail(res, 400, `Check-out must be after your check-in (${fmt12(row.check_in)}).`, { field: 'time' })
    const location = readLocation(body)
    if (CONFIG.requireLocation && !location) {
      return fail(res, 400, 'Allow location access in your browser so your check-out location can be recorded.', { field: 'location' })
    }
    const edited = Math.abs(typed.getTime() - now.getTime()) > CONFIG.timeEditToleranceMin * 60 * 1000
    const reason = String(body.reason || '').trim()
    if (edited && reason.length < 3 && !isSelfApproved(me)) {
      return fail(res, 400, `Your typed time differs from the actual time by more than ${CONFIG.timeEditToleranceMin} minutes. Please give a reason.`, { field: 'reason' })
    }
    await pool.query('update public.attendance_breaks set ended_at = $2 where employee_id = $1 and ended_at is null', [me.id, now.toISOString()])
    const { rows } = await pool.query(
      `update public.attendance set check_out = $2, check_out_system = $3, check_out_ip = $4, check_out_lat = $5, check_out_lng = $6,
              check_out_accuracy = $7, check_out_office_network = $8, check_out_reason = $9
        where id = $1 returning *`,
      [row.id, typed.toISOString(), now.toISOString(), ip, location?.lat ?? null, location?.lng ?? null, location?.accuracy ?? null, isOfficeIp(ip), reason || null],
    )
    postMessageSafe({ channel: 'shift-updates', senderId: me.id, kind: 'shift', body: `shift out @${fmt12(typed)}` })
    shiftChanged()
    res.json({ row: rows[0] })
  }))

  r.post('/break', wrap(async (req, res) => {
    const me = req.me
    const { date } = nowIST()
    const action = req.body?.action
    const row = await todayRow(me.id, date)
    if (!row?.check_in || row.check_out) return fail(res, 409, 'Breaks can be taken only during an open shift.')
    const open = await openBreak(me.id)
    if (action === 'start') {
      if (open) return fail(res, 409, 'You are already on a break.')
      const { rows } = await pool.query(
        'insert into public.attendance_breaks (attendance_id, employee_id) values ($1, $2) returning *', [row.id, me.id])
      postMessageSafe({ channel: 'shift-updates', senderId: me.id, kind: 'shift', body: `break @${fmt12(rows[0].started_at)}` })
      shiftChanged()
      return res.json({ break: rows[0] })
    }
    if (action === 'end') {
      if (!open) return fail(res, 409, 'You are not on a break.')
      const { rows } = await pool.query('update public.attendance_breaks set ended_at = now() where id = $1 returning *', [open.id])
      const mins = Math.round((new Date(rows[0].ended_at) - new Date(rows[0].started_at)) / 60000)
      postMessageSafe({ channel: 'shift-updates', senderId: me.id, kind: 'shift', body: `back from break @${fmt12(rows[0].ended_at)} (${mins} min)` })
      shiftChanged()
      return res.json({ break: rows[0] })
    }
    fail(res, 400, 'Unknown break action')
  }))

  // WFH was approved for today but the employee came to the office (or the reverse, before check-in).
  r.post('/wfh-switch', wrap(async (req, res) => {
    const me = req.me
    const { date, minutes } = nowIST()
    const toOffice = req.body?.mode === 'office'
    const d = await wfhDay(me.id, date)
    if (!d) return fail(res, 409, 'Work from home is not approved for you today.')
    const row = await todayRow(me.id, date)
    if (row?.check_out) return fail(res, 409, 'You have already checked out today.')
    if (!toOffice && row?.check_in) return fail(res, 409, 'You have already started your shift at the office today.')
    if (!toOffice && !inWfhWindow(minutes)) return fail(res, 403, `Work-from-home is available only between ${wfhWindowText()}.`)
    const note = String(req.body?.note || '').trim() || null
    await pool.query(
      `update public.wfh_days set opted_out_at = $2, opted_out_note = $3 where id = $1`,
      [d.id, toOffice ? new Date().toISOString() : null, toOffice ? note : null])
    if (row?.check_in && toOffice) {
      await pool.query(`update public.attendance set work_mode = 'office', status = case when status = 'wfh' then 'present' else status end where id = $1`, [row.id])
    }
    postMessageSafe({ channel: 'shift-updates', senderId: me.id, kind: 'shift',
      body: toOffice ? 'working from the office today (WFH not used)' : 'switched back to work from home today' })
    shiftChanged()
    res.json({ ok: true, wfh_today: !toOffice })
  }))

  // HR / Admin approval queue
  r.post('/approvals', wrap(async (req, res) => {
    if (!ATTENDANCE_APPROVER_ROLES.includes(req.me.role)) return fail(res, 403, 'Only HR or Admin can review check-ins.')
    const reviewed = req.body?.status === 'reviewed'
    const { rows } = await pool.query(
      `select a.*, e.full_name, e.emp_code, rv.full_name as reviewed_by_name
         from public.attendance a join public.employees e on e.id = a.employee_id
         left join public.employees rv on rv.id = a.reviewed_by
        where ${reviewed ? `a.approval_status in ('approved','rejected') and a.date >= (now() at time zone 'Asia/Kolkata')::date - 60` : `a.approval_status = 'pending'`}
        order by a.date desc, a.check_in_system desc limit 300`)
    res.json({ rows, reason_labels: REASON_LABEL })
  }))

  r.post('/review', wrap(async (req, res) => {
    const me = req.me
    if (!ATTENDANCE_APPROVER_ROLES.includes(me.role)) return fail(res, 403, 'Only HR or Admin can review check-ins.')
    const { attendance_id: id, decision, check_in_time: time, note } = req.body || {}
    const { rows } = await pool.query(
      `select a.*, e.full_name, e.email from public.attendance a join public.employees e on e.id = a.employee_id where a.id = $1`, [id])
    const row = rows[0]
    if (!row) return fail(res, 404, 'Attendance record not found')
    if (row.approval_status !== 'pending') return fail(res, 409, 'This check-in has already been reviewed.')
    if (row.employee_id === me.id && me.role !== 'admin') return fail(res, 403, 'You cannot review your own check-in.')
    if (time && !isHHMM(time)) return fail(res, 400, 'Corrected time must be HH:MM.')
    const rejectAction = req.body?.reject_action || (row.approval_reasons.includes('other_network') ? 'leave' : 'system_time')
    const reviewNote = String(note || '').trim() || null

    let summary
    await asOwner(async (c) => {
      if (decision === 'approve') {
        const accepted = time ? istTimestamp(row.date, time) : new Date(row.check_in)
        await c.query(
          `update public.attendance set approval_status = 'approved', check_in = $2, reviewed_by = $3, reviewed_at = now(),
                  review_note = $4, review_action = 'approved' where id = $1`,
          [row.id, accepted.toISOString(), me.id, reviewNote])
        summary = `approved with check-in time ${fmt12(accepted)}`
      } else if (decision === 'reject' && rejectAction === 'system_time') {
        await c.query(
          `update public.attendance set approval_status = 'rejected', check_in = check_in_system, reviewed_by = $2, reviewed_at = now(),
                  review_note = $3, review_action = 'system_time' where id = $1`,
          [row.id, me.id, reviewNote])
        summary = `rejected — your actual check-in time (${fmt12(row.check_in_system)}) is recorded instead`
      } else if (decision === 'reject' && rejectAction === 'leave') {
        await c.query(
          `update public.attendance set approval_status = 'rejected', status = 'leave', reviewed_by = $2, reviewed_at = now(),
                  review_note = $3, review_action = 'leave' where id = $1`,
          [row.id, me.id, reviewNote])
        await c.query('update public.attendance_breaks set ended_at = coalesce(ended_at, now()) where attendance_id = $1', [row.id])
        const typeId = await lopLeaveTypeId(c)
        const d = row.date
        const overlap = await c.query(
          `select 1 from public.leaves where employee_id = $1 and status in ('pending','approved') and $2::date between start_date and end_date`,
          [row.employee_id, d])
        if (typeId && !overlap.rowCount) {
          await c.query(
            `insert into public.leaves (employee_id, leave_type_id, start_date, end_date, days, reason, status, reviewed_by, reviewed_at, review_note)
             values ($1, $2, $3, $3, 1, 'Check-in rejected by HR', 'approved', $4, now(), $5)`,
            [row.employee_id, typeId, d, me.id, reviewNote])
        }
        summary = 'rejected — the day is recorded as leave (LOP)'
      } else {
        const err = new Error('Choose approve or reject.'); err.status = 400; throw err
      }
    })
    const day = row.date
    notifyEmployees([row.employee_id], { title: 'Check-in reviewed', body: `Your check-in on ${day} was ${summary}.`, link: '/attendance' })
    sendEmail({
      to: row.email, subject: `Your check-in on ${day} was ${decision === 'approve' ? 'approved' : 'rejected'}`,
      text: `Hi ${row.full_name},\n\nYour check-in on ${day} was ${summary}.${reviewNote ? `\nNote: ${reviewNote}` : ''}\n\nLeafy Digital HRMS`,
      html: `<p>Hi ${safeHtml(row.full_name)},</p><p>Your check-in on ${safeHtml(day)} was <b>${safeHtml(summary)}</b>.</p>${reviewNote ? `<p>Note: ${safeHtml(reviewNote)}</p>` : ''}<p>Leafy Digital HRMS</p>`,
    }).catch((e) => console.error('Review email failed:', e.message))
    shiftChanged()
    res.json({ ok: true, summary })
  }))

  // Live shift board for the dashboard (names are already public in #shift-updates).
  r.post('/live', wrap(async (req, res) => {
    const { date } = nowIST()
    const { rows } = await pool.query(
      `select e.id, e.full_name, e.emp_code, e.reporting_to, d.name as department, g.name as designation,
              a.id as attendance_id, a.status, a.check_in, a.check_out, a.work_mode, a.approval_status,
              exists (select 1 from public.attendance_breaks b where b.attendance_id = a.id and b.ended_at is null) as on_break,
              exists (select 1 from public.wfh_days w where w.employee_id = e.id and w.wfh_date = $1 and w.opted_out_at is null) as wfh_day,
              exists (select 1 from public.leaves l where l.employee_id = e.id and l.status = 'approved'
                        and $1::date between l.start_date and l.end_date) as on_leave
         from public.employees e
         left join public.departments d on d.id = e.department_id
         left join public.designations g on g.id = e.designation_id
         left join public.attendance a on a.employee_id = e.id and a.date = $1
        where e.status = 'active'
        order by e.full_name`, [date])
    const groups = { in: [], on_break: [], out: [], not_in: [], on_leave: [] }
    for (const x of rows) {
      const person = { id: x.id, full_name: x.full_name, emp_code: x.emp_code, department: x.department, designation: x.designation, check_in: x.check_in, check_out: x.check_out, work_mode: x.work_mode, approval_status: x.approval_status }
      if (x.status === 'leave' || (x.on_leave && !x.check_in)) groups.on_leave.push(person)
      else if (!x.check_in) groups.not_in.push(person)
      else if (x.check_out) groups.out.push(person)
      else if (x.on_break) groups.on_break.push(person)
      else groups.in.push(person)
    }
    const out = {
      date,
      counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
      wfh_today: rows.filter((x) => x.wfh_day).length,
      groups,
    }
    if (ATTENDANCE_APPROVER_ROLES.includes(req.me.role)) {
      out.pending_checkins = Number((await pool.query(`select count(*) from public.attendance where approval_status = 'pending'`)).rows[0].count)
    }
    if (LEADER_ROLES.includes(req.me.role)) {
      out.pending_wfh = Number((await pool.query(`select count(*) from public.wfh_requests where status = 'pending'`)).rows[0].count)
    } else {
      out.pending_wfh = Number((await pool.query(
        `select count(*) from public.wfh_requests w join public.employees e on e.id = w.employee_id
          where w.status = 'pending' and e.reporting_to = $1`, [req.me.id])).rows[0].count)
    }
    res.json(out)
  }))

  return r
}

/** 22:00 IST: close any WFH shift still open, because WFH access ends at the end of the window. */
export async function autoCloseWfhShifts() {
  const { date } = nowIST()
  const end = istTimestamp(date, fmtHHMM(CONFIG.wfhEndMin))
  const { rows } = await pool.query(
    `update public.attendance set check_out = $2, check_out_system = now(),
            check_out_reason = 'Automatic check-out at the end of the work-from-home window'
      where date = $1 and work_mode = 'wfh' and check_in is not null and check_out is null
      returning id, employee_id`, [date, end.toISOString()])
  for (const r of rows) {
    await pool.query('update public.attendance_breaks set ended_at = now() where employee_id = $1 and ended_at is null', [r.employee_id])
    postMessageSafe({ channel: 'shift-updates', senderId: r.employee_id, kind: 'shift', body: `shift out @${fmt12(end)} (automatic, WFH window closed)` })
  }
  if (rows.length) shiftChanged()
  return rows.length
}
