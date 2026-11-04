import CrudPage from '../components/CrudPage'
import { StatCard } from '../components/ui'
import { useAuth } from '../lib/useAuth'
import { can } from '../lib/permissions'
import { fmtDate, inr, todayIST } from '../lib/format'
import { IndianRupee, CalendarDays } from 'lucide-react'

const CATEGORIES = ['Salaries', 'Rent', 'Software & tools', 'Marketing', 'Travel', 'Utilities', 'Office supplies', 'Training', 'General'].map((c) => ({ value: c, label: c }))
const MODES = ['Bank transfer', 'UPI', 'Cash', 'Cheque', 'Card'].map((c) => ({ value: c, label: c }))

export default function Expenses() {
  const { role } = useAuth()
  return (
    <CrudPage
      title="Expenses"
      subtitle="Money spent. Marked by Admin, CEO, COO and CTO; HR can also add and update expenses."
      table="expenses"
      order={[{ col: 'date', asc: false }, { col: 'created_at', asc: false }]}
      itemName="expense"
      newLabel="Add expense"
      searchKeys={['category', 'description', 'reference']}
      perms={{ create: can(role, 'expenses', 'create'), edit: can(role, 'expenses', 'edit'), remove: can(role, 'expenses', 'remove') }}
      defaults={{ date: todayIST(), category: 'General' }}
      beforeSave={(p, { me, editing }) => (editing ? p : { ...p, created_by: me.id })}
      filter={{ key: 'category', label: 'All categories', options: CATEGORIES }}
      summary={(shown) => {
        const month = todayIST().slice(0, 7)
        const total = shown.reduce((s, r) => s + Number(r.amount), 0)
        const thisMonth = shown.filter((r) => r.date.startsWith(month)).reduce((s, r) => s + Number(r.amount), 0)
        return (
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label="Total (filtered)" value={inr(total)} icon={IndianRupee} />
            <StatCard label="This month" value={inr(thisMonth)} icon={CalendarDays} />
          </div>
        )
      }}
      columns={[
        { label: 'Date', render: (r) => fmtDate(r.date) },
        { label: 'Category', key: 'category' },
        { label: 'Description', render: (r) => r.description ?? '—' },
        { label: 'Project', render: (r, refs) => (r.project_id ? refs.projectName(r.project_id) : '—') },
        { label: 'Mode', render: (r) => r.payment_mode ?? '—' },
        { label: 'Amount', align: 'right', render: (r) => <span className="font-semibold text-red-600">{inr(r.amount)}</span> },
      ]}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0 },
        { name: 'category', label: 'Category', type: 'select', required: true, options: CATEGORIES },
        { name: 'payment_mode', label: 'Payment mode', type: 'select', options: MODES },
        { name: 'project_id', label: 'Project', type: 'select', emptyLabel: '— None —', options: (refs) => refs.projects.map((p) => ({ value: p.id, label: p.name })) },
        { name: 'reference', label: 'Reference / bill no.' },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  )
}
