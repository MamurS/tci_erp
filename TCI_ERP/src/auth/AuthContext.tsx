/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, tci } from '../lib/supabase'
import { isUserRole } from '../lib/roles'
import type { UserRole } from '../lib/roles'
import { classifySignInError } from './signInErrors'
import { attemptsLeft, lockSeconds, parseLoginBegin } from './loginGate'
import type { SignInFailure } from './signInErrors'
import { parseAuthStatus } from './mfaGate'
import type { AuthStatus } from './mfaGate'
import { ACTING_ROLE_KEY, chooseActingRole } from './actingRole'
import { WORKSPACE_KEY } from '../components/layout/workspaces'

interface AuthContextValue {
  session: Session | null
  /** The role the user ACTS in now, as a one-element list (empty when not
   * signed in or none assigned yet). Every permission check in the screens
   * reads this: since 0063 the database answers for the acting role only, so
   * a person with several roles is, in each workspace, exactly a single-role
   * user of that workspace's role. */
  roles: UserRole[]
  /** Every role the user holds (tci.user_roles has one row per role): what
   * the workspace switcher offers. Never a permission. */
  heldRoles: UserRole[]
  /** The acting role itself (null: none). */
  actingRole: UserRole | null
  /** Act in another held role: the screen switches at once, the server is
   * told (tci.set_acting_role), and every query is refetched for the new
   * role. Reverts and rethrows when the server refuses. */
  switchActingRole: (role: UserRole) => Promise<void>
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

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // storage may be unavailable; the server still holds the acting role
  }
}

/** The acting role the server holds for this session, or null. */
async function fetchActingRole(): Promise<unknown> {
  const { data, error } = await tci().rpc('acting_role')
  if (error) {
    console.error('Failed to load the acting role', error)
    return null
  }
  return data
}

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
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [heldRoles, setHeldRoles] = useState<UserRole[]>([])
  const [actingRole, setActingRole] = useState<UserRole | null>(null)
  const actingRef = useRef<UserRole | null>(null)
  actingRef.current = actingRole
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
        setHeldRoles([])
        setActingRole(null)
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
    Promise.all([fetchRoles(userId), fetchMustChangePassword(userId), fetchAuthStatus(), fetchActingRole()]).then(
      async ([nextRoles, mustChange, status, serverRole]) => {
        // The acting role is settled BEFORE the screens load: with several
        // roles and none chosen, every gate is closed (0063).
        const choice = chooseActingRole(nextRoles, serverRole, readStorage(WORKSPACE_KEY))
        let acting = choice.role
        if (choice.mustSet && acting) {
          const { error } = await tci().rpc('set_acting_role', { p_role: acting })
          if (error) {
            console.error('Failed to set the acting role', error)
            acting = null
          }
        }
        if (cancelled) return
        setHeldRoles(nextRoles)
        setActingRole(acting)
        setMustChangePassword(mustChange)
        setAuthStatus(status)
        setLoading(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [userId, accessToken])

  const switchActingRole = useCallback(
    async (role: UserRole) => {
      const previous = actingRef.current
      if (role === previous) return
      setActingRole(role)
      const { error } = await tci().rpc('set_acting_role', { p_role: role })
      if (error) {
        setActingRole(previous)
        throw error
      }
      writeStorage(ACTING_ROLE_KEY, role)
      // Nothing fetched for the previous role may stay on screen.
      await queryClient.resetQueries()
    },
    [queryClient],
  )

  // Other tabs of this browser share the session and its acting role: follow
  // a switch made in one of them.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== ACTING_ROLE_KEY || !event.newValue) return
      const next = heldRoles.find((r) => r === event.newValue)
      if (next && next !== actingRef.current) {
        setActingRole(next)
        void queryClient.resetQueries()
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [heldRoles, queryClient])

  const signIn = useCallback(async (email: string, password: string, captchaToken?: string) => {
    // Every sign-in starts at the gate (migration 0046): it refuses while this
    // email + network is in a wait, and otherwise records an attempt that
    // counts as a failure until the access-token hook refunds it on success.
    const begin = await tci().rpc('login_begin', { p_email: email })
    // Only a backend that predates 0046 lacks the function; then GoTrue's own
    // throttle is all there is, as before.
    const gateMissing = begin.error?.code === 'PGRST202'
    if (begin.error && !gateMissing) {
      return { error: { kind: 'generic' as const } }
    }
    const gate = gateMissing
      ? { allowed: true, failures: 0, retryAfterSeconds: null }
      : parseLoginBegin(begin.data)
    if (!gate.allowed) {
      return { error: { kind: 'throttled' as const, seconds: gate.retryAfterSeconds ?? 30 } }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: captchaToken ? { captchaToken } : undefined,
    })
    if (!error) return { error: null }
    const status = 'status' in error ? (error as { status?: number }).status : undefined
    const failure = classifySignInError({ code: error.code, status, message: error.message })
    if (failure.kind === 'invalidCredentials' && !gateMissing) {
      const left = attemptsLeft(gate.failures)
      const wait = lockSeconds(gate.failures + 1)
      return { error: { ...failure, attemptsLeft: left, seconds: wait > 0 ? wait : undefined } }
    }
    return { error: failure }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const clearPasswordChangeFlag = useCallback(() => setMustChangePassword(false), [])

  const refreshAuthStatus = useCallback(async () => {
    setAuthStatus(await fetchAuthStatus())
  }, [])

  const roles = useMemo(() => (actingRole ? [actingRole] : []), [actingRole])
  const value = useMemo(
    () => ({
      session,
      roles,
      heldRoles,
      actingRole,
      switchActingRole,
      loading,
      mustChangePassword,
      authStatus,
      signIn,
      signOut,
      clearPasswordChangeFlag,
      refreshAuthStatus,
    }),
    [
      session,
      roles,
      heldRoles,
      actingRole,
      switchActingRole,
      loading,
      mustChangePassword,
      authStatus,
      signIn,
      signOut,
      clearPasswordChangeFlag,
      refreshAuthStatus,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
