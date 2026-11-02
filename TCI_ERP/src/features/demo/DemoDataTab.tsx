/**
 * Admin › «Демо-данные» (migrations 0096–0097): how much demo data there is,
 * when it was loaded, load it (with an optional password for the demo
 * accounts), check that no row links the two worlds, unload it (typed
 * confirmation; counts before and after), and whether new accounts start in
 * demo mode. The database does the work; this screen asks and reports.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Callout,
  Card,
  Field,
  Input,
  KeyFigures,
  Modal,
  PasswordInput,
  SectionTitle,
  Segmented,
  Skeleton,
} from '../../components/ui'
import { formatAmount, formatMoment } from '../../lib/format'
import { refusalOr } from '../../lib/optimistic'
import {
  useDemoCounts,
  useDemoLinkCheck,
  useLoadDemoData,
  useSetNewUsersDemoMode,
  useUnloadDemoData,
} from './api'
import type { DemoLinkViolation } from './api'
import { DEMO_UNLOAD_WORD, areaCounts, demoPasswordProblem, totalRows } from './model'
import type { DemoUnloadResult } from './model'

export function DemoDataTab() {
  const { t, i18n } = useTranslation()
  const counts = useDemoCounts()
  const load = useLoadDemoData()
  const unload = useUnloadDemoData()
  const check = useDemoLinkCheck()
  const newUsers = useSetNewUsersDemoMode()

  const [loadOpen, setLoadOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [unloadOpen, setUnloadOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [unloaded, setUnloaded] = useState<DemoUnloadResult | null>(null)
  const [violations, setViolations] = useState<DemoLinkViolation[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const data = counts.data
  const total = totalRows(data)
  const passwordProblem = demoPasswordProblem(password)
  const fmt = (n: number) => formatAmount(n, i18n.language)

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-5">
        <SectionTitle hint={t('demo.admin.hint')}>{t('demo.admin.title')}</SectionTitle>
        {counts.isLoading || !data ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <KeyFigures
              className=""
              items={[
                {
                  label: t('demo.admin.state'),
                  value: data.loaded ? t('demo.admin.loaded') : t('demo.admin.notLoaded'),
                  text: true,
                  tone: data.loaded ? 'warn' : 'muted',
                  meta: data.loaded_at
                    ? t('demo.admin.loadedAt', { at: formatMoment(data.loaded_at, i18n.language) })
                    : undefined,
                },
                { label: t('demo.admin.rows'), value: fmt(total) },
                { label: t('demo.admin.users'), value: fmt(data.demo_users) },
                ...areaCounts(data).map((a) => ({
                  label: t(`demo.areas.${a.area}`),
                  value: fmt(a.rows),
                  tone: 'muted' as const,
                })),
              ]}
            />
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() => {
                  setError(null)
                  setPassword('')
                  setLoadOpen(true)
                }}
                disabled={data.loaded}
                data-testid="demo-load"
              >
                {t('demo.admin.load')}
              </Button>
              <Button
                variant="secondary"
                loading={check.isPending}
                onClick={() => {
                  setError(null)
                  check.mutate(undefined, {
                    onSuccess: setViolations,
                    onError: (failure) =>
                      setError(t(refusalOr(failure, 'common.somethingWentWrong'))),
                  })
                }}
              >
                {t('demo.admin.check')}
              </Button>
              <Button
                variant="danger"
                disabled={total === 0 && data.demo_users === 0}
                onClick={() => {
                  setError(null)
                  setTyped('')
                  setUnloadOpen(true)
                }}
                data-testid="demo-unload"
              >
                {t('demo.admin.unload')}
              </Button>
            </div>
            {data.loaded && (
              <p className="text-small text-slate-600">{t('demo.admin.loadedNote')}</p>
            )}
          </>
        )}
        {error && <Callout tone="neg" title={error} />}
        {load.data && (
          <Callout
            tone="pos"
            title={
              load.data.already_loaded ? t('demo.admin.alreadyLoaded') : t('demo.admin.loadDone')
            }
          >
            {t('demo.admin.loadDoneBody', {
              rows: fmt(totalRows(load.data)),
              users: fmt(load.data.demo_users),
            })}
          </Callout>
        )}
        {unloaded && (
          <Callout tone="pos" title={t('demo.admin.unloadDone')}>
            {t('demo.admin.unloadDoneBody', {
              before: fmt(totalRows(unloaded.before)),
              after: fmt(totalRows(unloaded.after)),
              users: fmt(unloaded.demo_users_removed),
            })}
            {unloaded.demo_users_kept_banned.length > 0 && (
              <p className="mt-1">
                {t('demo.admin.usersBanned', { count: unloaded.demo_users_kept_banned.length })}
              </p>
            )}
          </Callout>
        )}
        {violations &&
          (violations.length === 0 ? (
            <Callout tone="pos" title={t('demo.admin.checkClean')} />
          ) : (
            <Callout tone="neg" title={t('demo.admin.checkFound', { count: violations.length })}>
              <ul className="list-disc pl-5">
                {violations.map((v) => (
                  <li key={`${v.tbl}.${v.col}`}>
                    {v.tbl}.{v.col} → {v.parent}: {fmt(v.row_count)}
                  </li>
                ))}
              </ul>
            </Callout>
          ))}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <SectionTitle hint={t('demo.admin.newUsersHint')}>{t('demo.admin.newUsers')}</SectionTitle>
        <Segmented
          tone="solid"
          ariaLabel={t('demo.admin.newUsers')}
          value={data?.new_users_demo_mode ? 'demo' : 'real'}
          onChange={(key) => newUsers.mutate(key === 'demo')}
          options={[
            { key: 'real', label: t('demo.admin.newUsersReal') },
            { key: 'demo', label: t('demo.admin.newUsersDemo') },
          ]}
        />
      </Card>

      <Modal
        open={loadOpen}
        title={t('demo.admin.loadTitle')}
        onClose={() => setLoadOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setLoadOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={load.isPending}
              disabled={passwordProblem !== null}
              onClick={() =>
                load.mutate(password === '' ? null : password, {
                  onSuccess: () => setLoadOpen(false),
                  onError: (failure) => {
                    setLoadOpen(false)
                    setError(t(refusalOr(failure, 'demo.admin.loadFailed')))
                  },
                })
              }
            >
              {t('demo.admin.loadConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-small text-slate-700">{t('demo.admin.loadBody')}</p>
          <Field
            label={t('demo.admin.password')}
            hint={t('demo.admin.passwordHint')}
            error={passwordProblem ? t('demo.admin.passwordTooShort') : undefined}
          >
            <PasswordInput
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={unloadOpen}
        title={t('demo.admin.unloadTitle')}
        onClose={() => setUnloadOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnloadOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={unload.isPending}
              disabled={typed.trim() !== DEMO_UNLOAD_WORD}
              data-testid="demo-unload-confirm"
              onClick={() =>
                unload.mutate(undefined, {
                  onSuccess: (result) => {
                    setUnloaded(result)
                    setUnloadOpen(false)
                  },
                  onError: (failure) => {
                    setUnloadOpen(false)
                    setError(t(refusalOr(failure, 'demo.admin.unloadFailed')))
                  },
                })
              }
            >
              {t('demo.admin.unloadConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-body leading-relaxed text-slate-600">
            {t('demo.admin.unloadBody', { rows: fmt(total), users: fmt(data?.demo_users ?? 0) })}
          </p>
          <Field label={t('demo.admin.unloadType', { word: DEMO_UNLOAD_WORD })}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
