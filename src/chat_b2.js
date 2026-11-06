// Office chat: public channels (#general, #shift-updates, #task-updates), private groups (only the
// people added), direct messages, and file / image attachments, with a Server-Sent Events stream for
// live updates. The hub is in-memory, so run ONE API instance (Railway / PM2 single process). For
// several instances, replace publish() with PostgreSQL LISTEN/NOTIFY or Redis pub/sub.
import crypto from 'node:crypto'
import express from 'express'
import { pool } from './db.js'
import { LEADER_ROLES, OUTSIDE_HOURS, fail, outsideLoginHours, wrap, withMe } from './common.js'

export const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB per file
const MAX_FILES_PER_MESSAGE = 10
// Never accept programs or scripts.
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|mjs|jar|sh|apk|app|dll|reg|hta|html?|svgz?)$/i

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

async function members(channelId) {
  const { rows } = await pool.query('select employee_id from public.chat_members where channel_id = $1', [channelId])
  return rows.map((r) => r.employee_id)
}
async function channelAudience(channel) {
  return channel.kind === 'channel' ? null : members(channel.id)
}

async function loadChannel(idOrSlug) {
  const byId = /^[0-9a-f-]{36}$/i.test(String(idOrSlug))
  const { rows } = await pool.query(`select * from public.chat_channels where ${byId ? 'id' : 'slug'} = $1`, [idOrSlug])
  return rows[0] || null
}

async function membership(me, channel) {
  if (!channel) return null
  const { rows } = await pool.query('select role from public.chat_members where channel_id = $1 and employee_id = $2', [channel.id, me.id])
  return rows[0] || null
}
async function canAccess(me, channel) {
  if (!channel) return false
  if (channel.kind === 'channel') return true
  return !!(await membership(me, channel))
}
/** Group owner, or Admin / HR / leadership, can rename a group and add or remove people. */
async function canManageGroup(me, channel) {
  if (channel?.kind !== 'group') return false
  if (LEADER_ROLES.includes(me.role)) return true
  return (await membership(me, channel))?.role === 'owner'
}

const ATTACH_SQL = `coalesce((select json_agg(json_build_object('id', f.id, 'file_name', f.file_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes) order by f.created_at)
  from public.chat_attachments f where f.message_id = m.id), '[]'::json) as attachments`

/** Insert a message and push it to everyone who can see the channel. Used by routes and by attendance/tasks. */
export async function postMessage({ channel: idOrSlug, senderId = null, kind = 'text', body, attachmentIds = [] }) {
  const channel = await loadChannel(idOrSlug)
  if (!channel) return null
  const client = await pool.connect()
  let message
  try {
    await client.query('begin')
    const ins = await client.query(
      `insert into public.chat_messages (channel_id, sender_id, kind, body) values ($1, $2, $3, $4) returning id`,
      [channel.id, senderId, kind, String(body ?? '').slice(0, 4000)])
    const id = ins.rows[0].id
    if (attachmentIds.length) {
      const linked = await client.query(
        `update public.chat_attachments set message_id = $1
          where id = any($2) and channel_id = $3 and uploaded_by = $4 and message_id is null`,
        [id, attachmentIds, channel.id, senderId])
      if (linked.rowCount !== attachmentIds.length) {
        const err = new Error('One of the files is missing or was already sent. Attach it again.'); err.status = 400; throw err
      }
    }
    const { rows } = await client.query(
      `select m.id, m.channel_id, m.sender_id, m.kind, m.body, m.created_at, e.full_name as sender_name, ${ATTACH_SQL}
         from public.chat_messages m left join public.employees e on e.id = m.sender_id where m.id = $1`, [id])
    await client.query('update public.chat_channels set updated_at = now() where id = $1', [channel.id])
    await client.query('commit')
    message = { ...rows[0], channel_name: channel.name, channel_kind: channel.kind }
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  publish(await channelAudience(channel), 'message', message)
  return message
}

/** Fire-and-forget wrapper so a chat failure never breaks attendance or tasks. */
export function postMessageSafe(args) {
  postMessage(args).catch((e) => console.error('Chat post failed:', e.message))
}

/** Tell these people their channel list changed (added to / removed from a group, renamed...). */
const channelsChanged = (ids) => publish(ids, 'channels', { at: new Date().toISOString() })

async function activeIds(ids) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map(String))]
  if (!clean.length) return []
  const { rows } = await pool.query(`select id, full_name from public.employees where id = any($1) and status = 'active'`, [clean])
  return rows
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
    // Keep-alive; at the end of sign-in hours the stream tells the browser to sign out, then closes.
    const ping = setInterval(() => {
      if (outsideLoginHours(req.me.role)) { send(res, 'signout', { code: OUTSIDE_HOURS }); res.end(); return }
      res.write(': ping\n\n')
    }, 25000)
    req.on('close', () => {
      clearInterval(ping)
      const set = clients.get(id)
      set?.delete(res)
      if (set && !set.size) clients.delete(id)
    })
  })

  r.post('/channels', wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select c.id, c.slug, c.name, c.kind, c.description, c.sort_order, c.created_by,
              (select max(m.id) from public.chat_messages m where m.channel_id = c.id) as last_id,
              (select max(m.created_at) from public.chat_messages m where m.channel_id = c.id) as last_at,
              (select count(*)::int from public.chat_messages m
                 where m.channel_id = c.id and m.id > coalesce(rd.last_read_id, 0)
                   and m.sender_id is distinct from $1) as unread,
              (select count(*)::int from public.chat_members cm where cm.channel_id = c.id) as member_count,
              (select cm.role from public.chat_members cm where cm.channel_id = c.id and cm.employee_id = $1) as my_role,
              (select json_build_object('id', o.id, 'full_name', o.full_name)
                 from public.chat_members cm join public.employees o on o.id = cm.employee_id
                where c.kind = 'dm' and cm.channel_id = c.id and cm.employee_id <> $1 limit 1) as partner
         from public.chat_channels c
         left join public.chat_reads rd on rd.channel_id = c.id and rd.employee_id = $1
        where c.kind = 'channel'
           or exists (select 1 from public.chat_members cm where cm.channel_id = c.id and cm.employee_id = $1)
        order by c.kind, c.sort_order, last_at desc nulls last, c.name`,
      [req.me.id],
    )
    const leader = LEADER_ROLES.includes(req.me.role)
    res.json({ channels: rows.map((c) => ({ ...c, can_manage: c.kind === 'group' && (leader || c.my_role === 'owner') })) })
  }))

  r.post('/messages', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    if (!(await canAccess(req.me, channel))) return fail(res, 404, 'Channel not found')
    const before = Number(req.body?.before_id) || null
    const limit = Math.min(100, Math.max(1, Number(req.body?.limit) || 50))
    const { rows } = await pool.query(
      `select m.id, m.channel_id, m.sender_id, m.kind, m.body, m.created_at, e.full_name as sender_name, ${ATTACH_SQL}
         from public.chat_messages m left join public.employees e on e.id = m.sender_id
        where m.channel_id = $1 and ($2::bigint is null or m.id < $2)
        order by m.id desc limit $3`,
      [channel.id, before, limit],
    )
    res.json({ messages: rows.reverse(), has_more: rows.length === limit })
  }))

  // Upload one file (raw bytes). Real name / type come in headers. Returns an id to send with the message.
  r.post('/upload', express.raw({ type: () => true, limit: MAX_FILE_BYTES }), wrap(async (req, res) => {
    const channel = await loadChannel(req.query.channel_id)
    if (!(await canAccess(req.me, channel))) return fail(res, 404, 'Channel not found')
    const data = req.body
    if (!Buffer.isBuffer(data) || !data.length) return fail(res, 400, 'The file is empty.')
    let name = 'file'
    try { name = decodeURIComponent(String(req.get('x-file-name') || 'file')) } catch { /* keep default */ }
    name = name.replace(/[\\/\r\n"]/g, '_').slice(0, 180) || 'file'
    if (BLOCKED_EXT.test(name)) return fail(res, 400, 'This type of file cannot be shared in chat.')
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(req.get('x-file-type') || '')) ? String(req.get('x-file-type')).toLowerCase() : 'application/octet-stream'
    // Clean up this person's files that were uploaded but never sent (older than a day).
    await pool.query(`delete from public.chat_attachments where uploaded_by = $1 and message_id is null and created_at < now() - interval '1 day'`, [req.me.id])
    const { rows } = await pool.query(
      `insert into public.chat_attachments (channel_id, uploaded_by, file_name, mime_type, size_bytes, data)
       values ($1, $2, $3, $4, $5, $6) returning id, file_name, mime_type, size_bytes`,
      [channel.id, req.me.id, name, mime === 'image/svg+xml' ? 'application/octet-stream' : mime, data.length, data])
    res.json({ attachment: rows[0] })
  }))

  // Download / view a file (the browser fetches it with the Authorization header).
  r.get('/file/:id', wrap(async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return fail(res, 404, 'File not found')
    const { rows } = await pool.query('select * from public.chat_attachments where id = $1', [req.params.id])
    const f = rows[0]
    if (!f) return fail(res, 404, 'File not found')
    const channel = await loadChannel(f.channel_id)
    const visible = await canAccess(req.me, channel)
    if (!visible || (!f.message_id && f.uploaded_by !== req.me.id)) return fail(res, 404, 'File not found')
    const inline = /^image\/(png|jpe?g|gif|webp|bmp)$/.test(f.mime_type) || f.mime_type === 'application/pdf'
    res.set({
      'Content-Type': f.mime_type,
      'Content-Length': String(f.size_bytes),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
    })
    res.end(f.data)
  }))

  r.post('/send', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    if (!(await canAccess(req.me, channel))) return fail(res, 404, 'Channel not found')
    const body = String(req.body?.body ?? '').trim()
    const attachmentIds = [...new Set((Array.isArray(req.body?.attachment_ids) ? req.body.attachment_ids : []).map(String))]
    if (!body && !attachmentIds.length) return fail(res, 400, 'Type a message or attach a file.')
    if (body.length > 4000) return fail(res, 400, 'Messages can be at most 4000 characters.')
    if (attachmentIds.length > MAX_FILES_PER_MESSAGE) return fail(res, 400, `Send at most ${MAX_FILES_PER_MESSAGE} files at a time.`)
    const message = await postMessage({ channel: channel.id, senderId: req.me.id, kind: 'text', body, attachmentIds })
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
    const other = await activeIds([otherId])
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

  // ---------------- private groups
  r.post('/groups/create', wrap(async (req, res) => {
    const me = req.me
    const name = String(req.body?.name || '').trim().replace(/^#/, '')
    const description = String(req.body?.description || '').trim() || null
    const fields = {}
    if (name.length < 2) fields.name = 'Give the group a name (at least 2 characters).'
    else if (name.length > 60) fields.name = 'Group name can be at most 60 characters.'
    const people = (await activeIds(req.body?.member_ids)).filter((p) => p.id !== me.id)
    if (!people.length) fields.member_ids = 'Add at least one person.'
    if (Object.keys(fields).length) return fail(res, 400, Object.values(fields)[0], { fields })
    const client = await pool.connect()
    let channelId
    try {
      await client.query('begin')
      const ins = await client.query(
        `insert into public.chat_channels (slug, name, kind, description, created_by, sort_order)
         values ($1, $2, 'group', $3, $4, 50) returning id`,
        [`group:${crypto.randomUUID()}`, name, description, me.id])
      channelId = ins.rows[0].id
      await client.query(`insert into public.chat_members (channel_id, employee_id, role, added_by) values ($1, $2, 'owner', $2)`, [channelId, me.id])
      for (const p of people) {
        await client.query(`insert into public.chat_members (channel_id, employee_id, role, added_by) values ($1, $2, 'member', $3) on conflict do nothing`, [channelId, p.id, me.id])
      }
      await client.query('commit')
    } catch (e) {
      await client.query('rollback').catch(() => {})
      throw e
    } finally {
      client.release()
    }
    channelsChanged([me.id, ...people.map((p) => p.id)])
    await postMessage({ channel: channelId, senderId: me.id, kind: 'system', body: `created the group and added ${people.map((p) => p.full_name).join(', ')}` })
    notifyEmployees(people.map((p) => p.id), { title: `Added to ${name}`, body: `${me.full_name} added you to the group "${name}".`, link: `/chat?c=${channelId}` })
    res.json({ channel_id: channelId })
  }))

  r.post('/groups/members', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    if (!(await canAccess(req.me, channel)) || channel.kind === 'channel') return fail(res, 404, 'Group not found')
    const { rows } = await pool.query(
      `select e.id, e.full_name, e.emp_code, cm.role, cm.added_at from public.chat_members cm
         join public.employees e on e.id = cm.employee_id where cm.channel_id = $1
        order by (cm.role = 'owner') desc, e.full_name`, [channel.id])
    res.json({ members: rows, can_manage: await canManageGroup(req.me, channel), channel: { id: channel.id, name: channel.name, description: channel.description, kind: channel.kind } })
  }))

  r.post('/groups/add', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    if (!(await canManageGroup(req.me, channel))) return fail(res, 403, 'Only the group owner, Admin or HR can add people.')
    const existing = new Set(await members(channel.id))
    const people = (await activeIds(req.body?.member_ids)).filter((p) => !existing.has(p.id))
    if (!people.length) return fail(res, 400, 'Choose people who are not in the group yet.')
    for (const p of people) {
      await pool.query(`insert into public.chat_members (channel_id, employee_id, role, added_by) values ($1, $2, 'member', $3) on conflict do nothing`, [channel.id, p.id, req.me.id])
    }
    channelsChanged(people.map((p) => p.id))
    await postMessage({ channel: channel.id, senderId: req.me.id, kind: 'system', body: `added ${people.map((p) => p.full_name).join(', ')}` })
    notifyEmployees(people.map((p) => p.id), { title: `Added to ${channel.name}`, body: `${req.me.full_name} added you to the group "${channel.name}".`, link: `/chat?c=${channel.id}` })
    res.json({ ok: true })
  }))

  r.post('/groups/remove', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    const target = String(req.body?.employee_id || '')
    const leaving = target === req.me.id
    if (!leaving && !(await canManageGroup(req.me, channel))) return fail(res, 403, 'Only the group owner, Admin or HR can remove people.')
    if (channel?.kind !== 'group') return fail(res, 404, 'Group not found')
    const { rows } = await pool.query(
      `delete from public.chat_members where channel_id = $1 and employee_id = $2 returning role`, [channel.id, target])
    if (!rows[0]) return fail(res, 404, 'That person is not in the group.')
    // If the owner leaves, the longest-standing member becomes the owner.
    if (rows[0].role === 'owner') {
      await pool.query(
        `update public.chat_members set role = 'owner' where channel_id = $1 and employee_id =
           (select employee_id from public.chat_members where channel_id = $1 order by added_at limit 1)`, [channel.id])
    }
    const who = (await activeIds([target]))[0]?.full_name ?? 'someone'
    channelsChanged([target])
    if ((await members(channel.id)).length) {
      await postMessage({ channel: channel.id, senderId: req.me.id, kind: 'system', body: leaving ? 'left the group' : `removed ${who}` })
    }
    res.json({ ok: true })
  }))

  r.post('/groups/update', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    if (!(await canManageGroup(req.me, channel))) return fail(res, 403, 'Only the group owner, Admin or HR can edit the group.')
    const name = String(req.body?.name ?? channel.name).trim().replace(/^#/, '')
    if (name.length < 2 || name.length > 60) return fail(res, 400, 'Group name must be 2–60 characters.', { fields: { name: 'Group name must be 2–60 characters.' } })
    const description = String(req.body?.description ?? channel.description ?? '').trim() || null
    await pool.query('update public.chat_channels set name = $2, description = $3, updated_at = now() where id = $1', [channel.id, name, description])
    channelsChanged(await members(channel.id))
    if (name !== channel.name) await postMessage({ channel: channel.id, senderId: req.me.id, kind: 'system', body: `renamed the group to "${name}"` })
    res.json({ ok: true })
  }))

  r.post('/groups/delete', wrap(async (req, res) => {
    const channel = await loadChannel(req.body?.channel_id)
    if (!(await canManageGroup(req.me, channel))) return fail(res, 403, 'Only the group owner, Admin or HR can delete the group.')
    const ids = await members(channel.id)
    await pool.query('delete from public.chat_channels where id = $1', [channel.id])
    channelsChanged(ids)
    res.json({ ok: true })
  }))

  return r
}
