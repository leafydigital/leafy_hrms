import { useAuth } from '../lib/useAuth'
import { can } from '../lib/permissions'
import { PageHeader } from '../components/ui'
import TaskBoard from '../components/TaskBoard'

export default function Tasks() {
  const { role } = useAuth()
  const sub = can(role, 'tasks', 'create')
    ? 'Create and assign tasks. Assignees update the status of their own tasks.'
    : role === 'hr'
      ? 'Read-only view of all tasks.'
      : 'Tasks assigned to you. Update the status as you progress.'
  return (
    <>
      <PageHeader title="Tasks" subtitle={sub} />
      <TaskBoard />
    </>
  )
}
