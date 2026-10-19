/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, tci } from '../lib/supabase'
import { isUserRole } from '../lib/roles'
import type { UserRole } from '../lib/roles'
import { classifySignInError } from './signInErrors'
import type { SignInFailure } from './signInErrors'
import { parseAuthStatus } from './mfaGate'
import type { AuthStatus } from './mfaGate'

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
  /** tci.my_auth_status(): assurance level, MFA enrolment and policy,
   * lockout. Null until loaded. See RequireMfa. */
  authStatus: AuthStatus | null
  /** Sign in with a password and, when CAPTCHA is configured, a Turnstile
   * token. The error is already classified for display. */
  signIn: (email: string, password: string, captchaToken?: string) => Promise<{ error: SignInFailure | null }>
  signOut: () => Promise<void>
  /** Called by the change-password page once the rotation succeeded. */
  clearPasswordChangeFlag: () => void
  /** Re-reads tci.my_auth_status() - after an MFA verification or enrolment. */
  refreshAuthStatus: () => Promise<void>
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

/** tci.my_auth_status() reads only the caller's own state and is NOT gated
 * on has_role(), so it answers even while the gates are closed - which is
 * exactly when the answer matters. A failure is treated as "unknown", never
 * as "satisfied". */
async function fetchAuthStatus(): Promise<AuthStatus | null> {
  const { data, error } = await tci().rpc('my_auth_status')
  if (error) {
    console.error('Failed to load auth status', error)
    return null
  }
  return parseAuthStatus(data)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [roles, setRoles] = useState<UserRole[]>([])
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
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
        setAuthStatus(null)
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  // The assurance level lives in the access token: a step-up issues a new
  // one, so the status is re-read whenever the token changes, not only
  // when the user changes.
  const userId = session?.user.id
  const accessToken = session?.access_token
  useEffect(() => {
    let cancelled = false
    if (!userId) return

    setLoading(true)
    Promise.all([fetchRoles(userId), fetchMustChangePassword(userId), fetchAuthStatus()]).then(
      ([nextRoles, mustChange, status]) => {
        if (cancelled) return
        setRoles(nextRoles)
        setMustChangePassword(mustChange)
        setAuthStatus(status)
        setLoading(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [userId, accessToken])

  const signIn = useCallback(async (email: string, password: string, captchaToken?: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    })
    if (!error) return { error: null }
    const status = 'status' in error ? (error as { status?: number }).status : undefined
    return { error: classifySignInError({ code: error.code, status, message: error.message }) }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const clearPasswordChangeFlag = useCallback(() => setMustChangePassword(false), [])

  const refreshAuthStatus = useCallback(async () => {
    setAuthStatus(await fetchAuthStatus())
  }, [])

  const value = useMemo(
    () => ({
      session,
      roles,
      loading,
      mustChangePassword,
      authStatus,
      signIn,
      signOut,
      clearPasswordChangeFlag,
      refreshAuthStatus,
    }),
    [session, roles, loading, mustChangePassword, authStatus, signIn, signOut, clearPasswordChangeFlag, refreshAuthStatus],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
