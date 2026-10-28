/**
 * The portal's page search (owner, 2026-10-28). The portal has no top bar
 * search, so each list page carries the same Google-style field as the rest
 * of the system (SearchInput) under its header, with the same rules as the
 * staff screens' one search (lib/pageSearch.ts): terms separated by commas
 * narrow the list in order, an exact value selects exactly, and what was
 * typed lives in the URL (`?q=`).
 */

import { useTranslation } from 'react-i18next'

import { Button, EmptyState, SearchInput } from '../../components/ui'

export function PortalSearch({
  query,
  onChange,
  placeholder,
}: {
  query: string
  onChange: (next: string) => void
  placeholder: string
}) {
  return (
    <div data-portal-search className="max-w-2xl">
      <SearchInput value={query} onChange={onChange} placeholder={placeholder} aria-label={placeholder} />
    </div>
  )
}

/** A list the search emptied: says so, and offers to clear it. */
export function PortalNoMatches({ onClear }: { onClear: () => void }) {
  const { t } = useTranslation()
  return (
    <EmptyState
      pictogram="search"
      title={t('common.noMatches')}
      hint={t('common.noMatchesHint')}
      action={
        <Button variant="secondary" size="sm" onClick={onClear}>
          {t('search.clear')}
        </Button>
      }
    />
  )
}
