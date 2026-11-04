import {
  LayoutDashboard, Users, Building2, BadgeCheck, ShieldCheck, CalendarDays, Clock, Wallet,
  Banknote, FileText, TrendingUp, TrendingDown, Handshake, FolderKanban, ListChecks, Layers, Home, MessageSquare,
} from 'lucide-react'

// System access roles. Admin = Founder, CEO, COO, CTO, Admin designations.
export const ROLES = {
  admin: { label: 'Admin', desc: 'Full access to everything. Marks income & expenses.' },
  hr: { label: 'HR', desc: 'Employees, salary, leave, attendance; expenses; read-only on projects & tasks.' },
  accounts: { label: 'Accounts', desc: 'Adds & manages salary / payroll and views employee salary details.' },
  employee: { label: 'Employee', desc: 'Own leave, attendance, payslips, assigned projects & tasks.' },
  ceo: { label: 'CEO', desc: 'Senior leadership; organization-wide leave and attendance visibility.' },
  cto: { label: 'CTO', desc: 'Senior leadership; organization-wide leave and attendance visibility.' },
  coo: { label: 'COO', desc: 'Senior leadership; organization-wide leave and attendance visibility.' },
}

const A = 'admin', H = 'hr', AC = 'accounts', E = 'employee', LEAD = ['ceo', 'cto', 'coo']
const ALL = [A, H, AC, E, ...LEAD]
const LEADERS = [A, H, ...LEAD]

// Mirrors the RLS policies in server/db/schema.sql — the database is the real gatekeeper,
// this map only decides what the UI shows.
export const PERMS = {
  dashboard:    { view: ALL },
  employees:    { view: [A, H, AC], create: [A, H], edit: [A, H], remove: [A] },
  departments:  { view: [A, H], create: [A], edit: [A], remove: [A] },
  designations: { view: [A, H], create: [A], edit: [A], remove: [A] },
  roles:        { view: [A] },
  leaves:       { view: ALL, review: LEADERS },
  attendance:   { view: ALL, manage: [A, H], approve: [A, H] },
  wfh:          { view: ALL },
  chat:         { view: ALL },
  salary:       { view: [A, H, AC], edit: [A, H, AC] },
  salarySlabs:  { view: [A, H, ...LEAD], create: [A, H, ...LEAD], edit: [A, H, ...LEAD], remove: [A, H, ...LEAD] },
  payroll:      { view: [A, H, AC], edit: [A, H, AC] },
  payslips:     { view: ALL },
  income:       { view: [A], create: [A], edit: [A], remove: [A] },
  expenses:     { view: [A, H], create: [A, H], edit: [A, H], remove: [A, H] },
  clients:      { view: [A, H], create: [A], edit: [A], remove: [A] },
  projects:     { view: ALL, create: [A], edit: [A], remove: [A] },
  tasks:        { view: ALL, create: [A], edit: [A], remove: [A], status: ALL },
}

export const can = (role, module, action = 'view') => !!PERMS[module]?.[action]?.includes(role)

export const NAV = [
  { group: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, module: 'dashboard' },
    { to: '/chat', label: 'Chat', icon: MessageSquare, module: 'chat', badge: 'chat' },
  ] },
  { group: 'People', items: [
    { to: '/employees', label: 'Employees', icon: Users, module: 'employees' },
    { to: '/departments', label: 'Departments', icon: Building2, module: 'departments' },
    { to: '/designations', label: 'Designations', icon: BadgeCheck, module: 'designations' },
    { to: '/roles', label: 'Roles', icon: ShieldCheck, module: 'roles' },
  ] },
  { group: 'Time', items: [
    { to: '/leaves', label: 'Leave', icon: CalendarDays, module: 'leaves' },
    { to: '/attendance', label: 'Attendance', icon: Clock, module: 'attendance' },
    { to: '/wfh', label: 'Work from home', icon: Home, module: 'wfh' },
  ] },
  { group: 'Pay', items: [
    { to: '/salary', label: 'Salary', icon: Wallet, module: 'salary' },
    { to: '/salary-slabs', label: 'Salary Slabs', icon: Layers, module: 'salarySlabs' },
    { to: '/payroll', label: 'Payroll', icon: Banknote, module: 'payroll' },
    { to: '/payslips', label: 'My Payslips', icon: FileText, module: 'payslips' },
  ] },
  { group: 'Finance', items: [
    { to: '/income', label: 'Income', icon: TrendingUp, module: 'income' },
    { to: '/expenses', label: 'Expenses', icon: TrendingDown, module: 'expenses' },
  ] },
  { group: 'Work', items: [
    { to: '/clients', label: 'Clients', icon: Handshake, module: 'clients' },
    { to: '/projects', label: 'Projects', icon: FolderKanban, module: 'projects' },
    { to: '/tasks', label: 'Tasks', icon: ListChecks, module: 'tasks' },
  ] },
]
