import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { can } from '../lib/permissions'
import { fmtDate, inr } from '../lib/format'
import { Loading, PageHeader, StatCard, StatusBadge, useToast } from '../components/ui'
import TaskBoard from '../components/TaskBoard'

export default function ProjectDetail() {
  const { id } = useParams()
  const { role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const canEdit = can(role, 'projects', 'edit')

  const [project, setProject] = useState(undefined)
  const [members, setMembers] = useState([])
  const [money, setMoney] = useState(null)
  const [add, setAdd] = useState({ employee_id: '', role: '' })

  const load = useCallback(async () => {
    const [p, m] = await Promise.all([
      db.from('projects').select('*').eq('id', id).maybeSingle(),
      db.from('project_members').select('*').eq('project_id', id),
    ])
    setProject(p.data ?? null)
    setMembers(m.data ?? [])
  }, [id])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (role !== 'admin' && role !== 'hr') return
    Promise.all([
      role === 'admin' ? db.from('incomes').select('amount').eq('project_id', id) : Promise.resolve({ data: null }),
      db.from('expenses').select('amount').eq('project_id', id),
    ]).then(([i, e]) => {
      const sum = (rows) => (rows ?? []).reduce((s, r) => s + Number(r.amount), 0)
      setMoney({ income: i.data ? sum(i.data) : null, expense: sum(e.data) })
    })
  }, [id, role])

  const addMember = async (e) => {
    e.preventDefault()
    const { error } = await db.from('project_members').insert({ project_id: id, employee_id: add.employee_id, role: add.role || null })
    if (error) return toast.error(error.message)
    setAdd({ employee_id: '', role: '' })
    load()
  }
  const removeMember = async (m) => {
    const { error } = await db.from('project_members').delete().eq('project_id', id).eq('employee_id', m.employee_id)
    if (error) return toast.error(error.message)
    load()
  }

  if (project === undefined) return <Loading />
  if (project === null) return <div className="card p-8 text-center text-sm text-gray-500">Project not found, or you don't have access to it.</div>

  const available = refs.activeStaff.filter((e) => !members.some((m) => m.employee_id === e.id))

  return (
    <>
      <Link to="/projects" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-leaf-700 hover:underline"><ArrowLeft size={14} /> Projects</Link>
      <PageHeader title={project.name} subtitle={project.description}>
        <StatusBadge status={project.status} />
        <StatusBadge status={project.priority} />
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Manager" value={<span className="text-lg">{project.manager_id ? refs.empName(project.manager_id) : '—'}</span>} />
        {(role === 'admin' || role === 'hr') && (
          <StatCard label="Client" value={<span className="text-lg">{project.client_id ? refs.clientName(project.client_id) : 'Internal'}</span>} />
        )}
        <StatCard label="Timeline" value={<span className="text-base">{fmtDate(project.start_date)} → {fmtDate(project.end_date)}</span>} />
        {money && (
          <StatCard
            label={money.income !== null ? 'Income / expenses' : 'Expenses'}
            value={<span className="text-lg">{money.income !== null ? `${inr(money.income)} / ` : ''}{inr(money.expense)}</span>}
            hint="Entries linked to this project"
          />
        )}
      </div>

      <div className="card mb-6 p-5">
        <h2 className="mb-3 font-bold">Team</h2>
        <div className="flex flex-wrap gap-2">
          {members.length === 0 && <span className="text-sm text-gray-500">No members yet.</span>}
          {members.map((m) => (
            <span key={m.employee_id} className="inline-flex items-center gap-2 rounded-full bg-lime-100 py-1 pl-3 pr-2 text-sm font-medium text-leaf-800">
              {refs.empName(m.employee_id)}{m.role && <span className="text-xs text-leaf-700/70">· {m.role}</span>}
              {canEdit && <button onClick={() => removeMember(m)} className="rounded-full p-0.5 hover:bg-lime-200" aria-label="Remove"><X size={13} /></button>}
            </span>
          ))}
        </div>
        {canEdit && (
          <form onSubmit={addMember} className="mt-4 flex flex-wrap gap-2">
            <select className="input w-auto min-w-[200px]" value={add.employee_id} onChange={(e) => setAdd({ ...add, employee_id: e.target.value })} required>
              <option value="">Add a member…</option>
              {available.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <input className="input w-auto" placeholder="Role (optional)" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })} />
            <button className="btn btn-leaf"><Plus size={16} /> Add</button>
          </form>
        )}
      </div>

      <h2 className="mb-3 text-lg font-bold">Tasks</h2>
      <TaskBoard projectId={id} />
    </>
  )
}
