/**
 * One sector review as written: the seven factors with their scores and
 * notes, the narrative the grade rests on, and the sources (a web address is
 * a link that opens in a new tab, without access to this page).
 */

import { useTranslation } from 'react-i18next'

import { Badge, SectionTitle, Table } from '../../components/ui'
import type { SectorReview } from '../risk/api'
import { SECTOR_FACTORS } from '../risk/rules'
import { factorTone, sourceHref } from './model'

export function ReviewBody({ review }: { review: Pick<SectorReview, 'factors' | 'narrative' | 'sources'> }) {
  const { t } = useTranslation()
  const sources = Array.isArray(review.sources) ? review.sources : []
  return (
    <div className="grid gap-5">
      <Table dense columns={['14rem', '10rem', 'fill']}>
        <thead>
          <tr>
            <th>{t('risk.sectors.review.factor')}</th>
            <th>{t('risk.sectors.review.score')}</th>
            <th>{t('risk.sectors.review.note')}</th>
          </tr>
        </thead>
        <tbody>
          {SECTOR_FACTORS.map((key) => {
            const factor = review.factors?.[key]
            return (
              <tr key={key}>
                <td className="font-medium whitespace-normal text-slate-700">{t(`risk.sectors.factors.${key}`)}</td>
                <td>
                  {factor?.score ? (
                    <Badge tone={factorTone(factor.score)}>{t(`risk.sectors.scores.${factor.score}`)}</Badge>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="whitespace-normal text-slate-600">{factor?.note?.trim() || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </Table>

      <div>
        <SectionTitle className="mb-2">{t('risk.sectors.review.narrative')}</SectionTitle>
        <p className="text-body leading-relaxed whitespace-pre-line text-slate-700">{review.narrative}</p>
      </div>

      <div>
        <SectionTitle className="mb-2">{t('risk.sectors.review.sources')}</SectionTitle>
        {sources.length ? (
          <ul className="list-disc space-y-1 pl-5 text-small text-slate-700">
            {sources.map((source, i) => {
              const href = sourceHref(String(source))
              return (
                <li key={i} className="break-words">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
                      {String(source)}
                    </a>
                  ) : (
                    String(source)
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-small text-slate-500">{t('risk.sectors.review.noSources')}</p>
        )}
      </div>
    </div>
  )
}
