import CrudPage from '../components/CrudPage'
import { useAuth } from '../lib/useAuth'
import { can } from '../lib/permissions'
import { useRefs } from '../lib/refs'

export default function Departments() {
  const { role } = useAuth()
  const { directory, designations, reload } = useRefs()
  return (
    <CrudPage
      title="Departments"
      subtitle="Teams that make up Leafy Digital."
      table="departments"
      order={[{ col: 'name', asc: true }]}
      itemName="department"
      newLabel="Add department"
      searchKeys={['name']}
      perms={{ create: can(role, 'departments', 'create'), edit: can(role, 'departments', 'edit'), remove: can(role, 'departments', 'remove') }}
      onChanged={reload}
      columns={[
        { label: 'Department', render: (r) => <span className="font-semibold">{r.name}</span> },
        { label: 'Description', key: 'description' },
        { label: 'Designations', align: 'right', render: (r) => designations.filter((d) => d.department_id === r.id).length },
        { label: 'Active staff', align: 'right', render: (r) => directory.filter((e) => e.department_id === r.id && e.status === 'active').length },
      ]}
      fields={[
        { name: 'name', label: 'Name', required: true, full: true },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  )
}
