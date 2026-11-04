import { pool } from '../src/db.js'
try { await pool.query('select 1'); console.log('DB OK') }
catch (e) { console.log('DB ERROR:', e.code, e.message) }
process.exit()