# Salary Slabs change

## Changed files
- `src/lib/permissions.js` — added Salary Slabs menu and permissions for Admin, HR, CEO, CTO, COO.
- `src/App.jsx` — registered `/salary-slabs` route.
- `src/pages/Salary.jsx` — added slab selection; choosing an active slab pre-fills salary component values, which remain editable before saving.
- `server/src/query.js` — whitelisted `salary_slabs` for the existing database query API.

## New files
- `src/pages/SalarySlabs.jsx` — create/edit/activate/deactivate reusable salary slabs and preview monthly gross / annual fixed CTC.
- `server/db/migrations/003_salary_slabs.sql` — creates salary slab table, generated totals, salary structure link, RLS policies, and grants.

## Apply
From `D:\Abitha\hrms\server`, run:

```powershell
npm run db:migrate
```

Then from the project root:

```powershell
npm run build
```

The migration is idempotent and creates `salary_slabs`, adds `salary_structures.salary_slab_id`, and grants management access only to Admin, HR, CEO, CTO, and COO via RLS. Salary component values are copied into the employee's salary structure when a slab is selected; editing an employee's salary does not change the reusable slab.
