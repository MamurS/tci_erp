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
  /** True while the initial session, roles and profile are being resolved. */
  loading: boolean
  /** The user still holds the temporary password issued at provisioning
   * (tci.user_profiles.must_change_password). Gates every route until they
   * rotate it - see RequirePasswordChange. */
  mustChangePassword: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  /** Called by the change-password page once the rotation succeeded. */
  clearPasswordChangeFlag: () => void
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

/** The rotation flag. A user provisioned before migration 0022 has no row;
 * absence means "nothing to rotate", never "locked out". */
async function fetchMustChangePassword(userId: string): Promise<boolean> {
  const { data, error } = await tci()
    .from('user_profiles')
    .select('must_change_password')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('Failed to load user profile', error)
    return false
  }
  return (data as { must_change_password?: boolean } | null)?.must_change_password === true
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [roles, setRoles] = useState<UserRole[]>([])
  const [mustChangePassword, setMustChangePassword] = useState(false)
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
        setMustChangePassword(false)
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
    Promise.all([fetchRoles(userId), fetchMustChangePassword(userId)]).then(
      ([nextRoles, mustChange]) => {
        if (cancelled) return
        setRoles(nextRoles)
        setMustChangePassword(mustChange)
        setLoading(false)
      },
    )

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

  const clearPasswordChangeFlag = useCallback(() => setMustChangePassword(false), [])

  const value = useMemo(
    () => ({
      session,
      roles,
      loading,
      mustChangePassword,
      signIn,
      signOut,
      clearPasswordChangeFlag,
    }),
    [session, roles, loading, mustChangePassword, signIn, signOut, clearPasswordChangeFlag],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
