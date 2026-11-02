/**
 * The Help centre: the user guide compiled from docs/guide (scripts/guide).
 *
 *   /help, /help/:topicId, /help/term/:termId              staff (AppShell)
 *   /portal/help, /portal/help/:topicId, …/term/:termId    the portal (client topics only)
 *
 * Home: search, the contents with the reader's acting role first, the
 * glossary, the quick-start PDFs and «Replay the tour». A topic: its text,
 * the headings in it, the other topics for the page it was opened from
 * (?from=), previous / next. Search words (?q=) are marked in the text.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookA, ChevronLeft, ChevronRight, FileDown, MessageCircleQuestion, Play, Printer } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { Button, Card, EmptyState, LinkButton, PageHeader, SearchInput, Spinner } from '../../components/ui'
import { HtmlView } from './HtmlView'
import { helpLang, quickStartPdfUrl, useHelpBundle } from './bundle'
import { helpBase, helpTopicsFor, helpVisibleTo } from './pages'
import { matchRanges, queryWords, searchHelp } from './search'
import { orderSections, quickStartRoles } from './contents'
import type { HelpBundle, HelpLang, HelpSection } from './types'

/** The event the guided tour listens for (another feature starts the tour). */
export const TOUR_START_EVENT = 'tci:tour:start'

export function HelpPage({ portal = false }: { portal?: boolean }) {
  const { i18n } = useTranslation()
  const lang = helpLang(i18n.resolvedLanguage)
  const { data: bundle, isLoading, isError } = useHelpBundle(lang)
  const { actingRole } = useAuth()
  const role = portal ? 'client' : actingRole
  const base = helpBase(portal)
  const { topicId, termId } = useParams()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''

  if (isLoading)
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
      </div>
    )
  if (isError || !bundle) return <HelpMissing base={base} />

  // /help/term/<id>: the glossary entry, wherever it lives
  if (termId) {
    const term = bundle.terms[termId]
    const ok = term && helpVisibleTo(bundle.topics[term.topic]?.roles ?? [], role)
    return <Navigate to={ok ? `${base}/${term.topic}${term.anchor ? `#${term.anchor}` : ''}` : base} replace />
  }
  const topic = topicId ? bundle.topics[topicId] : null
  const readable = topic && helpVisibleTo(topic.roles, role) ? topic : null

  return (
    <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]" data-help>
      <HelpContents
        bundle={bundle}
        role={role}
        base={base}
        current={readable?.section ?? null}
        topicId={topicId ?? null}
        q={q}
        setQ={(v) => setParams(v ? { q: v } : {}, { replace: true })}
      />
      <div className="min-w-0">
        {q.trim() && !topicId ? (
          <SearchResults bundle={bundle} q={q} role={role} base={base} />
        ) : topicId && !readable ? (
          <HelpMissing base={base} />
        ) : readable ? (
          <TopicView bundle={bundle} id={readable.id} role={role} base={base} q={q} />
        ) : (
          <HelpHome bundle={bundle} lang={lang} role={role} base={base} portal={portal} />
        )}
      </div>
    </div>
  )
}

function HelpMissing({ base }: { base: string }) {
  const { t } = useTranslation()
  return (
    <EmptyState
      pictogram="search"
      title={t('help.notFound')}
      hint={t('help.notFoundHint')}
      action={
        <LinkButton to={base} variant="secondary">
          {t('help.openHome')}
        </LinkButton>
      }
    />
  )
}

function HelpContents({
  bundle,
  role,
  base,
  current,
  topicId,
  q,
  setQ,
}: {
  bundle: HelpBundle
  role: string | null
  base: string
  current: string | null
  topicId: string | null
  q: string
  setQ: (v: string) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(q)
  useEffect(() => setDraft(q), [q])
  // the query follows typing, a moment later
  useEffect(() => {
    if (draft === q) return
    const h = window.setTimeout(() => setQ(draft), 200)
    return () => window.clearTimeout(h)
  }, [draft, q, setQ])

  const groups = orderSections(bundle.sections, role)
  const labels = { mine: t('help.forYourRole'), shared: t('help.forEveryone'), other: t('help.otherRoles') }
  const linkClass = (active: boolean) =>
    `block rounded-md px-2 py-1 hover:bg-slate-100 ${active ? 'bg-accent-50 font-semibold text-accent-800' : 'text-slate-700'}`

  return (
    <aside className="print:hidden lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-2" aria-label={t('help.contents')}>
      <SearchInput
        value={draft}
        onChange={setDraft}
        placeholder={t('help.searchPlaceholder')}
        aria-label={t('help.searchLabel')}
        data-testid="help-search"
        className="mb-4"
      />
      <nav className="grid gap-5 text-small">
        <Link to={base} className={linkClass(!topicId && !q)}>
          {t('help.home')}
        </Link>
        {(['mine', 'shared', 'other'] as const).map((group) =>
          groups[group].length ? (
            <div key={group} className="grid gap-1">
              <div className="px-2 text-caption font-semibold tracking-wide text-slate-500 uppercase">{labels[group]}</div>
              {groups[group].map((s) => (
                <div key={s.id}>
                  <Link to={`${base}/${s.id}`} className={`${linkClass(topicId === s.id)} font-medium`}>
                    {s.title}
                  </Link>
                  {current === s.id && (
                    <ul className="mt-1 mb-2 ml-2 grid gap-0.5 border-l border-slate-200 pl-2">
                      {s.topics.map((id) => (
                        <li key={id}>
                          <Link
                            to={`${base}/${id}`}
                            aria-current={topicId === id ? 'page' : undefined}
                            className={linkClass(topicId === id)}
                          >
                            {bundle.topics[id]?.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ) : null,
        )}
      </nav>
    </aside>
  )
}

function Highlighted({ text, marks }: { text: string; marks: [number, number][] }) {
  const out: ReactNode[] = []
  let at = 0
  marks.forEach(([a, b], i) => {
    out.push(text.slice(at, a), <mark key={i} className="rounded-sm bg-warning-100 ring-1 ring-warning-400">{text.slice(a, b)}</mark>)
    at = b
  })
  out.push(text.slice(at))
  return <>{out}</>
}

function SearchResults({ bundle, q, role, base }: { bundle: HelpBundle; q: string; role: string | null; base: string }) {
  const { t } = useTranslation()
  const hits = useMemo(() => searchHelp(bundle, q, (roles) => helpVisibleTo(roles, role)), [bundle, q, role])
  const words = queryWords(q)
  return (
    <>
      <PageHeader title={t('help.title')} subtitle={t('help.resultsCount', { count: hits.length })} />
      {hits.length === 0 ? (
        <EmptyState pictogram="search" title={t('help.noResults', { q })} hint={t('help.noResultsHint')} />
      ) : (
        <ol className="grid max-w-4xl gap-3" data-testid="help-results">
          {hits.map((h) => (
            <li key={h.id}>
              <Link
                to={`${base}/${h.id}?q=${encodeURIComponent(q)}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 shadow-card transition-colors hover:border-accent-300"
              >
                <div className="text-caption text-slate-500">{h.section}</div>
                <div className="text-lead font-semibold text-slate-900">
                  <Highlighted text={h.title} marks={matchRanges(h.title, words)} />
                </div>
                <p className="mt-1 text-small text-slate-600">
                  <Highlighted text={h.snippet} marks={h.marks} />
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

function TopicView({ bundle, id, role, base, q }: { bundle: HelpBundle; id: string; role: string | null; base: string; q: string }) {
  const { t } = useTranslation()
  const location = useLocation()
  const [params] = useSearchParams()
  const topic = bundle.topics[id]
  const section = bundle.sections.find((s) => s.id === topic.section)
  const words = useMemo(() => queryWords(q), [q])

  // reading order across the guide the reader may read (section index, then its topics)
  const order = useMemo(
    () =>
      bundle.sections
        .filter((s) => helpVisibleTo(s.roles, role))
        .flatMap((s) => [s.id, ...s.topics])
        .filter((x) => helpVisibleTo(bundle.topics[x]?.roles ?? [], role)),
    [bundle, role],
  )
  const pos = order.indexOf(id)
  const prev = pos > 0 ? bundle.topics[order[pos - 1]] : null
  const next = pos >= 0 && pos < order.length - 1 ? bundle.topics[order[pos + 1]] : null

  // opened from a page («?», F1): the other topics for that page
  const from = params.get('from')
  const related = from ? helpTopicsFor(from, role).filter((x) => x !== id && bundle.topics[x]) : []

  useEffect(() => {
    const hash = decodeURIComponent(location.hash.slice(1))
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' })
    else if (words.length) document.querySelector('[data-topic] mark')?.scrollIntoView({ block: 'center' })
    else window.scrollTo({ top: 0 })
  }, [id, location.hash, words])

  const h2 = topic.headings.filter((h) => h.level === 2)
  return (
    <>
      <PageHeader
        eyebrow={section && section.id !== topic.id ? <Link to={`${base}/${section.id}`}>{section.title}</Link> : t('help.title')}
        title={topic.title}
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="size-4" />
            {t('help.print')}
          </Button>
        }
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_15rem]">
        <article className="min-w-0" data-topic={topic.id}>
          <HtmlView html={topic.html} base={base} words={words} />
          {topic.index && section && (
            <ul className="mt-6 grid max-w-4xl gap-2">
              {section.topics
                .filter((tid) => helpVisibleTo(bundle.topics[tid]?.roles ?? [], role))
                .map((tid) => (
                  <li key={tid}>
                    <Link
                      to={`${base}/${tid}`}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-card hover:border-accent-300"
                    >
                      <span className="font-medium text-slate-800">{bundle.topics[tid]?.title}</span>
                      <ChevronRight className="size-4 text-slate-500" aria-hidden />
                    </Link>
                  </li>
                ))}
            </ul>
          )}
          <nav className="mt-10 flex max-w-4xl flex-wrap justify-between gap-3 border-t border-slate-200 pt-4 print:hidden">
            {prev ? (
              <Link to={`${base}/${prev.id}`} className="flex items-center gap-2 text-small text-accent-700 hover:underline">
                <ChevronLeft className="size-4" aria-hidden />
                <span>
                  <span className="sr-only">{t('help.prevTopic')}: </span>
                  {prev.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link to={`${base}/${next.id}`} className="flex items-center gap-2 text-small text-accent-700 hover:underline">
                <span>
                  <span className="sr-only">{t('help.nextTopic')}: </span>
                  {next.title}
                </span>
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            )}
          </nav>
        </article>
        <aside className="hidden text-small xl:block print:hidden">
          <div className="sticky top-24 grid gap-6">
            {h2.length > 1 && (
              <div>
                <div className="mb-2 text-caption font-semibold tracking-wide text-slate-500 uppercase">{t('help.inThisTopic')}</div>
                <ul className="grid gap-1 border-l border-slate-200 pl-3">
                  {h2.map((h) => (
                    <li key={h.id}>
                      <a href={`#${h.id}`} className="text-slate-600 hover:text-slate-900">
                        {h.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {related.length > 0 && (
              <div data-testid="help-related">
                <div className="mb-2 text-caption font-semibold tracking-wide text-slate-500 uppercase">{t('help.onThisPage')}</div>
                <ul className="grid gap-1 border-l border-slate-200 pl-3">
                  {related.slice(0, 12).map((rid) => (
                    <li key={rid}>
                      <Link to={`${base}/${rid}?from=${encodeURIComponent(from ?? '')}`} className="text-slate-600 hover:text-slate-900">
                        {bundle.topics[rid].title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}

function HelpHome({ bundle, lang, role, base, portal }: { bundle: HelpBundle; lang: HelpLang; role: string | null; base: string; portal: boolean }) {
  const { t } = useTranslation()
  const groups = orderSections(bundle.sections, role)
  const glossary = bundle.sections.find((s) => s.folder === '10-glossary')
  const faq = bundle.sections.find((s) => s.folder === '11-faq')
  const pdfs = quickStartRoles(role)
  const section = (s: HelpSection) => (
    <Link
      key={s.id}
      to={`${base}/${s.id}`}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-card transition-colors hover:border-accent-300"
    >
      <div className="font-semibold text-slate-900">{s.title}</div>
      <div className="mt-1 line-clamp-2 text-small text-slate-600">{bundle.topics[s.id]?.text}</div>
    </Link>
  )
  return (
    <>
      <PageHeader title={t('help.title')} subtitle={t('help.version', { version: bundle.version })} />
      <div className="grid max-w-5xl gap-6">
        <Card className="p-6">
          <h2 className="text-title font-semibold text-slate-900">{t('help.welcome')}</h2>
          <p className="mt-2 text-body text-slate-600">{t(portal ? 'help.welcomeTextPortal' : 'help.welcomeText')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {!portal && glossary && (
              <LinkButton to={`${base}/${glossary.id}`} variant="secondary">
                <BookA className="size-4" />
                {t('help.glossary')}
              </LinkButton>
            )}
            {!portal && faq && (
              <LinkButton to={`${base}/${faq.id}`} variant="secondary">
                <MessageCircleQuestion className="size-4" />
                {t('help.faq')}
              </LinkButton>
            )}
            {!portal && (
              <Button variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent(TOUR_START_EVENT))} data-testid="help-replay-tour">
                <Play className="size-4" />
                {t('help.replayTour')}
              </Button>
            )}
          </div>
        </Card>
        {pdfs.length > 0 && (
          <Card className="p-6" data-testid="help-pdfs">
            <h2 className="text-lead font-semibold text-slate-900">{t('help.quickStart')}</h2>
            <p className="mt-1 text-small text-slate-600">{t('help.quickStartHint')}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {pdfs.map((r, i) => (
                <li key={r}>
                  <a
                    href={quickStartPdfUrl(lang, r)}
                    target="_blank"
                    rel="noopener"
                    data-pdf={r}
                    className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-small font-medium transition-colors ${
                      i === 0 ? 'border-accent-300 bg-accent-50 text-accent-800 hover:bg-accent-100' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <FileDown className="size-4" aria-hidden />
                    {t(`roles.${r}`)}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {(['mine', 'shared', 'other'] as const).map((group) =>
          groups[group].length ? (
            <section key={group}>
              <h2 className="mb-3 text-lead font-semibold text-slate-900">
                {t(group === 'mine' ? 'help.forYourRole' : group === 'shared' ? 'help.forEveryone' : 'help.otherRoles')}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">{groups[group].map(section)}</div>
            </section>
          ) : null,
        )}
      </div>
    </>
  )
}
