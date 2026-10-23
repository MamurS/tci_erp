/**
 * "Was this you?" — shown after signing in when someone tried and failed to
 * sign in to this account since the previous sign-in, and the user has not
 * acknowledged those attempts yet (tci.my_sign_in_notice, migrations 0046 and
 * 0062). The project sends no e-mail, so this is where the owner of an
 * account learns about guessing against it.
 *
 * The acknowledgement lives in the database (user_profiles.sign_in_ack_at):
 * «Это был я» and × write it, and so does a password change. Only failures
 * after it ever show again — in any browser, on any device.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ShieldAlert, X } from 'lucide-react'

import { formatMoment } from '../lib/format'
import { tci } from '../lib/supabase'
import { useAuth } from './AuthContext'
import { describeUserAgent, parseFailedSignIns, parseInterruptedSignIns, parseSignInNotice } from './signInNotice'

function sessionId(token: string | undefined): string {
  try {
    const payload = JSON.parse(atob((token ?? '').split('.')[1] ?? '')) as { session_id?: string }
    return payload.session_id ?? ''
  } catch {
    return ''
  }
}

export function SignInNotice({ accountPath }: { accountPath: string }) {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const id = sessionId(session?.access_token)
  const [dismissed, setDismissed] = useState(false)
  const [showList, setShowList] = useState(false)

  const { data } = useQuery({
    queryKey: ['auth', 'sign-in-notice', id],
    enabled: Boolean(id),
    staleTime: Infinity,
    queryFn: async () => {
      // This sign-in first: without it the previous one would stand in for
      // it and the window would be the wrong one. Idempotent, and a no-op on
      // a restored session (there is no fresh ticket to consume).
      await tci().rpc('record_sign_in')
      const { data: notice, error } = await tci().rpc('my_sign_in_notice')
      return error ? parseSignInNotice(null) : parseSignInNotice(notice)
    },
  })

  const attempts = useQuery({
    queryKey: ['auth', 'failed-sign-ins', id],
    enabled: showList && Boolean(id),
    staleTime: Infinity,
    queryFn: async () => {
      const { data: rows, error } = await tci().rpc('my_failed_sign_ins')
      return error ? [] : parseFailedSignIns(rows)
    },
  })

  // Stopped before the password check (0064): listed apart, never hidden.
  const interrupted = useQuery({
    queryKey: ['auth', 'interrupted-sign-ins', id],
    enabled: showList && Boolean(id) && (data?.interrupted ?? 0) > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const { data: rows, error } = await tci().rpc('my_interrupted_sign_ins')
      return error ? [] : parseInterruptedSignIns(rows)
    },
  })

  if (dismissed || !data || (data.count === 0 && data.interrupted === 0)) return null

  // The banner goes at once; the watermark is written behind it. If that
  // write fails the notice simply comes back at the next sign-in.
  const acknowledge = () => {
    setDismissed(true)
    void tci().rpc('acknowledge_sign_in_failures')
  }
  const locale = i18n.language

  return (
    <div
      role="alert"
      className="animate-fade-in mb-5 flex items-start gap-3 rounded-lg border border-warn-500/30 bg-warn-50 px-4 py-3 text-[13.5px] text-slate-700"
    >
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-800">
          {t(data.count > 0 ? 'security.notice.title' : 'security.notice.titleInterrupted')}
        </p>
        {data.count > 0 && <p className="mt-0.5">{t('security.notice.body', { count: data.count })}</p>}
        {data.firstAt && data.lastAt && (
          <p className="mt-0.5 text-slate-600">
            {data.firstAt === data.lastAt
              ? t('security.notice.at', { at: formatMoment(data.firstAt, locale) })
              : t('security.notice.range', {
                  from: formatMoment(data.firstAt, locale),
                  to: formatMoment(data.lastAt, locale),
                })}
          </p>
        )}
        {data.interrupted > 0 && (
          <p className="mt-0.5 text-slate-600">{t('security.notice.interrupted', { count: data.interrupted })}</p>
        )}
        <p className="mt-0.5 text-slate-500">
          {t('security.notice.hint')}{' '}
          <Link to={accountPath} className="font-medium text-accent-600 hover:underline">
            {t('security.notice.changePassword')}
          </Link>
        </p>
        {showList && data.count > 0 && (
          <table className="mt-2 w-full table-fixed text-[12.5px]">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[26%]" />
              <col />
            </colgroup>
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2 font-medium">{t('security.notice.columns.time')}</th>
                <th className="py-1 pr-2 font-medium">{t('security.notice.columns.network')}</th>
                <th className="py-1 font-medium">{t('security.notice.columns.device')}</th>
              </tr>
            </thead>
            <tbody>
              {(attempts.data ?? []).map((a) => (
                <tr key={a.at} className="border-t border-warn-500/20 align-top">
                  <td className="num py-1 pr-2">{formatMoment(a.at, locale)}</td>
                  <td className="num truncate py-1 pr-2">{a.ipMasked ?? '—'}</td>
                  <td className="truncate py-1" title={a.userAgent ?? undefined}>
                    {describeUserAgent(a.userAgent) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {showList && data.interrupted > 0 && (
          <table className="mt-2 w-full table-fixed text-[12.5px]">
            <caption className="py-1 text-left font-medium text-slate-600">
              {t('security.notice.interruptedTitle')}
            </caption>
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[26%]" />
              <col />
            </colgroup>
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2 font-medium">{t('security.notice.columns.time')}</th>
                <th className="py-1 pr-2 font-medium">{t('security.notice.columns.network')}</th>
                <th className="py-1 font-medium">{t('security.notice.columns.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {(interrupted.data ?? []).map((a) => (
                <tr key={a.at} className="border-t border-warn-500/20 align-top">
                  <td className="num py-1 pr-2">{formatMoment(a.at, locale)}</td>
                  <td className="num truncate py-1 pr-2">{a.ipMasked ?? '—'}</td>
                  <td className="truncate py-1" title={describeUserAgent(a.userAgent) ?? undefined}>
                    {t(`security.notice.reasons.${a.reason}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={acknowledge}
            className="rounded font-medium text-slate-800 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none"
          >
            {t('security.notice.thisWasMe')}
          </button>
          <button
            type="button"
            onClick={() => setShowList((v) => !v)}
            aria-expanded={showList}
            className="rounded font-medium text-accent-600 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none"
          >
            {showList ? t('security.notice.hideAttempts') : t('security.notice.showAttempts')}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={acknowledge}
        className="rounded-md p-1 text-slate-400 hover:bg-white/60 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none"
        aria-label={t('security.notice.dismiss')}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
