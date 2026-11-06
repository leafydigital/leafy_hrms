# Leafy HRMS — My Profile, leave balance check, WFH switch, task notes, employee calendar

Copy the files over your two projects (same paths), then:

```powershell
cd Backend
npm run db:migrate        # applies 006_profile_tasks_calendar.sql (safe to re-run)
npm run dev
```
No new npm packages. Optional new setting in `Backend/.env` (default shown):
```
ATTENDANCE_SELF_APPROVED_ROLES=admin,hr,ceo,cto,coo
```

## Backend
| File | Change |
|---|---|
| `db/migrations/006_profile_tasks_calendar.sql` | **New.** All database changes (below) |
| `db/migrations/001_hrms_enhancements.sql` | Re-run fix again (drops `employee_directory` before re-creating) — your copy had lost it, so `db:migrate` would fail with "cannot drop columns from view" |
| `src/leaveBalance.js` | **New.** Leave balance rules (same file as the frontend's `lib/leaveBalance.js`) |
| `src/profile.js` | **New.** `POST /api/profile/me`, `POST /api/profile/update` |
| `src/query.js` | Employee's own leave request is checked against the remaining balance on the server; half-day needs morning/afternoon; leave days recalculated server-side; `task_activities` table; note pop-up to assignee + creator |
| `src/attendance.js` | Admin/HR/CEO/CTO/COO check-in never needs approval; `POST /api/attendance/wfh-switch`; opted-out WFH days ignored |
| `src/common.js` | `ATTENDANCE_SELF_APPROVED_ROLES` setting |
| `src/wfh.js` | Re-approving a WFH day clears an earlier "at the office" switch |
| `src/index.js` | Mounts `/api/profile` |
| `.env.example` | Restored (was missing) + new setting |

## Frontend (`src/hrms/...`)
| File | Change |
|---|---|
| `lib/leaveBalance.js` | **New.** Shared balance rules |
| `pages/Profile.jsx` | **New.** My Profile |
| `components/TaskDetail.jsx` | **New.** Task view with status + notes + activity history |
| `components/EmployeeCalendar.jsx` | **New.** Month calendar per employee |
| `pages/Leaves.jsx` | Remaining balance shown as soon as a type is chosen (also in the drop-down); blocked when 0 or not enough; morning/afternoon for half day; `?apply=1` opens the form; `?tab=approvals` |
| `pages/Attendance.jsx` | "I'm at the office today" switch; no approval notice for exempt roles; **Employee calendar** tab; half-day session in HR edit; CEO/CTO/COO see all |
| `pages/Dashboard.jsx` | Apply for leave / Request WFH open the form directly |
| `pages/Wfh.jsx` | `?request=1` opens the request form |
| `components/TaskBoard.jsx` | Click a task (or the notes icon) to open its notes & activity; `?task=<id>` deep link |
| `components/Layout.jsx` | Your name in the sidebar opens My Profile |
| `App.jsx`, `lib/permissions.js` | `/profile` route + menu item; `attendance.viewAll` for Admin/HR/CEO/CTO/COO |

## Database changes (migration 006)
- `wfh_days.opted_out_at`, `wfh_days.opted_out_note` — employee switched an approved WFH day to office.
- `leaves.half_day_session`, `attendance.half_day_session` — `morning` / `afternoon` (the half taken off).
- Policy `att_read` now uses `can_view_employee()` → CEO/CTO/COO can see all attendance; reporting persons their team.
- `task_activities` — created / status (old → new) / assigned (written by a trigger on `tasks`) and notes (inserted by users, in their own name, only on tasks they can see). Existing tasks get a "created" entry.
- `employee_profile_changes` — every My Profile edit (field, old, new, when). Not readable through the app API.

## How it behaves
- **Attendance approval:** Admin, HR, CEO, CTO, COO check in/out without approval. Late/other network/edited time is still recorded. Other employees unchanged.
- **WFH → office:** on an approved WFH day the employee sees *"I'm at the office today"*. Office rules (office network) then apply. They can switch back before check-in. Posted in #shift-updates.
- **My Profile:** everyone sees their full record (bank/PAN/Aadhaar masked). They can edit mobile, personal email, address, PIN, emergency contact, blood group. Job, bank and ID stay with HR. HR gets a pop-up; changes are listed on the profile.
- **Leave balance:** choosing *Casual Leave* immediately shows e.g. *"2 days of Casual Leave remaining for November"*. With 0 left (or fewer than requested) the button is disabled and the server refuses the request too. HR/Admin "Add for an employee" can still go over the balance (shown as a warning).
- **Task notes (Odoo-style):** open a task → change status and/or log a note → the activity list shows *Created*, *To do → In progress*, notes, *In progress → Review*… with who and when. The assignee and the creator get a pop-up for new notes.
- **Employee calendar:** Attendance → Employee calendar → search → pick. ✓ present (W = WFH), ✗ leave (with type, e.g. CL / LOP / C/O), ½ half day with *AM off* / *PM off*, A absent, HD holiday, HD✓ worked on holiday with *C/O open* or *C/O used*. Click a day for times, location, leave and comp-off details (used on which date). Monthly totals underneath.

## Notes
- Half-day without a stored session (older records) is worked out from times: check-in after 12:00 → morning off; check-out by 14:00 → afternoon off.
- Comp-off "used" is matched oldest-earned-first against approved Comp Off leave.
