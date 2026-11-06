// Work-from-home: employee requests a date range; the reporting person, HR or Admin (any one of them)
// approves selected days from a calendar or rejects. Approvers can also mark WFH days directly.
import express from 'express'
import { pool, asOwner } from './db.js'
import { sendEmail, safeHtml } from './mailer.js'
import { notifyEmployees } from './chat.js'
import { LEADER_ROLES, datesBetween, fail, isApproverFor, isISODate, nowIST, withMe, wrap } from './common.js'

const MAX_DAYS = 62

const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

async function employee(id) {
  const { rows } = await pool.query(
    `select id, full_name, email, reporting_to, status from public.employees where id = $1`, [id])
  return rows[0] || null
}

/** Reporting person + HR + Admin (active), excluding the employee themselves. */
async function approversFor(emp) {
  const { rows } = await pool.query(
    `select id, full_name, email from public.employees
      where status = 'active' and id <> $1 and (role in ('hr','admin') or id = $2)`,
    [emp.id, emp.reporting_to])
  return rows
}

function cleanDates(list) {
  if (!Array.isArray(list)) return null
  const set = [...new Set(list.map(String))]
  if (!set.length || set.some((d) => !isISODate(d))) return null
  return set.sort()
}

async function decisionEmail(emp, status, dates, note, reviewer) {
  const list = dates.map(fmtDay)
  const subject = status === 'approved' ? `Work from home approved (${dates.length} day${dates.length > 1 ? 's' : ''})` : 'Work from home request rejected'
  await sendEmail({
    to: emp.email, subject: `${subject} · Leafy Digital HRMS`,
    text: `Hi ${emp.full_name},\n\nYour work-from-home request was ${status} by ${reviewer.full_name}.${status === 'approved' ? `\nApproved days:\n- ${list.join('\n- ')}\n\nWFH check-in/check-out is available 08:00–22:00 IST on these days.` : ''}${note ? `\nNote: ${note}` : ''}\n\nLeafy Digital HRMS`,
    html: `<p>Hi ${safeHtml(emp.full_name)},</p><p>Your work-from-home request was <b>${safeHtml(status)}</b> by ${safeHtml(reviewer.full_name)}.</p>${status === 'approved' ? `<p>Approved days:</p><ul>${list.map((d) => `<li>${safeHtml(d)}</li>`).join('')}</ul><p>WFH check-in/check-out is available 08:00–22:00 IST on these days.</p>` : ''}${note ? `<p>Note: ${safeHtml(note)}</p>` : ''}<p>Leafy Digital HRMS</p>`,
  }).catch((e) => console.error('WFH decision email failed:', e.message))
}

async function saveDays(c, employeeId, requestId, dates, approverId) {
  for (const d of dates) {
    await c.query(
      `insert into public.wfh_days (employee_id, wfh_date, request_id, approved_by) values ($1, $2, $3, $4)
       on conflict (employee_id, wfh_date) do update set request_id = excluded.request_id, approved_by = excluded.approved_by, opted_out_at = null, opted_out_note = null`,
      [employeeId, d, requestId, approverId])
  }
  // A shift already started today in office mode becomes WFH if today was approved.
  const { date } = nowIST()
  if (dates.includes(date)) {
    await c.query(`update public.attendance set work_mode = 'wfh', status = case when status = 'present' then 'wfh' else status end
                    where employee_id = $1 and date = $2`, [employeeId, date])
  }
}

export function wfhRouter(auth) {
  const r = express.Router()
  r.use(auth, withMe)

  r.post('/list', wrap(async (req, res) => {
    const me = req.me
    const scope = req.body?.scope === 'review' ? 'review' : 'mine'
    const leader = LEADER_ROLES.includes(me.role)
    const where = scope === 'mine' ? 'w.employee_id = $1'
      : leader ? 'w.employee_id <> $1' : 'e.reporting_to = $1'
    const { rows } = await pool.query(
      `select w.*, w.approved_dates::text[] as approved_dates, e.full_name, e.emp_code, rq.full_name as requested_by_name, rv.full_name as reviewed_by_name
         from public.wfh_requests w join public.employees e on e.id = w.employee_id
         left join public.employees rq on rq.id = w.requested_by
         left join public.employees rv on rv.id = w.reviewed_by
        where ${where}
        order by (w.status = 'pending') desc, w.start_date desc limit 300`, [me.id])
    const { rows: team } = await pool.query(
      leader
        ? `select id, full_name from public.employees where status = 'active' order by full_name`
        : `select id, full_name from public.employees where status = 'active' and reporting_to = $1 order by full_name`,
      leader ? [] : [me.id])
    res.json({ rows, can_review: leader || team.length > 0, team })
  }))

  r.post('/request', wrap(async (req, res) => {
    const me = req.me
    const { start_date: start, end_date: end } = req.body || {}
    const reason = String(req.body?.reason || '').trim()
    const errors = {}
    const { date: today } = nowIST()
    if (!isISODate(start)) errors.start_date = 'Choose a start date.'
    else if (start < today) errors.start_date = 'Start date cannot be in the past.'
    if (!isISODate(end)) errors.end_date = 'Choose an end date.'
    else if (isISODate(start) && end < start) errors.end_date = 'End date must be on or after the start date.'
    if (reason.length < 3) errors.reason = 'Tell your reporting person why you need to work from home.'
    if (Object.keys(errors).length) return fail(res, 400, Object.values(errors)[0], { fields: errors })
    const days = datesBetween(start, end)
    if (days.length > MAX_DAYS) return fail(res, 400, `Request at most ${MAX_DAYS} days at a time.`, { fields: { end_date: `At most ${MAX_DAYS} days.` } })
    const overlap = await pool.query(
      `select 1 from public.wfh_requests where employee_id = $1 and status = 'pending' and start_date <= $3 and end_date >= $2`,
      [me.id, start, end])
    if (overlap.rowCount) return fail(res, 409, 'You already have a pending WFH request for some of these dates.')
    const { rows } = await pool.query(
      `insert into public.wfh_requests (employee_id, start_date, end_date, days, reason, requested_by)
       values ($1, $2, $3, $4, $5, $1) returning *`, [me.id, start, end, days.length, reason])
    const emp = await employee(me.id)
    const approvers = await approversFor(emp)
    notifyEmployees(approvers.map((a) => a.id), {
      title: 'Work-from-home request', body: `${me.full_name} asked to work from home ${start} → ${end} (${days.length} day(s)).`, link: '/wfh?tab=review',
    })
    for (const a of approvers) {
      sendEmail({
        to: a.email, subject: `WFH request from ${me.full_name} · Leafy Digital HRMS`,
        text: `Hi ${a.full_name},\n\n${me.full_name} has requested to work from home from ${start} to ${end} (${days.length} day(s)).\nReason: ${reason}\n\nYou (reporting person, HR or Admin) can approve selected days or reject in HRMS → Work from home → Review. Any one approver is enough.`,
        html: `<p>Hi ${safeHtml(a.full_name)},</p><p><b>${safeHtml(me.full_name)}</b> has requested to work from home from <b>${safeHtml(start)}</b> to <b>${safeHtml(end)}</b> (${days.length} day(s)).</p><p>Reason: ${safeHtml(reason)}</p><p>Approve selected days or reject in HRMS → Work from home → Review. Any one approver is enough.</p>`,
      }).catch((e) => console.error('WFH request email failed:', e.message))
    }
    res.json({ request: rows[0], notified: approvers.length })
  }))

  r.post('/review', wrap(async (req, res) => {
    const me = req.me
    const { request_id: id, decision } = req.body || {}
    const note = String(req.body?.note || '').trim() || null
    const { rows } = await pool.query('select * from public.wfh_requests where id = $1', [id])
    const request = rows[0]
    if (!request) return fail(res, 404, 'Request not found')
    if (request.employee_id === me.id) return fail(res, 403, 'You cannot review your own request.')
    if (!(await isApproverFor(me, request.employee_id))) return fail(res, 403, 'Only the reporting person, HR or Admin can review this request.')
    if (request.status !== 'pending') return fail(res, 409, `This request is already ${request.status}.`)
    const emp = await employee(request.employee_id)

    if (decision === 'approve') {
      const dates = cleanDates(req.body?.dates)
      if (!dates) return fail(res, 400, 'Tick at least one day to approve.')
      const allowed = new Set(datesBetween(request.start_date, request.end_date))
      if (dates.some((d) => !allowed.has(d))) return fail(res, 400, 'Approved days must be inside the requested range.')
      await asOwner(async (c) => {
        await c.query(
          `update public.wfh_requests set status = 'approved', approved_dates = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4 where id = $1`,
          [id, dates, me.id, note])
        await saveDays(c, request.employee_id, id, dates, me.id)
      })
      notifyEmployees([emp.id], { title: 'WFH approved', body: `${me.full_name} approved ${dates.length} work-from-home day(s).`, link: '/wfh' })
      await decisionEmail(emp, 'approved', dates, note, me)
      return res.json({ ok: true })
    }
    if (decision === 'reject') {
      await pool.query(
        `update public.wfh_requests set status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3 where id = $1`,
        [id, me.id, note])
      notifyEmployees([emp.id], { title: 'WFH rejected', body: `${me.full_name} rejected your work-from-home request.`, link: '/wfh' })
      await decisionEmail(emp, 'rejected', [], note, me)
      return res.json({ ok: true })
    }
    fail(res, 400, 'Choose approve or reject.')
  }))

  // Reporting person / HR / Admin marks an employee as WFH for chosen days (no request needed).
  r.post('/assign', wrap(async (req, res) => {
    const me = req.me
    const emp = await employee(req.body?.employee_id)
    if (!emp || emp.status !== 'active') return fail(res, 404, 'Employee not found', { fields: { employee_id: 'Choose an employee.' } })
    if (!(await isApproverFor(me, emp.id))) return fail(res, 403, 'Only the reporting person, HR or Admin can mark WFH for this employee.')
    const dates = cleanDates(req.body?.dates)
    if (!dates) return fail(res, 400, 'Tick at least one day on the calendar.', { fields: { dates: 'Tick at least one day.' } })
    const { date: today } = nowIST()
    if (dates[0] < today) return fail(res, 400, 'Past days cannot be marked as WFH.', { fields: { dates: 'Past days cannot be marked.' } })
    const note = String(req.body?.note || '').trim() || null
    await asOwner(async (c) => {
      const { rows } = await c.query(
        `insert into public.wfh_requests (employee_id, start_date, end_date, days, reason, status, approved_dates, requested_by, reviewed_by, reviewed_at, review_note)
         values ($1, $2, $3, $4, $5, 'approved', $6, $7, $7, now(), $5) returning id`,
        [emp.id, dates[0], dates[dates.length - 1], dates.length, note || `Marked as WFH by ${me.full_name}`, dates, me.id])
      await saveDays(c, emp.id, rows[0].id, dates, me.id)
    })
    notifyEmployees([emp.id], { title: 'Marked as WFH', body: `${me.full_name} marked ${dates.length} work-from-home day(s) for you.`, link: '/wfh' })
    await decisionEmail(emp, 'approved', dates, note, me)
    res.json({ ok: true })
  }))

  // Employee cancels a pending request; an approver can revoke the remaining future days of an approved one.
  r.post('/cancel', wrap(async (req, res) => {
    const me = req.me
    const { rows } = await pool.query('select * from public.wfh_requests where id = $1', [req.body?.request_id])
    const request = rows[0]
    if (!request) return fail(res, 404, 'Request not found')
    const { date: today } = nowIST()
    if (request.status === 'pending' && request.employee_id === me.id) {
      await pool.query(`update public.wfh_requests set status = 'cancelled' where id = $1`, [request.id])
      return res.json({ ok: true })
    }
    if (request.status === 'approved' && request.employee_id !== me.id && (await isApproverFor(me, request.employee_id))) {
      await asOwner(async (c) => {
        await c.query(`update public.wfh_requests set status = 'cancelled', reviewed_by = $2, reviewed_at = now() where id = $1`, [request.id, me.id])
        await c.query('delete from public.wfh_days where request_id = $1 and wfh_date > $2', [request.id, today])
      })
      notifyEmployees([request.employee_id], { title: 'WFH revoked', body: `${me.full_name} revoked your remaining WFH days from ${request.start_date} → ${request.end_date}.`, link: '/wfh' })
      return res.json({ ok: true })
    }
    fail(res, 403, 'You cannot cancel this request.')
  }))

  return r
}
