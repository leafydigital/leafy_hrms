// Creates the first Admin login. Run once after db:setup:  npm run create-admin
import 'dotenv/config'
import readline from 'node:readline'
import bcrypt from 'bcryptjs'
import { asOwner, pool } from '../src/db.js'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
let muted = false
const origWrite = rl._writeToOutput
rl._writeToOutput = function (s) { if (!muted) origWrite.call(rl, s) }
const ask = (q, hidden = false) =>
  new Promise((resolve) => {
    rl.question(q, (a) => { muted = false; if (hidden) process.stdout.write('\n'); resolve(a.trim()) })
    muted = hidden
  })

try {
  const name = process.env.ADMIN_NAME || (await ask('Full name: '))
  const email = (process.env.ADMIN_EMAIL || (await ask('Work email: '))).toLowerCase()
  const password = process.env.ADMIN_PASSWORD || (await ask('Password (min 8 characters): ', true))
  const title =
    process.env.ADMIN_DESIGNATION ||
    (process.env.ADMIN_EMAIL ? '' : await ask('Designation [Founder / CEO / COO / CTO / Admin] (Founder): ')) ||
    'Founder'
  if (!name || !email || password.length < 8) throw new Error('Name, email and a password of at least 8 characters are required.')

  const row = await asOwner(async (c) => {
    const dept = await c.query("select id from public.departments where name = 'Admin'")
    const des = await c.query('select id from public.designations where department_id = $1 and lower(name) = lower($2)', [dept.rows[0]?.id, title])
    if (!dept.rows[0] || !des.rows[0]) throw new Error(`Could not find the "${title}" designation. Did db:setup run?`)
    const u = await c.query('insert into public.users (email, password_hash) values ($1, $2) returning id', [email, await bcrypt.hash(password, 10)])
    const e = await c.query(
      `insert into public.employees (user_id, full_name, email, role, department_id, designation_id, date_of_joining)
       values ($1, $2, $3, 'admin', $4, $5, current_date) returning emp_code`,
      [u.rows[0].id, name, email, dept.rows[0].id, des.rows[0].id],
    )
    return e.rows[0]
  })
  console.log(`\nAdmin created (${row.emp_code}). Sign in with ${email}.`)
} catch (e) {
  console.error('\nFailed:', e.code === '23505' ? 'that email already exists.' : e.message)
  process.exitCode = 1
} finally {
  rl.close()
  await pool.end()
}
