import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { db } from '../lib/db'
import { useAuth } from '../lib/useAuth'
import { useRefs } from '../lib/refs'
import { getPath } from '../lib/format'
import { Empty, FormGrid, Loading, Modal, PageHeader, cleanValues, confirmDelete, useToast } from './ui'

/**
 * Generic list + add/edit modal for a single table.
 * Permissions come from the caller (perms.create / edit / remove) and are enforced again by RLS.
 */
export default function CrudPage({
  title, subtitle, table, select = '*', order = [{ col: 'created_at', asc: false }],
  columns, fields, perms = {}, newLabel = 'Add', searchKeys = [], defaults = {},
  beforeSave, summary, filter, headerExtra, itemName = 'record', onChanged,
}) {
  const { me } = useAuth()
  const refs = useRefs()
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [fv, setFv] = useState('')
  const [editing, setEditing] = useState(null) // null | {} (new) | row
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    let query = db.from(table).select(select)
    for (const o of order) query = query.order(o.col, { ascending: o.asc })
    const { data, error } = await query
    if (error) toast.error(error.message)
    setRows(data ?? [])
  }, [table, select])

  useEffect(() => {
    load()
  }, [load])

  const shown = useMemo(() => {
    let r = rows ?? []
    if (filter && fv) r = r.filter((x) => String(getPath(x, filter.key)) === fv)
    if (q.trim()) {
      const needle = q.toLowerCase()
      r = r.filter((x) => searchKeys.some((k) => String(getPath(x, k) ?? '').toLowerCase().includes(needle)))
    }
    return r
  }, [rows, q, fv, filter, searchKeys])

  const openNew = () => {
    setValues({ ...defaults })
    setEditing({})
  }
  const openEdit = (row) => {
    setValues(Object.fromEntries(fields.map((f) => [f.name, row[f.name] ?? ''])))
    setEditing(row)
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    let payload = cleanValues(fields, values)
    if (beforeSave) payload = beforeSave(payload, { me, editing: editing?.id ? editing : null })
    const res = editing?.id
      ? await db.from(table).update(payload).eq('id', editing.id)
      : await db.from(table).insert(payload)
    setSaving(false)
    if (res.error) return toast.error(res.error.message)
    toast.success(editing?.id ? 'Changes saved' : `${newLabel.replace(/^Add /, '')} added`)
    setEditing(null)
    await load()
    onChanged?.()
  }

  const remove = async (row) => {
    if (!confirmDelete(`this ${itemName}`)) return
    const { error } = await db.from(table).delete().eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success('Deleted')
    await load()
    onChanged?.()
  }

  const showActions = perms.edit || perms.remove

  return (
    <>
      <PageHeader title={title} subtitle={subtitle}>
        {headerExtra}
        {perms.create && (
          <button className="btn btn-primary" onClick={openNew}>
            <Plus size={16} /> {newLabel}
          </button>
        )}
      </PageHeader>

      {summary && rows && <div className="mb-4">{summary(shown, rows)}</div>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 p-3">
          {searchKeys.length > 0 && (
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="input pl-9" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          {filter && (
            <select className="input w-auto" value={fv} onChange={(e) => setFv(e.target.value)}>
              <option value="">{filter.label}</option>
              {(typeof filter.options === 'function' ? filter.options(rows ?? [], refs) : filter.options).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          <span className="ml-auto text-xs text-gray-500">{shown.length} {shown.length === 1 ? 'record' : 'records'}</span>
        </div>

        {rows === null ? (
          <Loading />
        ) : shown.length === 0 ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {columns.map((c) => (
                    <th key={c.label} className={`th ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>
                  ))}
                  {showActions && <th className="th w-24" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/70">
                    {columns.map((c) => (
                      <td key={c.label} className={`td ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                        {c.render ? c.render(row, refs) : String(getPath(row, c.key) ?? '—')}
                      </td>
                    ))}
                    {showActions && (
                      <td className="td">
                        <div className="flex justify-end gap-1">
                          {perms.edit && (
                            <button className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-ink" onClick={() => openEdit(row)} aria-label="Edit">
                              <Pencil size={15} />
                            </button>
                          )}
                          {perms.remove && (
                            <button className="rounded-md p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600" onClick={() => remove(row)} aria-label="Delete">
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${itemName}` : newLabel}
        size={fields.length > 6 ? 'lg' : 'md'}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button form="crud-form" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        }
      >
        <form id="crud-form" onSubmit={save}>
          <FormGrid fields={fields} values={values} setValues={setValues} refs={refs} />
        </form>
      </Modal>
    </>
  )
}
