import CrudPage from '../components/CrudPage'
import { StatCard } from '../components/ui'
import { useAuth } from '../lib/useAuth'
import { can } from '../lib/permissions'
import { fmtDate, inr, todayIST } from '../lib/format'
import { IndianRupee, CalendarDays } from 'lucide-react'

const CATEGORIES = ['Client payment', 'Project milestone', 'Retainer / subscription', 'Other'].map((c) => ({ value: c, label: c }))
const MODES = ['Bank transfer', 'UPI', 'Cash', 'Cheque', 'Card'].map((c) => ({ value: c, label: c }))

export default function Income() {
  const { role } = useAuth()
  return (
    <CrudPage
      title="Income"
      subtitle="Money received. Marked by Admin, CEO, COO and CTO."
      table="incomes"
      select="*"
      order={[{ col: 'date', asc: false }, { col: 'created_at', asc: false }]}
      itemName="income entry"
      newLabel="Add income"
      searchKeys={['category', 'description', 'reference']}
      perms={{ create: can(role, 'income', 'create'), edit: can(role, 'income', 'edit'), remove: can(role, 'income', 'remove') }}
      defaults={{ date: todayIST(), category: 'Client payment' }}
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
        { label: 'Client', render: (r, refs) => (r.client_id ? refs.clientName(r.client_id) : '—') },
        { label: 'Project', render: (r, refs) => (r.project_id ? refs.projectName(r.project_id) : '—') },
        { label: 'Mode', render: (r) => r.payment_mode ?? '—' },
        { label: 'Amount', align: 'right', render: (r) => <span className="font-semibold text-leaf-700">{inr(r.amount)}</span> },
      ]}
      fields={[
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: 0 },
        { name: 'category', label: 'Category', type: 'select', required: true, options: CATEGORIES },
        { name: 'payment_mode', label: 'Payment mode', type: 'select', options: MODES },
        { name: 'client_id', label: 'Client', type: 'select', emptyLabel: '— None —', options: (refs) => refs.clients.map((c) => ({ value: c.id, label: c.name })) },
        { name: 'project_id', label: 'Project', type: 'select', emptyLabel: '— None —', options: (refs) => refs.projects.map((p) => ({ value: p.id, label: p.name })) },
        { name: 'reference', label: 'Reference / invoice no.' },
        { name: 'description', label: 'Description', type: 'textarea' },
      ]}
    />
  )
}
