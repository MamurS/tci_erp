/**
 * THE brochure renderer — one document for the editor's preview, the client
 * portal and the printed commercial offer, so the three can never drift.
 *
 *   <BrochureBody content={version.content} lang="uz" print />
 *
 * Everything is in the DOCUMENT's language (`lang`, through useFixedT), not
 * the interface's: a Russian-speaking sales manager previews the Uzbek
 * brochure in Uzbek. Sections render in print order (model.ts); a section
 * with neither title nor body in `lang` is left out. Images come from the
 * private media library through signed URLs, inside a fixed 4:3 box so the
 * page does not move while they load. `print`: A4 sizes in the report face,
 * headings kept with their text, the diagram, images and FAQ items kept
 * whole on a page; a page break BEFORE the
 * brochure is the caller's.
 */

import type { ReactNode } from 'react'

import { BRAND } from '../../lib/brand'
import { useFixedT } from '../../i18n/useFixedT'
import { useMediaUrls } from './api'
import { layoutBody } from './blocks'
import type { AnswerBlock } from './blocks'
import { normalizeContent } from './editor'
import { HowItWorksDiagram } from './HowItWorksDiagram'
import type { BrochureContent, BrochureLang, BrochureSection } from './model'

interface BrochureBodyProps {
  content: BrochureContent
  lang: BrochureLang
  print?: boolean
}

export function BrochureBody({ content, lang, print = false }: BrochureBodyProps) {
  const { t, ready } = useFixedT(lang)
  const sections = normalizeContent(content).sections.filter(
    (s) => s.title[lang].trim() || s.body[lang].trim(),
  )
  const urls = useMediaUrls(sections.map((s) => s.image_path))
  const [first, second] = BRAND.wordmark

  return (
    <article
      lang={lang}
      className={
        print
          ? 'brochure font-report text-[10.5pt] leading-[1.5] text-ink [print-color-adjust:exact]'
          : 'brochure text-[14px] leading-relaxed text-ink'
      }
    >
      {/* The cover line: the neutral wordmark and what the document is. */}
      <header
        className={`flex items-end justify-between gap-6 border-b-2 border-brand-navy ${print ? 'mb-[7mm] pb-[3mm]' : 'mb-8 pb-4'}`}
      >
        <div className="min-w-0">
          <p
            className={`font-display font-bold tracking-wide text-brand-blue uppercase ${print ? 'text-[10pt]' : 'text-[13px]'} ${ready ? '' : 'invisible'}`}
          >
            {ready ? t('brochure.doc.eyebrow') : '·'}
          </p>
          <h1
            className={`font-display leading-tight font-bold tracking-wide text-brand-navy uppercase ${print ? 'text-[22pt]' : 'text-[30px]'} ${ready ? '' : 'invisible'}`}
          >
            {ready ? t('brochure.doc.title') : '·'}
          </h1>
        </div>
        <span
          aria-hidden
          className={`inline-flex shrink-0 items-baseline font-display leading-none font-bold ${print ? 'text-[16pt]' : 'text-[22px]'}`}
        >
          <span className="text-brand-blue">{first}</span>
          <span className="ml-[0.24em] text-brand-navy">{second}</span>
        </span>
      </header>

      <div className={print ? 'flex flex-col gap-[6mm]' : 'flex flex-col gap-10'}>
        {sections.map((section) => (
          <SectionBlock
            key={section.key}
            section={section}
            lang={lang}
            print={print}
            imageUrl={section.image_path ? urls[section.image_path] : undefined}
            diagram={
              section.key === 'how' ? <DiagramBox ready={ready} t={t} print={print} /> : null
            }
          />
        ))}
      </div>
    </article>
  )
}

function DiagramBox({
  ready,
  t,
  print,
}: {
  ready: boolean
  t: Parameters<typeof HowItWorksDiagram>[0]['t']
  print: boolean
}) {
  return (
    <figure
      className={`mt-5 rounded-lg border border-accent-200 bg-white ${print ? 'p-[3mm] [break-inside:avoid]' : 'p-4'}`}
    >
      {/* Same box before the labels arrive: nothing moves when they do. */}
      <div className="aspect-[720/340] w-full">{ready && <HowItWorksDiagram t={t} />}</div>
    </figure>
  )
}

interface SectionBlockProps {
  section: BrochureSection
  lang: BrochureLang
  print: boolean
  imageUrl: string | undefined
  diagram: ReactNode
}

function SectionBlock({ section, lang, print, imageUrl, diagram }: SectionBlockProps) {
  const title = section.title[lang].trim()
  const blocks = layoutBody(section.body[lang])
  const hasImage = Boolean(section.image_path)
  const alt = section.image_alt?.[lang]?.trim() ?? ''
  // Sections flow across pages — keeping a whole section on one page left
  // half-empty pages before every long one. What must not split is smaller:
  // a heading stays with what follows it, and the diagram, an image and each
  // FAQ question with its answer are kept whole.

  return (
    <section aria-label={title || undefined}>
      {title && (
        <h2
          className={`flex items-center gap-2 font-display leading-tight font-bold tracking-wide text-brand-navy uppercase [break-after:avoid] ${
            print ? 'mb-[2.5mm] text-[14pt]' : 'mb-3 text-[20px]'
          }`}
        >
          <span
            aria-hidden
            className={`inline-block shrink-0 bg-brand-blue ${print ? 'size-[2.6mm]' : 'size-3'}`}
          />
          {title}
        </h2>
      )}
      <div
        className={
          hasImage
            ? print
              ? 'grid grid-cols-[minmax(0,1fr)_58mm] items-start gap-[6mm]'
              : 'grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_16rem]'
            : ''
        }
      >
        <div className={`flex min-w-0 flex-col ${print ? 'gap-[2.5mm]' : 'gap-3'}`}>
          {blocks.map((block, i) =>
            block.kind === 'faq' ? (
              <div
                key={i}
                className={`border-l-[3px] border-brand-orange ${print ? 'pl-[3mm] [break-inside:avoid]' : 'pl-4'}`}
              >
                <p className={`font-semibold text-brand-navy ${print ? 'mb-[1mm]' : 'mb-1'}`}>
                  {block.question}
                </p>
                <div className={`flex flex-col ${print ? 'gap-[1.5mm]' : 'gap-2'} text-slate-700`}>
                  {block.answer.map((answer, j) => (
                    <Answer key={j} block={answer} print={print} />
                  ))}
                </div>
              </div>
            ) : (
              <Answer key={i} block={block} print={print} />
            ),
          )}
        </div>
        {hasImage && (
          <figure
            className={`relative aspect-[4/3] w-full overflow-hidden rounded-md bg-accent-50 ${print ? '[break-inside:avoid]' : ''}`}
          >
            {imageUrl && (
              <img
                src={imageUrl}
                alt={alt}
                loading={print ? 'eager' : 'lazy'}
                decoding="async"
                className="absolute inset-0 size-full object-cover"
              />
            )}
          </figure>
        )}
      </div>
      {diagram}
    </section>
  )
}

function Answer({ block, print }: { block: AnswerBlock; print: boolean }) {
  if (block.kind === 'paragraph') return <p>{block.text}</p>
  return (
    <ul className={`flex flex-col ${print ? 'gap-[1mm]' : 'gap-1.5'}`}>
      {block.items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            aria-hidden
            className={`shrink-0 rounded-full bg-brand-orange ${print ? 'mt-[2.2mm] size-[1.6mm]' : 'mt-[0.6em] size-1.5'}`}
          />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}
