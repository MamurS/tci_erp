import { useTranslation } from 'react-i18next'

import { listOf, otherListName } from './model'

/** The list's name: one of the four official lists, or the other list's own. */
export function useListName() {
  const { t } = useTranslation()
  return (listKey: string, short = false) => {
    const list = listOf(listKey)
    if (list === 'other') return otherListName(listKey) ?? t('sanctions.lists.name.other')
    return t(short ? `sanctions.lists.short.${list}` : `sanctions.lists.name.${list}`)
  }
}
