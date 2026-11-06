// Browser client for the HRMS API. It keeps the same chainable shape the pages already use
// (db.from('table').select().eq()...), but sends a JSON description to POST /api/db.
// Permissions are enforced on the server by PostgreSQL row-level security, not here.

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const KEY = 'leafy_hrms_session'

// ---------------------------------------------------------------- session
let session = null
const listeners = new Set()

const decode = (token) => {
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return p
  } catch {
    return null
  }
}

try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
  const p = saved && decode(saved.access_token)
  if (p && p.exp * 1000 > Date.now()) session = saved
  else localStorage.removeItem(KEY)
} catch { /* storage unavailable */ }

function setSession(s, event) {
  session = s
  try {
    s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY)
  } catch { /* ignore */ }
  listeners.forEach((cb) => cb(event, s))
}

async function request(path, body) {
  let res
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(body ?? {}),
    })
  } catch {
    return { status: 0, json: { error: 'Cannot reach the server. Check your connection and try again.' } }
  }
  const json = await res.json().catch(() => ({}))
  if (res.status === 401 && session && path !== '/api/auth/login') setSession(null, 'SIGNED_OUT')
  return { status: res.status, json }
}

// ---------------------------------------------------------------- auth
const auth = {
  getSession: async () => ({ data: { session } }),
  onAuthStateChange(cb) {
    listeners.add(cb)
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
  },
  async signInWithPassword({ email, password }) {
    const { status, json } = await request('/api/auth/login', { email, password })
    if (status !== 200) return { data: null, error: { message: json.error || 'Sign in failed' } }
    setSession({ access_token: json.access_token, user: json.user }, 'SIGNED_IN')
    return { data: { session }, error: null }
  },
  async signOut() {
    setSession(null, 'SIGNED_OUT')
    return { error: null }
  },
  async requestPasswordReset(email) {
    const { status, json } = await request('/api/auth/forgot-password', { email })
    return status === 200 ? { data: json, error: null } : { data: null, error: { message: json.error || 'Could not send the code' } }
  },
  async verifyResetCode(email, code) {
    const { status, json } = await request('/api/auth/verify-reset-code', { email, code })
    return status === 200 ? { data: json, error: null } : { data: null, error: { message: json.error || 'Could not verify the code', expired: !!json.expired } }
  },
  async resetPassword(token, password) {
    const { status, json } = await request('/api/auth/reset-password', { token, password })
    return status === 200 ? { data: json, error: null } : { data: null, error: { message: json.error || 'Could not reset password' } }
  },
  async updateUser({ password, current_password }) {
    const { status, json } = await request('/api/auth/change-password', { password, current_password })
    return status === 200 ? { error: null } : { error: { message: json.error || 'Could not update password' } }
  },
}

// ---------------------------------------------------------------- server functions (Admin / HR)
const functions = {
  async invoke(name, { body }) {
    const { status, json } = await request(`/api/admin/${name}`, body)
    if (status === 200) return { data: json, error: null }
    return { data: null, error: { message: json.error || 'Request failed', fields: json.fields, context: { json: async () => json } } }
  },
}

// ---------------------------------------------------------------- plain API calls (attendance, WFH, chat)
/** POST to an API route. Resolves { data, error } where error = { message, field, fields, status }. */
export async function api(path, body) {
  const { status, json } = await request(path, body)
  if (status === 200) return { data: json, error: null }
  return { data: null, error: { message: json.error || 'Request failed', field: json.field, fields: json.fields, status, details: json } }
}
/** Upload one file as raw bytes (chat attachments). Resolves { data, error }. */
export async function apiUpload(path, file, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API}${path}`)
    if (session) xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'pasted-image.png'))
    xhr.setRequestHeader('X-File-Type', file.type || 'application/octet-stream')
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      let json = {}
      try { json = JSON.parse(xhr.responseText || '{}') } catch { /* not json */ }
      if (xhr.status === 401 && session) setSession(null, 'SIGNED_OUT')
      resolve(xhr.status === 200 ? { data: json, error: null } : { data: null, error: { message: json.error || (xhr.status === 413 ? 'The file is too large.' : 'Upload failed') } })
    }
    xhr.onerror = () => resolve({ data: null, error: { message: 'Cannot reach the server. Check your connection and try again.' } })
    xhr.send(file)
  })
}

/** Download a protected file as a Blob (images and files in chat). */
export async function apiBlob(path) {
  const res = await fetch(`${API}${path}`, { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} })
  if (!res.ok) throw new Error('Could not load the file')
  return res.blob()
}

export const apiBase = API
export const getAccessToken = () => session?.access_token ?? null
export const onSessionChange = (cb) => { listeners.add(cb); return () => listeners.delete(cb) }

// ---------------------------------------------------------------- query builder
class Query {
  constructor(table) {
    this.spec = { table, action: 'select', select: '*', filters: [], order: [] }
  }
  select(cols = '*', opts = {}) {
    if (this.spec.action === 'select') {
      this.spec.select = cols
      if (opts.count) this.spec.count = opts.count
      if (opts.head) this.spec.head = true
    }
    return this
  }
  insert(values) { this.spec.action = 'insert'; this.spec.values = values; return this }
  update(values) { this.spec.action = 'update'; this.spec.values = values; return this }
  upsert(values, opts = {}) {
    this.spec.action = 'upsert'
    this.spec.values = values
    this.spec.onConflict = opts.onConflict
    this.spec.ignoreDuplicates = !!opts.ignoreDuplicates
    return this
  }
  delete() { this.spec.action = 'delete'; return this }
  filter(op, col, val) { this.spec.filters.push({ op, col, val }); return this }
  eq(c, v) { return this.filter('eq', c, v) }
  neq(c, v) { return this.filter('neq', c, v) }
  gt(c, v) { return this.filter('gt', c, v) }
  gte(c, v) { return this.filter('gte', c, v) }
  lt(c, v) { return this.filter('lt', c, v) }
  lte(c, v) { return this.filter('lte', c, v) }
  in(c, v) { return this.filter('in', c, v) }
  order(col, { ascending = true, nullsFirst } = {}) {
    this.spec.order.push({ col, asc: ascending, nullsFirst })
    return this
  }
  limit(n) { this.spec.limit = n; return this }
  single() { this.spec.single = 'single'; return this }
  maybeSingle() { this.spec.single = 'maybeSingle'; return this }

  then(resolve, reject) {
    return request('/api/db', this.spec)
      .then(({ status, json }) => {
        if (status === 200) return { data: json.data ?? null, count: json.count ?? null, error: null }
        const message = json.error?.message ?? json.error ?? 'Request failed'
        return { data: null, count: null, error: { message, field: json.error?.field } }
      })
      .then(resolve, reject)
  }
}

export const db = { from: (table) => new Query(table), auth, functions }
