// Creates all tables, security rules and seed data (departments, designations, leave types).
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pool } from '../src/db.js'

const sql = readFileSync(fileURLToPath(new URL('../db/schema.sql', import.meta.url)), 'utf8')

try {
  const { rows } = await pool.query("select to_regclass('public.employees') as t")
  if (rows[0].t) {
    console.log('The database already has the HRMS tables, so nothing was changed.')
    console.log('To start over, drop the schema in your database console first, then run this again.')
  } else {
    await pool.query(sql)
    console.log('Database ready. Next: npm run create-admin')
  }
} catch (e) {
  console.error('Setup failed:', e.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
