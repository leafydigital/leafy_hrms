import { Link } from 'react-router-dom'
import CrudPage from '../components/CrudPage'
import { StatusBadge } from '../components/ui'
import { useAuth } from '../lib/useAuth'
import { can } from '../lib/permissions'
import { useRefs } from '../lib/refs'
import { fmtDate, label } from '../lib/format'

const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'].map((s) => ({ value: s, label: label(s) }))
const PRIORITIES = ['low', 'medium', 'high', 'urgent'].map((s) => ({ value: s, label: label(s) }))

export default function Projects() {
  const { role } = useAuth()
  const { reload } = useRefs()
  const seesAll = role === 'admin' || role === 'hr'
  return (
    <CrudPage
      title="Projects"
      subtitle={can(role, 'projects', 'create') ? 'All client and internal projects.' : seesAll ? 'Read-only view of all projects.' : 'Projects you are assigned to.'}
      table="projects"
      select="*, tasks(status), project_members(employee_id)"
      order={[{ col: 'created_at', asc: false }]}
      itemName="project"
      newLabel="Add project"
      searchKeys={['name', 'description']}
      perms={{ create: can(role, 'projects', 'create'), edit: can(role, 'projects', 'edit'), remove: can(role, 'projects', 'remove') }}
      onChanged={reload}
      defaults={{ status: 'planning', priority: 'medium' }}
      filter={{ key: 'status', label: 'All statuses', options: STATUSES }}
      columns={[
        { label: 'Project', render: (r, refs) => (
          <Link to={`/projects/${r.id}`} className="block">
            <div className="font-semibold text-leaf-700 hover:underline">{r.name}</div>
            {seesAll && r.client_id && <div className="text-xs text-gray-500">{refs.clientName(r.client_id)}</div>}
          </Link>
        ) },
        { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { label: 'Priority', render: (r) => <StatusBadge status={r.priority} /> },
        { label: 'Manager', render: (r, refs) => (r.manager_id ? refs.empName(r.manager_id) : '—') },
        { label: 'Team', align: 'right', render: (r) => r.project_members.length },
        { label: seesAll ? 'Tasks done' : 'My tasks done', align: 'right', render: (r) => {
          const done = r.tasks.filter((t) => t.status === 'done').length
          return r.tasks.length ? `${done} / ${r.tasks.length}` : '—'
        } },
        { label: 'Timeline', render: (r) => (r.start_date || r.end_date ? `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}` : '—') },
      ]}
      fields={[
        { name: 'name', label: 'Project name', required: true, full: true },
        { name: 'client_id', label: 'Client', type: 'select', emptyLabel: '— Internal —', options: (refs) => refs.clients.map((c) => ({ value: c.id, label: c.name + (c.company ? ` (${c.company})` : '') })) },
        { name: 'manager_id', label: 'Project manager', type: 'select', emptyLabel: '— None —', options: (refs) => refs.activeStaff.map((e) => ({ value: e.id, label: e.full_name })) },
        { name: 'status', label: 'Status', type: 'select', required: true, options: STATUSES },
        { name: 'priority', label: 'Priority', type: 'select', required: true, options: PRIORITIES },
        { name: 'start_date', label: 'Start date', type: 'date' },
        { name: 'end_date', label: 'End date', type: 'date' },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  )
}
