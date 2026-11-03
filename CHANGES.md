# Leafy HRMS leave concept update

## Changed files
- `src/pages/Leaves.jsx`: month-limited CL/Paid Leave balances, Intern probation accrual, gender-eligible maternity/paternity options, Leave Balances tab for visible reporting scope, generic balance validation.
- `src/pages/Employees.jsx`: keeps the previously requested `LEAFY-TVM-001` employee-code prefix change.
- `server/src/query.js`: sends leave-application email notifications to the employee's active reporting person's company email; preserves leave decision notification behavior.
- `server/src/mailer.js`: adds `sendLeaveRequestEmail`.

## New SQL migration
- `server/db/migrations/004_leave_concept.sql`

## Apply migration
From PowerShell:
```powershell
cd D:\Abitha\hrms\server
npm run db:migrate
```

Then restart the API and frontend. SMTP must be configured in `server/.env` for reporting-person emails to send.

## Policy behavior implemented
- Intern employment type is treated as probation: 1 paid leave per month, no carry-forward.
- Regular Casual Leave: 2 days available per month; unused current-year entitlement does not increase the following month's quota; unused annual entitlement can carry into the next year.
- Paid Leave: 2 days available per month, no carry-forward.
- Unpaid Leave (LOP): no fixed balance limit; approved unpaid days feed the existing payroll LOP summary and deduction calculation before payslip generation.
- Maternity Leave: 12 days/year, shown for employees whose gender is Female.
- Paternity Leave: 12 days/year, shown for employees whose gender is Male.
- Applying for leave emails the employee's reporting person's company email, when configured and assigned.

## Notes
- This is a changes-only package, not a full application archive.
- The annual carry-forward amount is computed from recorded approved/pending leave history and accrual settings. Historical records should be complete for accurate carry-forward balances.
- SMTP delivery requires valid provider credentials. Email send failures are logged without undoing a successful leave request.
