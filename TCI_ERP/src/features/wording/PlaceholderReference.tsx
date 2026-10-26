/** The placeholder catalogue as a reference an author can copy from. It is
 *  folded away until asked for: a page of reference tables is what a template
 *  author needs once, not what everyone opening the templates must scroll
 *  past. */

import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import {
  Button,
  Card,
  COL,
  SectionTitle,
  Table,
} from '../../components/ui'
import { PLACEHOLDER_GROUPS, PLACEHOLDERS, placeholderGroup, placeholderKey, placeholderSyntax, WORDING_SYNTAX } from './catalogue'

export function PlaceholderReference() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <Card className="p-5">
      <SectionTitle
        hint={t('wording.reference.hint')}
        actions={
          <Button size="sm" variant="secondary" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
            {open ? t('wording.reference.hide') : t('wording.reference.show', { count: PLACEHOLDERS.length })}
            <ChevronDown aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        }
      >
        {t('wording.reference.title')}
      </SectionTitle>
      {open && (
        <div id={bodyId} className="mt-4">
          <ul className="mb-4 list-inside list-disc text-[0.8125rem] text-slate-600">
            <li>{t('wording.reference.syntaxValue', WORDING_SYNTAX)}</li>
            <li>{t('wording.reference.syntaxLoop', WORDING_SYNTAX)}</li>
            <li>{t('wording.reference.syntaxCondition', WORDING_SYNTAX)}</li>
          </ul>
          {PLACEHOLDER_GROUPS.map((group) => (
            <div key={group} className="mb-4 last:mb-0">
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {t(`wording.reference.groups.${group}`, WORDING_SYNTAX)}
              </h3>
              <Table dense columns={['50%', COL.fill]}>
                <tbody>
                  {PLACEHOLDERS.filter((p) => placeholderGroup(p) === group).map((p) => (
                    <tr key={p}>
                      <td className="font-mono text-[0.75rem] text-accent-700 select-all">{placeholderSyntax(p)}</td>
                      <td className="text-[0.8125rem]">{t(placeholderKey(p))}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
