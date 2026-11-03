import { Check, Minus } from 'lucide-react'
import { PERMS, ROLES } from '../lib/permissions'
import { useRefs } from '../lib/refs'
import { Badge, PageHeader } from '../components/ui'
import { useEffect, useState } from 'react'
import { db } from '../lib/db'

const MODULE_LABEL = {
  dashboard: 'Dashboard', employees: 'Employees', departments: 'Departments', designations: 'Designations',
  roles: 'Roles', leaves: 'Leave', attendance: 'Attendance', salary: 'Salary details', payroll: 'Payroll',
  payslips: 'Own payslips (view only)', income: 'Income', expenses: 'Expenses', clients: 'Clients',
  projects: 'Projects', tasks: 'Tasks',
}
const ACTION_LABEL = {
  view: 'View', create: 'Add', edit: 'Edit', remove: 'Delete', review: 'Approve / reject',
  manage: 'Manage', status: 'Update own status',
}

export default function Roles() {
  const { designations } = useRefs()
  const [counts, setCounts] = useState({})

  useEffect(() => {
    db.from('employees').select('role').eq('status', 'active').then(({ data }) => {
      const c = {}
      for (const r of data ?? []) c[r.role] = (c[r.role] ?? 0) + 1
      setCounts(c)
    })
  }, [])

  const order = ['admin', 'ceo', 'cto', 'coo', 'hr', 'accounts', 'employee']

  return (
    <>
      <PageHeader title="Roles" subtitle="Access roles control what each person sees and can change. Assign a role on the employee's record." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {order.map((r) => (
          <div key={r} className="card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">{ROLES[r].label}</h3>
              <Badge tone="dark">{counts[r] ?? 0} active</Badge>
            </div>
            <p className="mt-2 text-sm text-gray-600">{ROLES[r].desc}</p>
            <p className="mt-3 text-xs text-gray-500">
              Default for:{' '}
              {designations.filter((d) => d.default_role === r).map((d) => d.name).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—'}
            </p>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="th">Module</th>
              {order.map((r) => <th key={r} className="th">{ROLES[r].label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {Object.entries(PERMS).map(([mod, actions]) => (
              <tr key={mod}>
                <td className="td font-semibold">{MODULE_LABEL[mod]}</td>
                {order.map((r) => {
                  const allowed = Object.entries(actions).filter(([, roles]) => roles.includes(r)).map(([a]) => ACTION_LABEL[a])
                  return (
                    <td key={r} className="td align-top text-xs">
                      {allowed.length ? (
                        <div className="flex items-start gap-1.5 text-leaf-800">
                          <Check size={14} className="mt-0.5 shrink-0" /> {allowed.join(' · ')}
                        </div>
                      ) : (
                        <Minus size={14} className="text-gray-300" />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">Permissions are enforced in the database (row-level security), not just hidden in the UI.</p>
    </>
  )
}
