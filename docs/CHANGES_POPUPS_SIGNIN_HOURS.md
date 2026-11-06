# Leafy HRMS — date details in pop-ups, live board list, sign-in hours 8 AM – 10 PM

Copy the files over your two projects (same paths) and restart the API.
**No database changes** this time (no migration to run). No new npm packages.

Optional settings in `Backend/.env` (defaults shown):
```
LOGIN_WINDOW_START=08:00
LOGIN_WINDOW_END=22:00
LOGIN_WINDOW_EXEMPT_ROLES=admin,hr,ceo,cto,coo
WFH_WINDOW_START=08:00
WFH_WINDOW_END=22:00
```

## Files
| File | Change |
|---|---|
| `Backend/src/common.js` | Sign-in hours settings + `outsideLoginHours()`; WFH window now starts 08:00 |
| `Backend/src/index.js` | Sign-in refused outside 8 AM – 10 PM; every request checks the hours, so open sessions are signed out at 10 PM |
| `Backend/src/chat.js` | The live connection tells the browser to sign out when the hours end |
| `Backend/src/attendance.js` | Live board query now also returns employee code, department and designation |
| `Backend/src/wfh.js` | Email text: WFH hours 08:00–22:00 |
| `Backend/.env.example` | New settings |
| `Frontend/src/hrms/components/EmployeeCalendar.jsx` | Clicking a date opens the details (and Mark/Edit) in a pop-up |
| `Frontend/src/hrms/components/TeamMonthGrid.jsx` | Clicking a day in the all-employees grid opens the details in a pop-up |
| `Frontend/src/hrms/components/LiveShiftBoard.jsx` | No more names under the counts. Clicking a count opens a pop-up list (Emp code · Name · Department, plus In/Out) with search, department filter, and 100 rows at a time |
| `Frontend/src/hrms/lib/db.js` | Signs out with a message when the server says "outside hours" |
| `Frontend/src/hrms/lib/realtime.jsx` | Same, when the live connection says the hours have ended |
| `Frontend/src/hrms/pages/Login.jsx` | Shows the hours and the sign-out message |
| `Frontend/src/hrms/pages/Wfh.jsx` | Text: WFH hours 08:00–22:00 |

## How sign-in hours work
- Employees (and Accounts) can sign in and use the HRMS **8:00 AM – 10:00 PM IST**.
- At 10 PM anyone still signed in is signed out within about 30 seconds. The sign-in page then says the HRMS is available 8 AM – 10 PM.
- Admin, HR, CEO, CTO and COO are exempt, so they can still approve and fix things at night. To include them too, set `LOGIN_WINDOW_EXEMPT_ROLES=` (empty).
- The **forgot password** screen stays available at any time.
