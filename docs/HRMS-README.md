# Leafy Digital HRMS

React + Vite + Tailwind (frontend) · Node.js + Express (API) · PostgreSQL.
Theme from the Leafy Digital logo (lime `#9ED03E`, leaf green `#428638`, black).

```
hrms/
├─ src/                    React app            (npm run dev  → http://localhost:5173)
├─ server/
│  ├─ db/schema.sql        base tables, seed data, row-level security
  │  └─ migrations/       additive HRMS enhancements
│  ├─ src/                 Express API          (npm run server → http://localhost:4000)
│  └─ scripts/             setup-db.js, create-admin.js
```

## Setup

1. **Create a PostgreSQL database** with your managed provider (Railway / Neon / RDS) and copy its connection string.
2. **API config** — create `server/.env` (copy `server/.env.example`):
   ```
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
   JWT_SECRET=<long random string>
   ```
   Generate the secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
   If your provider's connection fails on SSL, add `DATABASE_SSL=false`.
3. **Install and create the tables**
   ```powershell
   npm install
   cd server
   npm install
   npm run db:setup        # base tables + seed data
   npm run db:migrate      # HRMS enhancements: employee fields, role-aware RLS, holidays, comp-off, salary components
   npm run create-admin    # asks for your name, email and password
   cd ..
   ```
4. **Run it** (two terminals)
   ```powershell
   npm run server          # API on :4000
   npm run dev             # app on :5173
   ```
   Sign in with the admin you just created, then add HR, Accounts and employees from **Employees → Add employee**.
   Each new employee gets a temporary password that is shown once.

## Deploying

| Part | Where | Settings |
|---|---|---|
| API | Railway (Node service, root dir `server`, start `npm start`) | `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN=https://your-app.netlify.app` |
| App | Netlify (build `npm run build`, publish `dist`) | `VITE_API_URL=https://your-api.up.railway.app` |

`public/_redirects` already handles page refreshes on Netlify.

## Who can do what

| Module | Admin (Founder/CEO/COO/CTO/Admin) | HR | Accounts | Employee |
|---|---|---|---|---|
| Employees | Full | Add / edit (not Admin accounts) | View | — |
| Departments, Designations | Full | View | — | — |
| Roles page | View | — | — | — |
| Leave | Full | Approve/reject, add, manage (not own) | Own | Apply / view / cancel own |
| Attendance | Full | Full | Own | Own check-in/out |
| Salary & Payroll | Full | Add / manage | Add / manage | — |
| Payslips | Own | Own | Own | Own, view only |
| Income | Full | — | — | — |
| Expenses | Full | Add / update | — | — |
| Clients | Full | View | — | — |
| Projects & Tasks | Full | View only | — | Assigned only (update own task status) |

Leave requests are reviewed by Admin, HR, CEO, CTO, or COO. HR cannot approve their own leave; Admin or senior leadership can review it. Reporting managers can view their direct reports' leave records but cannot approve them.

## How security works

- Passwords are bcrypt-hashed; sign-in returns a 12-hour token. Login is rate-limited.
- Every data request runs in PostgreSQL as a restricted role (`app_user`) with the signed-in user's id attached. Base row-level security is defined in `server/db/schema.sql`; run the additive migration after setup for the new role/reporting policies and tables. The API also filters sensitive employee columns for non-HR/Admin reads.
- `src/lib/permissions.js` only controls which menu items and buttons appear. If you change a rule, change it in both places.
- The API accepts only whitelisted tables and columns, and every value is a bound parameter.
- Employee payslips are view-only (no download, copy/print blocked, watermarked). A browser can't stop screenshots.

## Notes
- Leave requests exclude Sundays from their day count. Payroll LOP is calculated server-side from approved Unpaid Leave and excludes Sundays and configured company holidays; the endpoint returns only per-employee totals to authorized payroll users.
- Casual Leave accrues 2 days monthly (24 per year) and carries forward; other new leave-type policies should be confirmed/configured under Leave → Leave policies before employees rely on them.
- Previous-employment documents are stored in the private `employee_experiences` table and are limited by RLS to Admin/HR. This implementation limits each uploaded file to 2 MB.
- Aadhaar and emergency-contact fields are not returned to non-HR/Admin employee-table reads by the API layer. Configure database backups and access controls carefully.
- Back up the database with your provider's scheduled backups; payroll records live there.
