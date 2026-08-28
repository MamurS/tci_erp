/** «Мой профиль» — the two things a portal user maintains about themselves.
 * Both write tci.user_profiles, whose RLS is `user_id = auth.uid()`, so a
 * portal user can only ever edit their own row. */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../../auth/AuthContext'
import { Button, Card, Field, Input, PageHeader, Spinner } from '../../components/ui'
import { tci } from '../../lib/supabase'
import { useMyEntity } from './api'

interface ProfileRow {
  user_id: string
  full_name: string | null
  phone: string | null
}

function useMyProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['portal', 'profile', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await tci()
        .from('user_profiles')
        .select('user_id, full_name, phone')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return (data as ProfileRow | null) ?? null
    },
  })
}

export function PortalAccountPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.user.id
  const { data: profile, isLoading } = useMyProfile(userId)
  const { data: entity } = useMyEntity()

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFullName(profile?.full_name ?? '')
    setPhone(profile?.phone ?? '')
  }, [profile])

  const save = useMutation({
    mutationFn: async () => {
      const { error: updateError } = await tci()
        .from('user_profiles')
        .update({ full_name: fullName.trim() || null, phone: phone.trim() || null })
        .eq('user_id', userId)
      if (updateError) throw updateError
    },
    onSuccess: () => {
      setSaved(true)
      void queryClient.invalidateQueries({ queryKey: ['portal', 'profile'] })
    },
    onError: () => setError(t('common.saveFailed')),
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div>
      <PageHeader title={t('portal.account.title')} subtitle={t('portal.account.subtitle')} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            {t('portal.account.contact')}
          </h2>
          <div className="flex flex-col gap-3">
            <Field label={t('portal.account.company')}>
              <Input value={entity?.name ?? ''} disabled readOnly />
            </Field>
            <Field label={t('portal.account.email')}>
              {/* Changing the sign-in address is an identity change, not a
                  contact detail: it goes through the people who provisioned
                  the account. */}
              <Input value={session?.user.email ?? ''} disabled readOnly />
            </Field>
            <Field label={t('portal.account.fullName')}>
              <Input
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value)
                  setSaved(false)
                }}
              />
            </Field>
            <Field label={t('portal.account.phone')}>
              <Input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  setSaved(false)
                }}
              />
            </Field>
          </div>

          {error && (
            <p className="mt-3 text-[13px] text-neg-500" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 flex items-center gap-3">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
            {saved && <span className="text-[13px] text-pos-500">{t('portal.account.saved')}</span>}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            {t('portal.account.security')}
          </h2>
          <p className="mb-4 text-[13px] text-slate-500">{t('portal.account.securityHint')}</p>
          <Link
            to="/change-password"
            className="inline-flex items-center rounded-md bg-accent-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent-700"
          >
            {t('account.changePassword')}
          </Link>
        </Card>
      </div>
    </div>
  )
}
