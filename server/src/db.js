import 'dotenv/config'
import pg from 'pg'

// numeric/int8 are returned as strings by default; the SQL layer returns JSON anyway,
// so only the few direct queries below are affected.
// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates (avoids timezone shifts).
pg.types.setTypeParser(1082, (v) => v)

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Copy server/.env.example to server/.env and fill it in.')
  process.exit(1)
}

const host = (() => {
  try { return new URL(url).hostname } catch { return '' }
})()
const isLocal = ['localhost', '127.0.0.1', '::1', ''].includes(host)
const ssl =
  process.env.DATABASE_SSL === 'false' ? false
  : process.env.DATABASE_SSL === 'true' || !isLocal ? { rejectUnauthorized: false }
  : false

export const pool = new pg.Pool({
  connectionString: url.replace(/[?&]sslmode=[^&]*/g, ''),
  ssl,
  max: 10,
  idleTimeoutMillis: 30000,
})
pool.on('error', (e) => console.error('Idle DB client error:', e.message))

/** Run fn inside a transaction as the restricted role, acting as `uid` so RLS applies. */
export async function asUser(uid, fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set local role app_user')
    await client.query("set local statement_timeout = '15s'")
    await client.query("select set_config('app.user_id', $1, true)", [uid])
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Run fn in a plain transaction with the owner role (server-side admin work only). */
export async function asOwner(fn) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const out = await fn(client)
    await client.query('commit')
    return out
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export function friendlyError(e) {
  switch (e.code) {
    case '42501': return 'You do not have permission to do that.'
    case '23505':
      if (String(e.constraint || '').includes('emp_code')) return 'This employee code is already assigned to another employee.'
      if (String(e.constraint || '').includes('email')) return 'This email is already in use by another employee.'
      return 'A record with these details already exists.'
    case '23503': return 'This record is linked to other data, so it cannot be changed or deleted.'
    case '23514': return 'One of the values is not allowed.'
    case '23502': return `A required value is missing${e.column ? `: ${e.column}` : ''}.`
    case '22P02': case '22007': case '22008': return 'One of the values has an invalid format.'
    case '57014': return 'The request took too long. Please try again.'
    case 'P0001': return e.message // raised by our own triggers, e.g. "You can only change the status of your tasks"
    default:
      console.error('DB error:', e.code, e.message)
      return 'Something went wrong on the server.'
  }
}
