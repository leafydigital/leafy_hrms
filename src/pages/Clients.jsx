import CrudPage from '../components/CrudPage'
import { StatusBadge } from '../components/ui'
import { useAuth } from '../lib/useAuth'
import { can } from '../lib/permissions'
import { useRefs } from '../lib/refs'

export default function Clients() {
  const { role } = useAuth()
  const { reload } = useRefs()
  return (
    <CrudPage
      title="Clients"
      subtitle={can(role, 'clients', 'edit') ? 'Companies and people Leafy Digital works with.' : 'Read-only view.'}
      table="clients"
      order={[{ col: 'name', asc: true }]}
      itemName="client"
      newLabel="Add client"
      searchKeys={['name', 'company', 'email', 'phone']}
      perms={{ create: can(role, 'clients', 'create'), edit: can(role, 'clients', 'edit'), remove: can(role, 'clients', 'remove') }}
      onChanged={reload}
      defaults={{ status: 'active' }}
      filter={{ key: 'status', label: 'All statuses', options: ['active', 'prospect', 'inactive'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) }}
      columns={[
        { label: 'Client', render: (r) => <div><div className="font-semibold">{r.name}</div><div className="text-xs text-gray-500">{r.company}</div></div> },
        { label: 'Contact', render: (r) => <div><div>{r.email ?? '—'}</div><div className="text-xs text-gray-500">{r.phone}</div></div> },
        { label: 'GSTIN', key: 'gstin' },
        { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      fields={[
        { name: 'name', label: 'Contact name', required: true },
        { name: 'company', label: 'Company' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'gstin', label: 'GSTIN' },
        { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'active', label: 'Active' }, { value: 'prospect', label: 'Prospect' }, { value: 'inactive', label: 'Inactive' }] },
        { name: 'address', label: 'Address', type: 'textarea' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
    />
  )
}
