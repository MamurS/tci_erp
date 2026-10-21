/** «Sign out other sessions» — every other device, keeping this one.
 * Supabase Auth's own scope: the other sessions' refresh tokens are revoked
 * at once; their access tokens die at the JWT expiry (kept short). */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, SectionTitle } from '../../components/ui'
import { supabase } from '../../lib/supabase'

export function SessionsSection() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signOutOthers = async () => {
    setBusy(true)
    setError(null)
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' })
    setBusy(false)
    if (signOutError) {
      setError(t('common.saveFailed'))
      return
    }
    setDone(true)
  }

  return (
    <Card className="p-5">
      <SectionTitle className="mb-2">{t('account.sessions.title')}</SectionTitle>
      <p className="mb-4 text-[13px] text-slate-500">{t('account.sessions.hint')}</p>
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => void signOutOthers()}>
          {t('account.sessions.signOutOthers')}
        </Button>
        {done && <span className="text-[13px] text-pos-500">{t('account.sessions.signedOutOthers')}</span>}
      </div>
      {error && (
        <p className="mt-3 text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Card>
  )
}
