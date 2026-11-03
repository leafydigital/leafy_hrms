import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { monthLabel, inr } from '../lib/format'
import Payslip from '../components/Payslip'
import { Empty, Loading, PageHeader, StatusBadge, useToast } from '../components/ui'

const mask = (v) => (v ? `••••${String(v).slice(-4)}` : null)

export default function Payslips() {
  const { me } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    db
      .from('payroll')
      .select('*')
      .eq('employee_id', me.id)
      .in('status', ['published', 'paid'])
      .order('month', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast.error(error.message)
        setRows(data ?? [])
        setSelected(data?.[0]?.id ?? null)
      })
  }, [me.id])

  const row = rows?.find((r) => r.id === selected)
  const person = {
    name: me.full_name, code: me.emp_code, department: me.department?.name ?? '—',
    designation: me.designation?.name ?? '—', bank: mask(me.bank_account), pan: mask(me.pan),
  }

  return (
    <>
      <PageHeader title="My payslips" subtitle="View-only. Payslips appear here once payroll is published." />
      {rows === null ? <Loading /> : rows.length === 0 ? (
        <div className="card"><Empty>No payslips published yet.</Empty></div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <div className="card h-fit divide-y divide-gray-100 overflow-hidden">
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left transition ${selected === r.id ? 'bg-lime-100' : 'hover:bg-gray-50'}`}
              >
                <div>
                  <div className="text-sm font-semibold">{monthLabel(r.month)}</div>
                  <div className="text-xs text-gray-500">Net {inr(r.net_pay)}</div>
                </div>
                <StatusBadge status={r.status} />
              </button>
            ))}
          </div>
          {row && <Payslip key={row.id} row={row} person={person} protect />}
        </div>
      )}
    </>
  )
}
