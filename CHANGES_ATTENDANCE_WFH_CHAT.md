# Leafy HRMS — attendance approvals, WFH, chat, reset code, employee validation

Copy these files over your project (same paths), then run the migration and restart.

```powershell
cd D:\Abitha\hrms\server
# add the new settings from server/.env.example to server/.env (OFFICE_IPS etc.)
npm run db:migrate
npm run dev          # API
cd ..
npm run dev          # app
```

No new npm packages are needed.

## New files
| File | What it does |
|---|---|
| `server/db/migrations/005_attendance_wfh_chat.sql` | All database changes (below) |
| `server/src/common.js` | IST time helpers, office-IP check (`OFFICE_IPS`), rules from `.env`, approver checks |
| `server/src/attendance.js` | `/api/attendance/*`: today, check-in, check-out, break, approvals, review, live board; 22:00 WFH auto check-out |
| `server/src/wfh.js` | `/api/wfh/*`: request, list, review (approve chosen days / reject), assign, cancel/revoke + emails |
| `server/src/chat.js` | `/api/chat/*`: channels, messages, send, read, DM, live stream (Server-Sent Events) |
| `src/lib/realtime.jsx` | One live connection per tab: chat messages, unread counts, approval notices, pop-ups |
| `src/lib/notify.js` | Notification permission, system notifications, the Leafy notification chime |
| `src/lib/geo.js` | Browser location for check-in / check-out |
| `src/pages/Wfh.jsx` | Work-from-home page (request, review with calendar, mark employee as WFH) |
| `src/pages/Chat.jsx` | Slack-style chat (#general, #shift-updates, #task-updates, direct messages) |
| `src/components/DayPicker.jsx` | Month calendar with a checkbox per day |
| `src/components/LiveShiftBoard.jsx` | Dashboard: shifted in / on break / shifted out / not in / on leave, live |
| `public/sw.js`, `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png` | Notifications on Android/iOS and "Add to Home Screen" install |

## Changed files
| File | Change |
|---|---|
| `server/src/index.js` | 4-digit reset code flow; field-level employee validation + duplicate employee code / email messages; mounts new routes; 22:00 WFH cron |
| `server/src/query.js` | Read access to `attendance_breaks`, `wfh_requests`, `wfh_days`; duplicate-code message on edit; task create / status changes post to #task-updates |
| `server/src/db.js` | DATE columns returned as `YYYY-MM-DD`; clearer duplicate messages |
| `server/db/migrations/001_hrms_enhancements.sql` | **Bug fix**: re-running migrations failed with "cannot drop columns from view" (001 and 004 both recreate `employee_directory`). Now drops the view first. |
| `server/.env.example` | New settings |
| `src/components/ui.jsx` | Red border + red message under each invalid field (`FormGrid errors`) |
| `src/pages/Employees.jsx` | Validates on "Create employee"/"Save", shows errors under each field + summary list, scrolls to the first error |
| `src/pages/Login.jsx` | Forgot password → email → 4-digit code → new + confirm password → back to sign in |
| `src/pages/Attendance.jsx` | New check-in card, breaks, typed vs actual times, location, Approvals tab for HR/Admin |
| `src/pages/Dashboard.jsx` | Live shift board |
| `src/components/Layout.jsx` | Chat unread badge, pop-up notifications, notification prompt, phone safe areas |
| `src/lib/db.js`, `src/lib/permissions.js`, `src/App.jsx`, `src/index.css`, `index.html` | API helper, new menu items/routes, mobile meta tags |

## Database changes (migration 005)
- `password_reset_codes` — hashed 4-digit code, attempts, expiry, one-time reset token.
- `attendance` new columns — `work_mode`, `check_in_system` / `check_out_system` (actual server time), `check_in_ip` / `check_out_ip`, `check_in_lat/lng/accuracy`, `check_out_lat/lng/accuracy`, `check_in_office_network` / `check_out_office_network`, `check_in_reason` / `check_out_reason`, `approval_status` (`not_required|pending|approved|rejected`), `approval_reasons[]`, `reviewed_by`, `reviewed_at`, `review_note`, `review_action`.
  `check_in` / `check_out` keep the time the employee typed (or the time HR accepted).
- Policies `att_insert_own` and `att_update_own` are **dropped**: employees now check in/out only through the API, so the server decides the real time and IP. HR/Admin manual marking still works.
- `attendance_breaks`, `wfh_requests`, `wfh_days`, `chat_channels`, `chat_members`, `chat_messages`, `chat_reads` (+ seed channels `general`, `shift-updates`, `task-updates`).

## How it behaves
**Employee code duplicate** — on "Create employee", every problem shows in red under its field, e.g. *"Employee code LEAFY-TVM-004 is already assigned to Vimal Kumar V (vimal@…)"*. Checked in the browser and again on the server; editing an existing employee to a used code shows the same message.

**Forgot password** — email → 4-digit code (valid 10 min, 5 wrong tries, one resend per minute) → new + confirm password → sign-in page. Codes are stored hashed.

**Check-in** — the time box is filled with the current time and is editable. Location is captured with each check-in/out (HTTPS required). HR/Admin approval is needed when any of these apply:
- pressed after **09:30 IST** (server clock);
- typed time is more than **15 min** from the actual time;
- not WFH and not on the office IP **49.37.232.136**.
A reason is required; HR/Admin get a pop-up + email with typed time, actual time, IP and a map link. Approve (optionally correcting the time) or reject → either keep the actual time, or record the day as **leave (LOP)** (default for other-network check-ins; LOP flows into payroll).

**Check-out** — editable time box, location + IP stored; both typed and actual times are stored and shown to the employee, their reporting person and HR/Admin.

**Work from home** — employee requests a date range with a reason → reporting person, HR and Admin get a pop-up + email → any one ticks the approved days on a calendar (or rejects) → employee is emailed. Approvers can also "Mark employee as WFH". On WFH days check-in works from any network (location still recorded) only between **09:00–22:00 IST**; open WFH shifts are closed automatically at 22:00.

**Chat** — #general, #shift-updates (shift in / break / shift out posted automatically), #task-updates (task created / moved posted automatically), direct messages. Pop-up (top-right) with a distinct three-note chime, system notifications when the tab is in the background, unread badges. #shift-updates is muted by default per user (bell icon to change).

**Dashboard** — live counts of shifted in / on break / shifted out / not in / on leave / WFH, plus pending check-in and WFH approvals.

**Devices** — responsive on laptop, tablet and phone; installable from the browser (Android: "Install app"; iPhone/iPad: Share → Add to Home Screen).

## Things to know
- **Office IP**: if your office internet also has IPv6, browsers may connect over IPv6 and won't match `49.37.232.136`. Add the office IPv6 prefix to `OFFICE_IPS`. If your ISP changes the public IP, update `OFFICE_IPS`.
- The API must see the real client IP: keep `app.set('trust proxy', 1)` (already set) on Railway.
- Chat live updates are in-memory: run **one** API instance (Railway default).
- iPhone notifications work only after "Add to Home Screen" (iOS 16.4+). Notifications appear while the app is open or in the background; push when the app is fully closed would need Web Push (VAPID) — not included.
- Location requires HTTPS (Netlify is fine) and permission; set `REQUIRE_LOCATION=false` to allow check-in without it.
