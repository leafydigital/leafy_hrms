import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, CalendarCheck, CalendarDays, FolderKanban, Home, ListChecks, TrendingDown, TrendingUp, UserCheck, Users } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { currentMonth, fmtDate, fmtTime, inr, monthEnd, monthLabel, monthStart, todayIST } from '../lib/format'
import { Badge, PageHeader, StatCard, StatusBadge } from '../components/ui'
import LiveShiftBoard from '../components/LiveShiftBoard'

const count = (q) => q.then((r) => r.count ?? 0)
const head = (table) => db.from(table).select('id', { count: 'exact', head: true })
const sum = (rows) => (rows ?? []).reduce((s, r) => s + Number(r.amount), 0)

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const { me, role } = useAuth()
  const refs = useRefs()
  const [d, setD] = useState(null)
  const today = todayIST()
  const month = currentMonth()
  const staffView = role === 'admin' || role === 'hr'

  useEffect(() => {
    const run = async () => {
      const mine = await Promise.all([
        db.from('tasks').select('*').eq('assignee_id', me.id).neq('status', 'done').order('due_date', { ascending: true, nullsFirst: false }).limit(6),
        count(head('leaves').eq('employee_id', me.id).eq('status', 'pending')),
        db.from('attendance').select('*').eq('employee_id', me.id).eq('date', today).maybeSingle(),
        count(head('projects')),
      ])
      const out = { tasks: mine[0].data ?? [], myPending: mine[1], attendance: mine[2].data, projects: mine[3] }

      if (staffView) {
        const [headcount, pending, present, onLeave, pendingList] = await Promise.all([
          count(head('employees').eq('status', 'active')),
          count(head('leaves').eq('status', 'pending').neq('employee_id', me.id)),
          count(head('attendance').eq('date', today).in('status', ['present', 'wfh', 'half_day'])),
          count(head('leaves').eq('status', 'approved').lte('start_date', today).gte('end_date', today)),
          db.from('leaves').select('*').eq('status', 'pending').neq('employee_id', me.id).order('created_at').limit(5),
        ])
        Object.assign(out, { headcount, pending, present, onLeave, pendingList: pendingList.data ?? [] })
        const exp = await db.from('expenses').select('amount').gte('date', monthStart(month)).lte('date', monthEnd(month))
        out.expense = sum(exp.data)
        if (role === 'admin') {
          const [inc, active] = await Promise.all([
            db.from('incomes').select('amount').gte('date', monthStart(month)).lte('date', monthEnd(month)),
            count(head('projects').eq('status', 'active')),
          ])
          Object.assign(out, { income: sum(inc.data), activeProjects: active })
        }
      }

      if (role === 'accounts') {
        const [headcount, pay] = await Promise.all([
          count(head('employees').eq('status', 'active')),
          db.from('payroll').select('status,net_pay').eq('month', monthStart(month)),
        ])
        const rows = pay.data ?? []
        Object.assign(out, {
          headcount,
          payDraft: rows.filter((r) => r.status === 'draft').length,
          payPublished: rows.filter((r) => r.status === 'published').length,
          payPaid: rows.filter((r) => r.status === 'paid').length,
          payNet: rows.reduce((s, r) => s + Number(r.net_pay), 0),
        })
      }
      setD(out)
    }
    run()
  }, [me.id, role])

  const first = me.full_name.split(' ')[0]

  return (
    <>
      <PageHeader title={`${greeting()}, ${first}`} subtitle={`${me.designation?.name ?? ''}${me.department?.name ? ` · ${me.department.name}` : ''} — ${fmtDate(today)}`} />

      <LiveShiftBoard />
      {!d ? null : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {staffView && <StatCard label="Active employees" value={d.headcount} icon={Users} />}
            {staffView && <StatCard label="Present today" value={d.present} icon={UserCheck} hint={`${d.onLeave} on approved leave`} />}
            {staffView && <StatCard label="Leave to review" value={d.pending} icon={CalendarCheck} />}
            {role === 'admin' && <StatCard label="Active projects" value={d.activeProjects} icon={FolderKanban} />}
            {role === 'admin' && <StatCard label={`Income · ${monthLabel(month)}`} value={inr(d.income)} icon={TrendingUp} />}
            {staffView && <StatCard label={`Expenses · ${monthLabel(month)}`} value={inr(d.expense)} icon={TrendingDown} />}

            {role === 'accounts' && <StatCard label="Active employees" value={d.headcount} icon={Users} />}
            {role === 'accounts' && <StatCard label={`Net payroll · ${monthLabel(month)}`} value={inr(d.payNet)} icon={Banknote} />}
            {role === 'accounts' && <StatCard label="Payroll drafts" value={d.payDraft} hint={`${d.payPublished} published · ${d.payPaid} paid`} />}

            {role !== 'accounts' && !staffView && <StatCard label="My open tasks" value={d.tasks.length} icon={ListChecks} />}
            {role !== 'accounts' && !staffView && <StatCard label="My projects" value={d.projects} icon={FolderKanban} />}
            {!staffView && <StatCard label="My pending leave" value={d.myPending} icon={CalendarDays} />}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="mb-3 font-bold">Today</h2>
              {d.attendance ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <StatusBadge status={d.attendance.status} />
                  <span>In <b>{fmtTime(d.attendance.check_in)}</b></span>
                  <span>Out <b>{fmtTime(d.attendance.check_out)}</b></span>
                  {!d.attendance.check_out && <Link to="/attendance" className="ml-auto font-semibold text-leaf-700 hover:underline">Check out →</Link>}
                </div>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">You haven't checked in yet.</span>
                  <Link to="/attendance" className="btn btn-primary btn-sm">Check in</Link>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/leaves?apply=1" className="btn btn-ghost btn-sm"><CalendarDays size={14} /> Apply for leave</Link>
                <Link to="/wfh?request=1" className="btn btn-ghost btn-sm"><Home size={14} /> Request WFH</Link>
                <Link to="/payslips" className="btn btn-ghost btn-sm">My payslips</Link>
              </div>
            </div>

            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold">My open tasks</h2>
                <Link to="/tasks" className="text-sm font-semibold text-leaf-700 hover:underline">View all</Link>
              </div>
              {d.tasks.length === 0 ? <p className="text-sm text-gray-500">Nothing assigned to you right now.</p> : (
                <ul className="divide-y divide-gray-100">
                  {d.tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{t.title}</div>
                        <div className="text-xs text-gray-500">{refs.projectName(t.project_id)}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {t.due_date && <Badge tone={t.due_date < today ? 'red' : 'gray'}>{fmtDate(t.due_date)}</Badge>}
                        <StatusBadge status={t.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {staffView && (
              <div className="card p-5 lg:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-bold">Leave awaiting approval</h2>
                  <Link to="/leaves?tab=approvals" className="text-sm font-semibold text-leaf-700 hover:underline">Open approvals</Link>
                </div>
                {d.pendingList.length === 0 ? <p className="text-sm text-gray-500">All caught up.</p> : (
                  <ul className="divide-y divide-gray-100">
                    {d.pendingList.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                        <span><b>{refs.empName(l.employee_id)}</b> · {refs.leaveType(l.leave_type_id)?.name}</span>
                        <span className="text-gray-600">{fmtDate(l.start_date)}{l.end_date !== l.start_date && ` → ${fmtDate(l.end_date)}`} · {Number(l.days)} day(s)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
