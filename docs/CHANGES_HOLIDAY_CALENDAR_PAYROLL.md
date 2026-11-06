# Leafy HRMS — Holiday Calendar, Sat/Sun weekly off, per-day salary, attendance calendars

Copy the files over your two projects (same paths), then:

```powershell
cd Backend
npm run db:migrate        # applies 007_holiday_calendar.sql (safe to re-run)
```
No new npm packages.

## Rules now used everywhere
- **Weekly off: Saturday and Sunday.** Defined once in `leaveBalance.js` (`WEEKLY_OFF = [0, 6]`, frontend and backend copies).
- **Leave days and loss-of-pay days** don't count Saturdays, Sundays or Holiday Calendar days. This applies to the leave form, the server check and the payroll LOP summary.
- **Per-day salary = monthly gross ÷ calendar days in the month** (31 for October, 30 for November). Payroll's "Days in month" is filled with that number. LOP deduction = per-day × LOP days.

## Backend
| File | Change |
|---|---|
| `db/migrations/007_holiday_calendar.sql` | **New.** `company_holidays.kind` (festival / national / company) + `description`; `employee_directory` gains `role` (for search) |
| `src/leaveBalance.js` | `WEEKLY_OFF`, `isWeeklyOff`; `countLeaveDays` skips Sat, Sun and holidays |
| `src/query.js` | Leave request days are counted without Sat/Sun/holidays |
| `src/index.js` | Payroll LOP summary skips Saturdays too |

## Frontend (`src/hrms/...`)
| File | Change |
|---|---|
| `pages/Holidays.jsx` | **New.** Holiday Calendar for everyone. Admin/HR click a date to add, edit or remove a festival or holiday |
| `lib/attendanceMonth.js` | **New.** Loads a month and classifies each day; shared by both calendars |
| `components/AttendanceBits.jsx` | **New.** Shared `TimePair`, `Where` and the attendance table (Date · Status · In · Out · Where · Approval / note) |
| `components/TeamMonthGrid.jsx` | **New.** All employees × days of the month; click a day for details and Mark/Edit; click a name for that person's full calendar |
| `components/EmployeeCalendar.jsx` | Sat/Sun weekend, holiday names in cells; clicking a date shows the table row; Mark/Edit for HR/Admin |
| `pages/Attendance.jsx` | My attendance shows **My month** as a calendar; Employee calendar tab is the all-employees grid with search; search box on Team attendance (name, code, role, designation, department); HR can mark any date; holiday form moved to Holiday Calendar |
| `pages/Payroll.jsx` | Days in month = calendar days; per-day = gross ÷ days |
| `pages/Leaves.jsx` | Uses holidays in the day count; text updated |
| `pages/Wfh.jsx`, `components/DayPicker.jsx` | Saturday shown as weekend; Sat/Sun/holidays start unticked when approving WFH |
| `lib/refs.jsx` | Loads holidays once (`refs.holidays`, `refs.holiday(date)`, `refs.holidayDates`) |
| `lib/leaveBalance.js`, `lib/format.js` | Shared weekend/holiday rules (`leaveDays` now uses them) |
| `lib/permissions.js`, `App.jsx` | `/holidays` route and menu item (everyone sees it; Admin/HR manage it) |

## After updating
- **Payroll drafts generated before this update** still have the old "working days" number. Delete those drafts for the month and click *Generate* again, or edit "Days in month" to 30 / 31.
- Holidays you already added keep working. They show as "Festival" until you change the type.
- Working on a **holiday** still earns comp-off automatically. Working on a **Saturday/Sunday** does not, yet (tell me if it should).
