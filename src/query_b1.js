import { pool, asUser, friendlyError } from './db.js'
import { sendLeaveDecisionEmail } from './mailer.js'
import { postMessageSafe, notifyEmployees } from './chat.js'
import { countLeaveDays, isEligible, leaveBalance } from './leaveBalance.js'

/**
 * A small, whitelisted query layer. The browser sends a JSON description of a query
 * (table, filters, order, ...); this file turns it into parameterised SQL and runs it as
 * the restricted `app_user` role. Authorisation is NOT decided here — PostgreSQL row-level
 * security (see db/schema.sql) is the single source of truth. This code only guarantees that
 * identifiers come from a whitelist and every value is a bound parameter. Sensitive employee columns
 * are also excluded from non-HR/Admin reads, because PostgreSQL RLS policies are row-scoped.
 */

const TABLES = {
  departments: {}, designations: {}, employees: {}, leave_types: {}, leaves: {}, attendance: {},
  salary_structures: {}, salary_slabs: {}, payroll: {}, clients: {}, projects: {}, project_members: {}, tasks: {},
  incomes: {}, expenses: {}, employee_directory: { readOnly: true }, employee_experiences: {},
  employee_custom_field_definitions: {}, company_holidays: {}, comp_off_ledger: {},
  attendance_breaks: { readOnly: true }, wfh_requests: { readOnly: true }, wfh_days: { readOnly: true },
  task_activities: {},
}
// Columns that can never be written through the API
const PROTECTED = {
  employees: ['id', 'user_id', 'created_at', 'updated_at'],
}
const RELATIONS = {
  'employees:departments': { kind: 'one', fk: 'department_id' },
  'employees:designations': { kind: 'one', fk: 'designation_id' },
  'projects:tasks': { kind: 'many', fk: 'project_id' },
  'projects:project_members': { kind: 'many', fk: 'project_id' },
}
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
const IDENT = /^[a-z_][a-z0-9_]*$/

class BadQuery extends Error {}
const bad = (m) => { throw new BadQuery(m) }

let COLS = null // table -> { all:Set, generated:Set }
async function loadColumns() {
  const { rows } = await pool.query(
    `select table_name, column_name, is_generated from information_schema.columns
     where table_schema = 'public' and table_name = any($1)`,
    [Object.keys(TABLES)],
  )
  COLS = {}
  for (const r of rows) {
    COLS[r.table_name] ??= { all: new Set(), generated: new Set() }
    COLS[r.table_name].all.add(r.column_name)
    if (r.is_generated === 'ALWAYS') COLS[r.table_name].generated.add(r.column_name)
  }
}

const q = (id) => `"${id}"`

function colOf(table, name) {
  if (typeof name !== 'string' || !IDENT.test(name) || !COLS[table]?.all.has(name)) bad(`Unknown column "${name}" on ${table}`)
  return name
}

function splitTop(str) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of str) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function selectList(table, select) {
  const parts = []
  let star = false
  const plain = []
  for (const tok of splitTop(select || '*')) {
    if (tok === '*') { star = true; continue }
    const m = tok.match(/^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)\(([^()]*)\)$/)
    if (m) {
      const [, alias, rel, inner] = m
      const relation = RELATIONS[`${table}:${rel}`]
      if (!relation) bad(`Cannot embed ${rel} in ${table}`)
      const cols = inner.trim() === '*' || !inner.trim()
        ? 'x.*'
        : inner.split(',').map((c) => `x.${q(colOf(rel, c.trim()))}`).join(', ')
      const name = alias || rel
      if (!IDENT.test(name)) bad('Bad alias')
      parts.push(
        relation.kind === 'one'
          ? `(select to_json(e) from (select ${cols} from public.${rel} x where x.id = t.${q(relation.fk)}) e) as ${q(name)}`
          : `coalesce((select json_agg(e) from (select ${cols} from public.${rel} x where x.${q(relation.fk)} = t.id) e), '[]'::json) as ${q(name)}`,
      )
    } else {
      plain.push(`t.${q(colOf(table, tok))}`)
    }
  }
  const base = star || plain.length === 0 ? ['t.*'] : plain
  return [...base, ...parts].join(', ')
}

function whereClause(table, filters = [], params) {
  const out = []
  for (const f of filters) {
    const col = `t.${q(colOf(table, f.col))}`
    if (f.op === 'in') {
      if (!Array.isArray(f.val)) bad('"in" needs a list')
      params.push(f.val)
      out.push(`${col} = any($${params.length})`)
    } else if (OPS[f.op]) {
      if (f.val !== null && typeof f.val === 'object') bad('Bad filter value')
      params.push(f.val)
      out.push(`${col} ${OPS[f.op]} $${params.length}`)
    } else bad(`Unknown operator ${f.op}`)
  }
  return out.length ? ` where ${out.join(' and ')}` : ''
}

function orderClause(table, order = []) {
  if (!order.length) return ''
  return ' order by ' + order.map((o) => {
    const dir = o.asc === false ? 'desc' : 'asc'
    const nulls = o.nullsFirst === true ? ' nulls first' : o.nullsFirst === false ? ' nulls last' : ''
    return `t.${q(colOf(table, o.col))} ${dir}${nulls}`
  }).join(', ')
}

function writableCols(table, rows) {
  const keys = new Set()
  for (const r of rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) bad('Bad row')
    for (const k of Object.keys(r)) keys.add(k)
  }
  const cols = [...keys]
  for (const c of cols) {
    colOf(table, c)
    if (COLS[table].generated.has(c) || PROTECTED[table]?.includes(c)) bad(`Column "${c}" cannot be written`)
  }
  if (!cols.length) bad('Nothing to save')
  return cols
}

function scalar(v) {
  if (v !== null && typeof v === 'object') bad('Bad value')
  return v
}

function valuesSql(cols, rows, params) {
  return rows.map((r) =>
    '(' + cols.map((c) => {
      if (!(c in r)) return 'default'
      params.push(scalar(r[c]))
      return `$${params.length}`
    }).join(', ') + ')',
  ).join(', ')
}

async function run(client, spec) {
  if (!COLS) await loadColumns()
  const table = spec.table
  if (typeof table !== 'string' || !TABLES[table]) bad('Unknown table')
  const params = []
  const action = spec.action || 'select'
  const filters = Array.isArray(spec.filters) ? spec.filters : []

  if (action === 'select') {
    let requestedSelect = spec.select || '*'
    if (table === 'employees') {
      const roleResult = await client.query('select public.current_role_key() as role')
      const viewerRole = roleResult.rows[0]?.role
      if (!['admin', 'hr'].includes(viewerRole)) {
        const common = ['id','emp_code','full_name','email','phone','department_id','designation_id','reporting_to','role','employment_type','date_of_joining','status','created_at','updated_at']
        const allowed = new Set([...common, ...(viewerRole === 'accounts' ? ['bank_name','bank_account','ifsc','pan'] : [])])
        const sensitive = new Set(['personal_email','emergency_contact','emergency_contact_name','emergency_contact_relation','address','gender','date_of_birth','blood_group','pincode','aadhaar_number'])
        if (filters.some((f) => sensitive.has(f.col)) || (spec.order || []).some((o) => sensitive.has(o.col))) bad('Filtering or sorting by a restricted employee column is not allowed')
        const tokens = splitTop(String(requestedSelect))
        const expanded = []
        for (const token of tokens) {
          if (token === '*') { expanded.push(...allowed); continue }
          const match = token.match(/^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)\(([^()]*)\)$/)
          if (match) { expanded.push(token); continue }
          if (sensitive.has(token) || !allowed.has(token)) bad(`Column "${token}" is restricted for your role`)
          expanded.push(token)
        }
        requestedSelect = [...new Set(expanded)].join(', ')
      }
    }
    const where = whereClause(table, filters, params)
    let count
    if (spec.count) {
      count = (await client.query(`select count(*)::int as n from public.${table} t${where}`, params)).rows[0].n
    }
    if (spec.head) return { data: null, count }
    const lim = spec.limit != null ? ` limit ${Math.max(0, Math.min(5000, parseInt(spec.limit, 10) || 0))}` : ''
    const sql = `select coalesce(json_agg(r), '[]'::json) as data from (select ${selectList(table, requestedSelect)} from public.${table} t${where}${orderClause(table, spec.order)}${lim}) r`
    const data = (await client.query(sql, params)).rows[0].data
    if (spec.single === 'single') {
      if (data.length !== 1) bad('Expected exactly one row')
      return { data: data[0], count }
    }
    if (spec.single === 'maybeSingle') {
      if (data.length > 1) bad('Expected at most one row')
      return { data: data[0] ?? null, count }
    }
    return { data, count }
  }

  if (TABLES[table].readOnly) bad(`${table} is read-only`)

  if (action === 'insert' || action === 'upsert') {
    const rows = Array.isArray(spec.values) ? spec.values : [spec.values]
    if (!rows.length) return { data: null }
    if (table === 'leaves') await checkLeaveRequests(client, rows)
    const cols = writableCols(table, rows)
    let sql = `insert into public.${table} (${cols.map(q).join(', ')}) values ${valuesSql(cols, rows, params)}`
    if (action === 'upsert') {
      const keys = String(spec.onConflict || '').split(',').map((c) => colOf(table, c.trim()))
      if (!keys.length) bad('onConflict is required')
      const upd = cols.filter((c) => !keys.includes(c))
      sql += ` on conflict (${keys.map(q).join(', ')}) ` +
        (spec.ignoreDuplicates || !upd.length ? 'do nothing' : `do update set ${upd.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ')}`)
    }
    await client.query(sql, params)
    return { data: null }
  }

  if (action === 'update') {
    if (!filters.length) bad('Refusing to update without a filter')
    const vals = spec.values || {}
    const cols = writableCols(table, [vals])
    const sets = cols.map((c) => { params.push(scalar(vals[c])); return `${q(c)} = $${params.length}` })
    const where = whereClause(table, filters, params)
    await client.query(`update public.${table} as t set ${sets.join(', ')}${where}`, params)
    return { data: null }
  }

  if (action === 'delete') {
    if (!filters.length) bad('Refusing to delete without a filter')
    const where = whereClause(table, filters, params)
    await client.query(`delete from public.${table} as t${where}`, params)
    return { data: null }
  }

  bad('Unknown action')
}

/**
 * An employee's own leave request must fit their remaining balance (same rules as the Leave page).
 * Leave that HR / Admin records for someone else is not limited here (they may override).
 */
async function checkLeaveRequests(client, rows) {
  const meId = (await client.query('select public.current_employee_id() as id')).rows[0]?.id
  for (const row of rows) {
    if (!row || typeof row !== 'object') bad('Bad row')
    if (row.half_day && !['morning', 'afternoon'].includes(row.half_day_session)) bad('Choose morning or afternoon for a half-day leave.')
    if (!row.half_day) row.half_day_session = null
    if (row.employee_id !== meId) continue
    const days = countLeaveDays(String(row.start_date || ''), String(row.end_date || ''), !!row.half_day && row.start_date === row.end_date)
    if (days <= 0) bad('The selected dates contain no working days (Sundays are not counted).')
    row.days = days
    // One transaction client: run these one after another (pg does not allow parallel queries on a client).
    const emp = await client.query('select date_of_joining::text, employment_type, gender from public.employees where id = $1', [meId])
    const type = await client.query('select * from public.leave_types where id = $1', [row.leave_type_id])
    const leaves = await client.query('select leave_type_id, start_date::text, days, status from public.leaves where employee_id = $1', [meId])
    const comp = await client.query('select coalesce(sum(days), 0) as n from public.comp_off_ledger where employee_id = $1', [meId])
    const t = type.rows[0]
    if (!t) bad('Choose a leave type.')
    if (!isEligible(t, emp.rows[0]?.gender)) bad(`${t.name} is not available for you.`)
    const b = leaveBalance({ employee: emp.rows[0], type: t, leaves: leaves.rows, compOffEarned: Number(comp.rows[0].n), asOf: row.start_date })
    if (b.limited && days > b.left) {
      bad(b.left <= 0
        ? `You have no ${t.name} left${b.period === 'month' ? ' for this month' : ''}. Choose another leave type.`
        : `You have only ${b.left} day(s) of ${t.name} left${b.period === 'month' ? ' for this month' : ''}, but this request is ${days} day(s).`)
    }
  }
}

export async function runQuery(uid, spec) {
  try {
    const out = await asUser(uid, (client) => run(client, spec))
    if (spec.table === 'leaves' && spec.action === 'update' && ['approved', 'rejected', 'cancelled'].includes(spec.values?.status)) {
      const idFilter = (spec.filters || []).find((f) => f.col === 'id' && f.op === 'eq')
      if (idFilter) {
        try {
          await sendLeaveDecisionEmail(idFilter.val)
        } catch (e) { console.error('Leave notification email failed:', e.message) }
      }
    }
    if (spec.table === 'task_activities' && spec.action === 'insert' && spec.values?.task_id) {
      notifyTaskNote(uid, spec.values.task_id, spec.values.body).catch((e) => console.error('Task note notice failed:', e.message))
    }
    if (spec.table === 'tasks' && (spec.action === 'insert' || (spec.action === 'update' && spec.values?.status))) {
      announceTask(uid, spec).catch((e) => console.error('Task chat post failed:', e.message))
    }
    return { status: 200, body: out }
  } catch (e) {
    if (e instanceof BadQuery) return { status: 400, body: { error: { message: e.message } } }
    const field = e.code === '23505' ? (String(e.constraint || '').includes('emp_code') ? 'emp_code' : String(e.constraint || '').includes('email') ? 'email' : undefined) : undefined
    return { status: 400, body: { error: { message: friendlyError(e), ...(field ? { field } : {}) } } }
  }
}

// A note on a task pops up for the assignee and the person who created the task (not the author).
async function notifyTaskNote(uid, taskId, body) {
  const { rows } = await pool.query(
    `select t.title, t.assignee_id, t.created_by, a.id as author_id, a.full_name as author
       from public.tasks t, public.employees a where t.id = $1 and a.user_id = $2`, [taskId, uid])
  const t = rows[0]
  if (!t) return
  notifyEmployees([t.assignee_id, t.created_by].filter((id) => id && id !== t.author_id), {
    title: `Note on "${t.title}"`, body: `${t.author}: ${String(body || '').slice(0, 160)}`, link: `/tasks?task=${taskId}`,
  })
}

const TASK_STATUS = { todo: 'To do', in_progress: 'In progress', review: 'In review', done: 'Done ✅' }

// Mirror task activity into #task-updates.
async function announceTask(uid, spec) {
  const { rows: actor } = await pool.query('select id, full_name from public.employees where user_id = $1', [uid])
  if (!actor[0]) return
  if (spec.action === 'update') {
    const idFilter = (spec.filters || []).find((f) => f.col === 'id' && f.op === 'eq')
    if (!idFilter) return
    const { rows } = await pool.query(
      `select t.title, p.name as project from public.tasks t left join public.projects p on p.id = t.project_id where t.id = $1`, [idFilter.val])
    if (!rows[0]) return
    postMessageSafe({ channel: 'task-updates', senderId: actor[0].id, kind: 'task',
      body: `moved "${rows[0].title}"${rows[0].project ? ` (${rows[0].project})` : ''} to ${TASK_STATUS[spec.values.status] ?? spec.values.status}` })
  } else {
    const list = Array.isArray(spec.values) ? spec.values : [spec.values]
    for (const t of list) {
      if (!t?.title) continue
      const { rows } = t.assignee_id
        ? await pool.query('select full_name from public.employees where id = $1', [t.assignee_id]) : { rows: [] }
      postMessageSafe({ channel: 'task-updates', senderId: actor[0].id, kind: 'task',
        body: `created task "${t.title}"${rows[0] ? ` · assigned to ${rows[0].full_name}` : ''}${t.due_date ? ` · due ${t.due_date}` : ''}` })
    }
  }
}
