import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, MessageSquareText, Send } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { fmtDate, initials, label, todayIST } from '../lib/format'
import { Badge, Loading, Modal, StatusBadge, useToast } from './ui'

// Odoo-style task view: details on top, then the activity log ("chatter") — who created it,
// every status change (old → new), re-assignments, and notes — newest first.
const STATUSES = ['todo', 'in_progress', 'review', 'done']
const when = (ts) => new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })

export default function TaskDetail({ task, onClose, onChanged }) {
  const { me, role } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const [items, setItems] = useState(null)
  const [status, setStatus] = useState(task?.status)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const canStatus = task && (role === 'admin' || task.assignee_id === me.id)

  const load = useCallback(async () => {
    if (!task) return
    const { data, error } = await db.from('task_activities').select('*').eq('task_id', task.id).order('id', { ascending: false })
    if (error) toast.error(error.message)
    setItems(data ?? [])
  }, [task?.id])
  useEffect(() => { setStatus(task?.status); setNote(''); setItems(null); load() }, [load])

  if (!task) return null
  const statusChanged = status !== task.status
  const overdue = task.due_date && task.due_date < todayIST() && task.status !== 'done'

  // One button: change the status and/or log a note (the status change is logged automatically).
  const submit = async (e) => {
    e?.preventDefault()
    const text = note.trim()
    if (!statusChanged && !text) return
    setBusy(true)
    if (statusChanged) {
      const { error } = await db.from('tasks').update({ status }).eq('id', task.id)
      if (error) { setBusy(false); return toast.error(error.message) }
    }
    if (text) {
      const { error } = await db.from('task_activities').insert({ task_id: task.id, author_id: me.id, kind: 'note', body: text })
      if (error) { setBusy(false); return toast.error(error.message) }
    }
    setBusy(false)
    setNote('')
    toast.success(statusChanged && text ? 'Status updated and note added' : statusChanged ? 'Status updated' : 'Note added')
    if (statusChanged) onChanged?.({ ...task, status })
    load()
  }

  return (
    <Modal open={!!task} onClose={onClose} size="lg" title={task.title}>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={task.status} />
        <StatusBadge status={task.priority} />
        {task.due_date && <Badge tone={overdue ? 'red' : 'gray'}>{overdue ? 'Overdue · ' : 'Due '}{fmtDate(task.due_date)}</Badge>}
        <span className="text-gray-500">· {refs.projectName(task.project_id)}</span>
        <span className="text-gray-500">· {task.assignee_id ? refs.empName(task.assignee_id) : 'Unassigned'}</span>
      </div>
      {task.description && <p className="mb-4 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{task.description}</p>}

      <form onSubmit={submit} className="mb-5 rounded-xl border border-gray-200 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {canStatus ? (
            <label className="flex items-center gap-2 text-sm font-semibold">
              Status
              <select className="input w-auto py-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </select>
            </label>
          ) : <span className="text-xs text-gray-500">Only the assignee or Admin can change the status. You can still add notes.</span>}
          {statusChanged && <span className="flex items-center gap-1 text-xs text-gray-600"><StatusBadge status={task.status} /><ArrowRight size={12} /><StatusBadge status={status} /></span>}
        </div>
        <textarea className="input" rows={3} maxLength={4000} placeholder="Log a note — what you did, what's blocking, links…" value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }} />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-gray-400">Ctrl + Enter to save</span>
          <button className="btn btn-primary btn-sm" disabled={busy || (!statusChanged && !note.trim())}>
            <Send size={14} /> {statusChanged && note.trim() ? 'Update status & log note' : statusChanged ? 'Update status' : 'Log note'}
          </button>
        </div>
      </form>

      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold"><MessageSquareText size={15} /> Activity</h3>
      {items === null ? <Loading /> : items.length === 0 ? <p className="text-sm text-gray-500">No activity yet.</p> : (
        <ol className="relative space-y-4 border-l border-gray-200 pl-5">
          {items.map((a) => {
            const who = a.author_id ? refs.empName(a.author_id) : 'Someone'
            return (
              <li key={a.id} className="relative">
                <span className="absolute -left-[33px] flex h-6 w-6 items-center justify-center rounded-full bg-lime-200 text-[10px] font-bold text-leaf-900">{initials(who)}</span>
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <b>{who}</b>
                  <span className="text-[11px] text-gray-400">{when(a.created_at)}</span>
                </div>
                {a.kind === 'note' && <div className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-sm">{a.body}</div>}
                {a.kind === 'status' && <div className="mt-1 flex items-center gap-1.5 text-sm text-gray-600">Status <StatusBadge status={a.old_status} /><ArrowRight size={12} /><StatusBadge status={a.new_status} /></div>}
                {a.kind === 'created' && <div className="mt-1 text-sm text-gray-600">Created the task{a.body ? ` · ${a.body}` : ''}</div>}
                {a.kind === 'assigned' && <div className="mt-1 text-sm text-gray-600">{a.body}</div>}
              </li>
            )
          })}
        </ol>
      )}
    </Modal>
  )
}
