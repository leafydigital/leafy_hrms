import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { db } from './db'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [me, setMe] = useState(null)
  const [booting, setBooting] = useState(true)
  const [loadingMe, setLoadingMe] = useState(false)

  useEffect(() => {
    db.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setBooting(false)
    })
    const { data: sub } = db.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadMe = useCallback(async (s) => {
    if (!s) return setMe(null)
    setLoadingMe(true)
    const { data } = await db
      .from('employees')
      .select('*, department:departments(name), designation:designations(name)')
      .eq('user_id', s.user.id)
      .maybeSingle()
    setMe(data && data.status === 'active' ? data : null)
    setLoadingMe(false)
  }, [])

  useEffect(() => {
    loadMe(session)
  }, [session?.user?.id, loadMe])

  const value = useMemo(
    () => ({
      session,
      me,
      role: me?.role,
      loading: booting || loadingMe,
      signIn: (email, password) => db.auth.signInWithPassword({ email, password }),
      signOut: () => db.auth.signOut(),
    }),
    [session, me, booting, loadingMe],
  )
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
