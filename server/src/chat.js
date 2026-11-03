// Office chat: channels (#general, #shift-updates, #task-updates) and direct messages,
// with a Server-Sent Events stream for live messages and notifications.
// The hub is in-memory, so run ONE API instance (Railway default). For several instances,
// replace publish() with PostgreSQL LISTEN/NOTIFY or Redis pub/sub.
import express from 'express'
import { pool } from './db.js'
import { fail, wrap, withMe } from './common.js'

// ---------------------------------------------------------------- live hub
const clients = new Map() // employeeId -> Set<res>

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** employeeIds = null sends to everyone connected. */
export function publish(employeeIds, event, data) {
  const targets = employeeIds ? employeeIds.map((id) => clients.get(id)).filter(Boolean) : [...clients.values()]
  for (const set of targets) for (const res of set) {
    try { send(res, event, data) } catch { /* connection closing */ }
  }
}

/** In-app popup + sound for specific people (approval requests, decisions...). */
export function notifyEmployees(employeeIds, { title, body, link }) {
  const ids = [...new Set((employeeIds || []).filter(Boolean))]
  if (ids.length) publish(ids, 'notice', { title, body, link, at: new Date().toISOString() })
}

async function channelAudience(channel) {
  if (channel.kind !== 'dm') return null
  const { rows } = await pool.query('select employee_id from public.chat_members where channel_id = $1', [channel.id])
  return rows.map((r) => r.employee_id)
}

async function loadChannel(idOrSlug) {
  const byId = /^[0-9a-f-]{36}$/i.test(String(idOrSlug))
  const { rows } = await pool.query(`select * from public.chat_channels where ${byId ? 'id' : 'slug'} = $1`, [idOrSlug])
  return rows[0] || null
}

async function canAccess(me, channel) {
  if (!channel) return false
  if (channel.kind === 'channel') return true
  const { rowCount } = await pool.query('select 1 from public.chat_members where channel_id = $1 and employee_id = $2', [channel.id, me.id])
  return rowCount > 0
}

/** Insert a message and push it to everyone who can see the channel. Used by routes and by attendance/tasks. */
export async function postMessage({ channel: idOrSlug, senderId = null, kind = 'text', body }) {
  const channel = await loadChannel(idOrSlug)
  if (!channel) return null
  const { rows } = await pool.query(
    `with m as (insert into public.chat_messages (channel_id, sender_id, kind, body) values ($1, $2, $3, $4) returning *)
     select m.id, m.channel_id, m.sender_id, m.kind, m.body, m.created_at, e.full_name as sender_name
       from m left join public.employees e on e.id = m.sender_id`,
    [channel.id, senderId, kind, String(body).slice(0, 4000)],
  )
  const message = { ...rows[0], channel_name: channel.name, channel_kind: channel.kind }
  publish(await channelAudience(channel), 'message', message)
  return message
}

/** Fire-and-forget wrapper so a chat failure never breaks attendance or tasks. */
export function postMessageSafe(args) {
  postMessage(args).catch((e) => console.error('Chat post failed:', e.message))
}

// ---------------------------------------------------------------- routes
export function chatRouter(auth) {
  const r = express.Router()
  r.use(auth, withMe)

  // Live stream. The browser uses fetch() with the Authorization header (EventSource cannot send headers).
  r.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders?.()
    res.write('retry: 5000\n\n')
    send(res, 'ready', { employee_id: req.me.id })
    const id = req.me.id
    if (!clients.has(id)) clients.set(id, new Set())
    clients.get(id).add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 25000)
    req.on('close', () => {
      clearInterval(ping)
      const set = clients.get(id)
      set?.delete(res)
      if (set && !set.size) clients.delete(id)
    })
  })

  r.post('/channels', wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select c.id, c.slug, c.name, c.kind, c.description, c.sort_order,
              (select max(m.id) from public.chat_messages m where m.channel_id = c.id) as last_id,
              (select max(m.created_at) from public.chat_messages m where m.channel_id = c.id) as last_at,
              (select count(*)::int from public.chat_messages m
                 where m.channel_id = c.id and m.id > coalesce(rd.last_read_id, 0)
                   and m.sender_id is distinct from $1) as unread,
              (select json_build_object('id', o.id, 'full_name', o.full_name)
                 from public.chat_members cm join public.employees o on o.id = cm.employee_id
                where cm.channel_id = c.id and cm.employee_id <> $1 limit 1) as partner
         from public.chat_channels c
         left join public.chat_reads rd on rd.channel_id = c.id and rd.employee_id = $1
        where c.kind = 'channel'
           or exists (select 1 from public.chat_members cm where cm.channel_id = c.id and cm.employee_id = $1)
        order by c.kind, c.sort_order, last_at desc nulls last, c.name`,
      [req.me.id],
    )
    res.json({ channels: rows })
  }))

  r.post('/messages', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    if (!(await canAccess(req.me, channel))) return fail(res, 404, 'Channel not found')
    const before = Number(req.body?.before_id) || null
    const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 50))
    const { rows } = await pool.query(
      `select m.id, m.channel_id, m.sender_id, m.kind, m.body, m.created_at, e.full_name as sender_name
         from public.chat_messages m left join public.employees e on e.id = m.sender_id
        where m.channel_id = $1 and ($2::bigint is null or m.id < $2)
        order by m.id desc limit $3`,
      [channel.id, before, limit],
    )
    res.json({ messages: rows.reverse(), has_more: rows.length === limit })
  }))

  r.post('/send', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    if (!(await canAccess(req.me, channel))) return fail(res, 404, 'Channel not found')
    const body = String(req.body?.body ?? '').trim()
    if (!body) return fail(res, 400, 'Type a message first.')
    if (body.length > 4000) return fail(res, 400, 'Messages can be at most 4000 characters.')
    const message = await postMessage({ channel: channel.id, senderId: req.me.id, kind: 'text', body })
    await pool.query(
      `insert into public.chat_reads (channel_id, employee_id, last_read_id) values ($1, $2, $3)
       on conflict (channel_id, employee_id) do update set last_read_id = greatest(public.chat_reads.last_read_id, excluded.last_read_id)`,
      [channel.id, req.me.id, message.id])
    res.json({ message })
  }))

  r.post('/read', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    if (!(await canAccess(req.me, channel))) return fail(res, 404, 'Channel not found')
    const last = Number(req.body?.last_id) || 0
    await pool.query(
      `insert into public.chat_reads (channel_id, employee_id, last_read_id) values ($1, $2, $3)
       on conflict (channel_id, employee_id) do update set last_read_id = greatest(public.chat_reads.last_read_id, excluded.last_read_id)`,
      [channel.id, req.me.id, last])
    res.json({ ok: true })
  }))

  // Open (or create) a direct-message channel with another active employee.
  r.post('/dm', wrap(async (req, res) => {
    const otherId = String(req.body?.employee_id || '')
    if (otherId === req.me.id) return fail(res, 400, 'Pick someone else to message.')
    const { rows: other } = await pool.query(`select id, full_name from public.employees where id = $1 and status = 'active'`, [otherId])
    if (!other[0]) return fail(res, 404, 'Employee not found')
    const [a, b] = [req.me.id, otherId].sort()
    const slug = `dm:${a}:${b}`
    const client = await pool.connect()
    try {
      await client.query('begin')
      const ins = await client.query(
        `insert into public.chat_channels (slug, name, kind) values ($1, 'Direct message', 'dm')
         on conflict (slug) do update set slug = excluded.slug returning id`, [slug])
      const channelId = ins.rows[0].id
      await client.query(
        `insert into public.chat_members (channel_id, employee_id) values ($1, $2), ($1, $3) on conflict do nothing`,
        [channelId, a, b])
      await client.query('commit')
      res.json({ channel_id: channelId })
    } catch (e) {
      await client.query('rollback').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  }))

  return r
}
