import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../src/db.js'
const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(here, '../db/migrations')
const migrations = (await fs.readdir(migrationsDir)).filter((f) => /^\d+.*\.sql$/.test(f)).sort()
try {
  for (const file of migrations) {
    await pool.query(await fs.readFile(path.join(migrationsDir, file), 'utf8'))
    console.log(`Applied migration: ${file}`)
  }
  console.log('HRMS migrations applied successfully.')
} catch (error) {
  console.error('Migration failed:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
