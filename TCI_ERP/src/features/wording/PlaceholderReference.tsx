/** The placeholder catalogue as a reference an author can copy from. */

import { useTranslation } from 'react-i18next'

import { Card, SectionTitle, Table } from '../../components/ui'
import { PLACEHOLDER_GROUPS, PLACEHOLDERS, placeholderGroup, placeholderKey, placeholderSyntax, WORDING_SYNTAX } from './catalogue'

export function PlaceholderReference() {
  const { t } = useTranslation()
  return (
    <Card className="p-5">
      <SectionTitle>{t('wording.reference.title')}</SectionTitle>
      <p className="mb-3 text-[13px] text-slate-500">{t('wording.reference.hint')}</p>
      <ul className="mb-4 list-inside list-disc text-[13px] text-slate-600">
        <li>{t('wording.reference.syntaxValue', WORDING_SYNTAX)}</li>
        <li>{t('wording.reference.syntaxLoop', WORDING_SYNTAX)}</li>
        <li>{t('wording.reference.syntaxCondition', WORDING_SYNTAX)}</li>
      </ul>
      {PLACEHOLDER_GROUPS.map((group) => (
        <div key={group} className="mb-4">
          <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            {t(`wording.reference.groups.${group}`, WORDING_SYNTAX)}
          </h3>
          <Table dense>
            <tbody>
              {PLACEHOLDERS.filter((p) => placeholderGroup(p) === group).map((p) => (
                <tr key={p}>
                  <td className="w-1/2 font-mono text-[12px] text-accent-700 select-all">{placeholderSyntax(p)}</td>
                  <td className="text-[13px]">{t(placeholderKey(p))}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ))}
    </Card>
  )
}
