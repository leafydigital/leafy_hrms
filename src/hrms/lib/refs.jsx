import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { db } from './db'
import { useAuth } from './useAuth'

// Shared lookup data (departments, designations, leave types, clients, projects, name directory).
// Row-level security decides what each role actually receives.
const RefsCtx = createContext(null)
export const useRefs = () => useContext(RefsCtx)

export function RefsProvider({ children }) {
  const { me } = useAuth()
  const [state, setState] = useState({
    departments: [], designations: [], leaveTypes: [], directory: [], clients: [], projects: [],
  })

  const reload = useCallback(async () => {
    const [d, g, l, e, c, p] = await Promise.all([
      db.from('departments').select('*').order('name'),
      db.from('designations').select('*').order('sort_order'),
      db.from('leave_types').select('*').order('name'),
      db.from('employee_directory').select('*').order('full_name'),
      db.from('clients').select('id,name,company').order('name'),
      db.from('projects').select('id,name,status').order('name'),
    ])
    setState({
      departments: d.data ?? [],
      designations: g.data ?? [],
      leaveTypes: l.data ?? [],
      directory: e.data ?? [],
      clients: c.data ?? [],
      projects: p.data ?? [],
    })
  }, [])

  useEffect(() => {
    if (me) reload()
  }, [me?.id, reload])

  const value = useMemo(() => {
    const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]))
    const dir = byId(state.directory), dep = byId(state.departments), des = byId(state.designations),
      lt = byId(state.leaveTypes), cl = byId(state.clients), pr = byId(state.projects)
    return {
      ...state,
      reload,
      activeStaff: state.directory.filter((e) => e.status === 'active'),
      empName: (id) => dir[id]?.full_name ?? '—',
      empCode: (id) => dir[id]?.emp_code ?? '',
      emp: (id) => dir[id],
      deptName: (id) => dep[id]?.name ?? '—',
      desigName: (id) => des[id]?.name ?? '—',
      leaveType: (id) => lt[id],
      clientName: (id) => cl[id]?.name ?? '—',
      projectName: (id) => pr[id]?.name ?? '—',
    }
  }, [state, reload])

  return <RefsCtx.Provider value={value}>{children}</RefsCtx.Provider>
}
