/**
 * Admin › «Кредитный анализ» (migration 0069): whether credit analysis is
 * COMBINED with underwriting (the credit underwriter rates and decides) or
 * SEPARATE (credit analysts rate and confirm, credit underwriters decide —
 * and never on a rating they made). Switching moves the open rating tasks to
 * whoever rates under the new mode.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Callout, Card, ConfirmDialog, SectionTitle, Segmented } from '../../components/ui'
import { CREDIT_ANALYSIS_MODES } from '../../lib/creditAnalysis'
import { CREDIT_ANALYSIS_MODE_KEY, useCreditAnalysisMode } from '../../lib/useCreditAnalysisMode'
import type { CreditAnalysisMode } from '../../lib/creditAnalysis'
import { refusalOr } from '../../lib/optimistic'
import { tci } from '../../lib/supabase'

export function CreditAnalysisModeCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const mode = useCreditAnalysisMode()
  const [pending, setPending] = useState<CreditAnalysisMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async (next: CreditAnalysisMode) => {
      const { error: failure } = await tci().rpc('set_credit_analysis_mode', { p_mode: next })
      if (failure) throw failure
    },
    onSuccess: (_data, next) => {
      queryClient.setQueryData(CREDIT_ANALYSIS_MODE_KEY, next)
      void queryClient.invalidateQueries({ queryKey: ['agenda', 'tasks'] })
    },
    onError: (failure) => setError(t(refusalOr(failure, 'common.saveFailed'))),
  })

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle hint={t('admin.creditAnalysis.hint')}>{t('admin.creditAnalysis.title')}</SectionTitle>
      <Segmented
        value={mode}
        tone="solid"
        ariaLabel={t('admin.creditAnalysis.title')}
        onChange={(key) => {
          if (key === mode) return
          setError(null)
          setPending(key as CreditAnalysisMode)
        }}
        options={CREDIT_ANALYSIS_MODES.map((m) => ({ key: m, label: t(`admin.creditAnalysis.modes.${m}`) }))}
      />
      <p className="text-small text-slate-600">{t(`admin.creditAnalysis.body.${mode}`)}</p>
      {error && <Callout tone="neg" title={error} />}
      <ConfirmDialog
        open={pending !== null}
        title={t('admin.creditAnalysis.confirmTitle')}
        message={pending ? t(`admin.creditAnalysis.confirm.${pending}`) : ''}
        confirmLabel={t('admin.creditAnalysis.switch')}
        tone="primary"
        pending={save.isPending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return
          save.mutate(pending, { onSettled: () => setPending(null) })
        }}
      />
    </Card>
  )
}
