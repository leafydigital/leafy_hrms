import CrudPage from '../components/CrudPage'
import { StatusBadge } from '../components/ui'
import { useAuth } from '../lib/useAuth'
import { can } from '../lib/permissions'
import { useRefs } from '../lib/refs'

export default function Designations() {
  const { role } = useAuth()
  const { directory, reload } = useRefs()
  return (
    <CrudPage
      title="Designations"
      subtitle="Job titles per department. The default access role is suggested when you add an employee."
      table="designations"
      order={[{ col: 'sort_order', asc: true }, { col: 'name', asc: true }]}
      itemName="designation"
      newLabel="Add designation"
      searchKeys={['name']}
      perms={{ create: can(role, 'designations', 'create'), edit: can(role, 'designations', 'edit'), remove: can(role, 'designations', 'remove') }}
      onChanged={reload}
      defaults={{ default_role: 'employee', sort_order: 0 }}
      filter={{
        key: 'department_id',
        label: 'All departments',
        options: (_rows, refs) => refs.departments.map((d) => ({ value: d.id, label: d.name })),
      }}
      columns={[
        { label: 'Designation', render: (r) => <span className="font-semibold">{r.name}</span> },
        { label: 'Department', render: (r, refs) => refs.deptName(r.department_id) },
        { label: 'Default access', render: (r) => <StatusBadge status={r.default_role} /> },
        { label: 'Staff', align: 'right', render: (r) => directory.filter((e) => e.designation_id === r.id && e.status === 'active').length },
      ]}
      fields={[
        { name: 'department_id', label: 'Department', type: 'select', required: true, options: (refs) => refs.departments.map((d) => ({ value: d.id, label: d.name })) },
        { name: 'name', label: 'Designation', required: true },
        {
          name: 'default_role', label: 'Default access role', type: 'select', required: true,
          options: [
            { value: 'employee', label: 'Employee' },
            { value: 'hr', label: 'HR' },
            { value: 'accounts', label: 'Accounts' },
            { value: 'admin', label: 'Admin' },
            { value: 'ceo', label: 'CEO' },
            { value: 'cto', label: 'CTO' },
            { value: 'coo', label: 'COO' },
          ],
        },
        { name: 'sort_order', label: 'Sort order', type: 'number', step: 1 },
      ]}
    />
  )
}
