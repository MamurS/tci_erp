/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, tci } from '../lib/supabase'
import { isUserRole } from '../lib/roles'
import type { UserRole } from '../lib/roles'

interface AuthContextValue {
  session: Session | null
  /** All roles held by the user (tci.user_roles has one row per role);
   * empty when not signed in or none assigned yet. */
  roles: UserRole[]
  /** True while the initial session and roles are being resolved. */
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchRoles(userId: string): Promise<UserRole[]> {
  const { data, error } = await tci().from('user_roles').select('role').eq('user_id', userId)
  if (error) {
    console.error('Failed to load user roles', error)
    return []
  }
  return ((data ?? []) as { role: unknown }[])
    .map((r) => r.role)
    .filter(isUserRole)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [roles, setRoles] = useState<UserRole[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return
      setSession(newSession)
      if (!newSession) {
        setRoles([])
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const userId = session?.user.id
    if (!userId) return

    setLoading(true)
    fetchRoles(userId).then((r) => {
      if (cancelled) return
      setRoles(r)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [session?.user.id])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? error.message : null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = useMemo(
    () => ({ session, roles, loading, signIn, signOut }),
    [session, roles, loading, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
