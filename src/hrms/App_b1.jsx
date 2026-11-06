import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/useAuth'
import { RefsProvider } from './lib/refs'
import { RealtimeProvider } from './lib/realtime'
import { can } from './lib/permissions'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import Departments from './pages/Departments'
import Designations from './pages/Designations'
import Roles from './pages/Roles'
import Leaves from './pages/Leaves'
import Attendance from './pages/Attendance'
import Salary from './pages/Salary'
import SalarySlabs from './pages/SalarySlabs'
import Payroll from './pages/Payroll'
import Payslips from './pages/Payslips'
import Income from './pages/Income'
import Expenses from './pages/Expenses'
import Clients from './pages/Clients'
import Projects from './pages/Projects'
import ProjectDetail from './pages/ProjectDetail'
import Tasks from './pages/Tasks'
import Wfh from './pages/Wfh'
import Chat from './pages/Chat'
import Profile from './pages/Profile'

function Notice({ title, children, action }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="card max-w-md p-8 text-center">
        <img src={`${__HRMS_BASE__}/mark.png`} alt="" className="mx-auto mb-4 h-16 w-auto" />
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="mt-2 text-sm text-gray-600">{children}</div>
        {action}
      </div>
    </div>
  )
}

function Guard({ module, children }) {
  const { role } = useAuth()
  return can(role, module) ? children : <Navigate to="/" replace />
}

export default function App() {
  const { session, me, loading, signOut } = useAuth()

  if (loading) return <Loading />
  if (!session) return <Login />
  if (!me)
    return (
      <Notice
        title="No active employee profile"
        action={<button className="btn btn-dark mt-5" onClick={signOut}>Sign out</button>}
      >
        You're signed in, but there's no active employee record linked to this login. Ask Admin or HR to set it up.
      </Notice>
    )

  const g = (module, el) => <Guard module={module}>{el}</Guard>
  return (
    <RefsProvider>
      <RealtimeProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/employees" element={g('employees', <Employees />)} />
          <Route path="/departments" element={g('departments', <Departments />)} />
          <Route path="/designations" element={g('designations', <Designations />)} />
          <Route path="/roles" element={g('roles', <Roles />)} />
          <Route path="/leaves" element={g('leaves', <Leaves />)} />
          <Route path="/attendance" element={g('attendance', <Attendance />)} />
          <Route path="/wfh" element={g('wfh', <Wfh />)} />
          <Route path="/chat" element={g('chat', <Chat />)} />
          <Route path="/profile" element={g('profile', <Profile />)} />
          <Route path="/salary" element={g('salary', <Salary />)} />
          <Route path="/salary-slabs" element={g('salarySlabs', <SalarySlabs />)} />
          <Route path="/payroll" element={g('payroll', <Payroll />)} />
          <Route path="/payslips" element={g('payslips', <Payslips />)} />
          <Route path="/income" element={g('income', <Income />)} />
          <Route path="/expenses" element={g('expenses', <Expenses />)} />
          <Route path="/clients" element={g('clients', <Clients />)} />
          <Route path="/projects" element={g('projects', <Projects />)} />
          <Route path="/projects/:id" element={g('projects', <ProjectDetail />)} />
          <Route path="/tasks" element={g('tasks', <Tasks />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
      </RealtimeProvider>
    </RefsProvider>
  )
}
