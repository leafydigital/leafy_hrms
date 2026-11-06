import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MessageSquareText, Pencil, Plus, Trash2 } from 'lucide-react'
import TaskDetail from './TaskDetail'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { can } from '../lib/permissions'
import { fmtDate, label, todayIST } from '../lib/format'
import { Badge, FormGrid, Loading, Modal, StatusBadge, cleanValues, confirmDelete, useToast } from './ui'

const COLUMNS = ['todo', 'in_progress', 'review', 'done']
const PRIORITIES = ['low', 'medium', 'high', 'urgent'].map((p) => ({ value: p, label: label(p) }))
const STATUSES = COLUMNS.map((s) => ({ value: s, label: label(s) }))

/** Kanban-style task list. Pass projectId to scope it to one project. */
export default function TaskBoard({ projectId }) {
  const { me, role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const canManage = can(role, 'tasks', 'create')
  const seesAll = role === 'admin' || role === 'hr'

  const [tasks, setTasks] = useState(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [assignee, setAssignee] = useState('')
  const [project, setProject] = useState('')
  const [edit, setEdit] = useState(null)
  const [saving, setSaving] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [params, setParams] = useSearchParams()
  // /tasks?task=<id> (e.g. from a "note added" notification) opens that task.
  useEffect(() => {
    const id = params.get('task')
    if (id) { setOpenId(id); setParams({}, { replace: true }) }
  }, [params]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    let q = db.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false })
    if (projectId) q = q.eq('project_id', projectId)
    const { data, error } = await q
    if (error) toast.error(error.message)
    setTasks(data ?? [])
  }, [projectId])
  useEffect(() => { load() }, [load])

  const shown = useMemo(
    () => (tasks ?? []).filter((t) =>
      (!mineOnly || t.assignee_id === me.id) && (!assignee || t.assignee_id === assignee) && (!project || t.project_id === project)),
    [tasks, mineOnly, assignee, project, me.id],
  )

  const setStatus = async (t, status) => {
    const { error } = await db.from('tasks').update({ status }).eq('id', t.id)
    if (error) return toast.error(error.message)
    setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, status } : x)))
  }

  const openNew = () => setEdit({ project_id: projectId ?? '', title: '', description: '', assignee_id: '', status: 'todo', priority: 'medium', due_date: '' })
  const openEdit = (t) => setEdit(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v ?? ''])))

  const fields = [
    { name: 'title', label: 'Title', required: true, full: true },
    { name: 'project_id', label: 'Project', type: 'select', required: true, disabled: !!projectId, options: (r) => r.projects.map((p) => ({ value: p.id, label: p.name })) },
    { name: 'assignee_id', label: 'Assignee', type: 'select', emptyLabel: '— Unassigned —', options: (r) => r.activeStaff.map((e) => ({ value: e.id, label: e.full_name })) },
    { name: 'status', label: 'Status', type: 'select', required: true, options: STATUSES },
    { name: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITIES },
    { name: 'due_date', label: 'Due date', type: 'date' },
    { name: 'description', label: 'Description', type: 'textarea' },
  ]

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = cleanValues(fields, edit)
    const res = edit.id
      ? await db.from('tasks').update(payload).eq('id', edit.id)
      : await db.from('tasks').insert({ ...payload, created_by: me.id })
    setSaving(false)
    if (res.error) return toast.error(res.error.message)
    toast.success(edit.id ? 'Task updated' : 'Task created')
    setEdit(null)
    load()
    refs.reload()
  }

  const remove = async (t) => {
    if (!confirmDelete('this task')) return
    const { error } = await db.from('tasks').delete().eq('id', t.id)
    if (error) return toast.error(error.message)
    load()
  }

  const today = todayIST()

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {seesAll && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-leaf-600" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Only mine
            </label>
            <select className="input w-auto" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">All assignees</option>
              {refs.activeStaff.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </>
        )}
        {!projectId && (
          <select className="input w-auto" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {refs.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {canManage && (
          <button className="btn btn-primary ml-auto" onClick={openNew}><Plus size={16} /> New task</button>
        )}
      </div>

      {tasks === null ? <Loading /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = shown.filter((t) => t.status === col)
            return (
              <div key={col} className="rounded-xl bg-gray-200/50 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <StatusBadge status={col} />
                  <span className="text-xs font-semibold text-gray-500">{items.length}</span>
                </div>
                <div className="space-y-3">
                  {items.length === 0 && <div className="rounded-lg border border-dashed border-gray-300 py-6 text-center text-xs text-gray-400">No tasks</div>}
                  {items.map((t) => {
                    const overdue = t.due_date && t.due_date < today && t.status !== 'done'
                    const canStatus = role === 'admin' || t.assignee_id === me.id
                    return (
                      <div key={t.id} className="card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <button className="text-left text-sm font-semibold leading-snug hover:text-leaf-700 hover:underline" onClick={() => setOpenId(t.id)}>{t.title}</button>
                          {canManage && (
                            <div className="flex shrink-0">
                              <button className="rounded p-1 text-gray-400 hover:text-ink" onClick={() => openEdit(t)} aria-label="Edit"><Pencil size={13} /></button>
                              <button className="rounded p-1 text-gray-400 hover:text-red-600" onClick={() => remove(t)} aria-label="Delete"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </div>
                        {!projectId && <div className="mt-1 text-xs text-leaf-700">{refs.projectName(t.project_id)}</div>}
                        {t.description && <p className="mt-1.5 line-clamp-2 text-xs text-gray-600">{t.description}</p>}
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={t.priority} />
                          {t.due_date && <Badge tone={overdue ? 'red' : 'gray'}>{overdue ? 'Overdue · ' : 'Due '}{fmtDate(t.due_date)}</Badge>}
                        </div>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-gray-500">{t.assignee_id ? refs.empName(t.assignee_id) : 'Unassigned'}</span>
                          <button className="rounded p-1 text-gray-400 hover:text-leaf-700" onClick={() => setOpenId(t.id)} title="Notes & activity" aria-label="Notes and activity"><MessageSquareText size={14} /></button>
                          {canStatus && (
                            <select className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs" value={t.status} onChange={(e) => setStatus(t, e.target.value)} aria-label="Change status">
                              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <TaskDetail
        task={(tasks ?? []).find((t) => t.id === openId) ?? null}
        onClose={() => setOpenId(null)}
        onChanged={(t) => setTasks((all) => all.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)))}
      />

      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? 'Edit task' : 'New task'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button form="task-form" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }
      >
        {edit && (
          <form id="task-form" onSubmit={save}>
            <FormGrid fields={fields} values={edit} setValues={setEdit} refs={refs} />
          </form>
        )}
      </Modal>
    </>
  )
}
