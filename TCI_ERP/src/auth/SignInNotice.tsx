/**
 * "Was this you?" — shown once after signing in when someone tried and failed
 * to sign in to this account since the previous sign-in
 * (tci.my_sign_in_notice, migration 0046). The project sends no e-mail, so
 * this is where the owner of an account learns about guessing against it.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, X } from 'lucide-react'

import { tci } from '../lib/supabase'
import { useAuth } from './AuthContext'

const SEEN_KEY = 'tci-erp-sign-in-notice'

function sessionId(token: string | undefined): string {
  try {
    const payload = JSON.parse(atob((token ?? '').split('.')[1] ?? '')) as { session_id?: string }
    return payload.session_id ?? ''
  } catch {
    return ''
  }
}

function seen(id: string): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === id
  } catch {
    return false
  }
}

export function SignInNotice({ accountPath }: { accountPath: string }) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const id = sessionId(session?.access_token)
  const [dismissed, setDismissed] = useState(() => seen(id))

  const { data } = useQuery({
    queryKey: ['auth', 'sign-in-notice', id],
    enabled: Boolean(id) && !dismissed,
    staleTime: Infinity,
    queryFn: async (): Promise<number> => {
      const { data: notice, error } = await tci().rpc('my_sign_in_notice')
      if (error) return 0 // a backend without 0046: nothing to say
      return Number((notice as { failed_since_previous_sign_in?: number } | null)?.failed_since_previous_sign_in ?? 0)
    },
  })

  if (dismissed || !data) return null

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(SEEN_KEY, id)
    } catch {
      // per-tab convenience only
    }
    setDismissed(true)
  }

  return (
    <div
      role="alert"
      className="animate-fade-in mb-5 flex items-start gap-3 rounded-lg border border-warn-500/30 bg-warn-50 px-4 py-3 text-[13.5px] text-slate-700"
    >
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn-500" />
      <div className="flex-1">
        <p className="font-semibold text-slate-800">{t('security.notice.title')}</p>
        <p className="mt-0.5">{t('security.notice.body', { count: data })}</p>
        <p className="mt-0.5 text-slate-500">
          {t('security.notice.hint')}{' '}
          <Link to={accountPath} className="font-medium text-accent-600 hover:underline" onClick={dismiss}>
            {t('security.notice.changePassword')}
          </Link>
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md p-1 text-slate-400 hover:bg-white/60 hover:text-slate-600"
        aria-label={t('security.notice.dismiss')}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
