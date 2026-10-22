/**
 * The brochure's words, one section at a time: a title and a body in each of
 * the three languages, and an image from the media library. The body is
 * plain text with three conventions (model.ts), shown as the field's hint.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, X } from 'lucide-react'

import { Button, Field, Input, Segmented, Tabs, Textarea } from '../../components/ui'
import { sectionMissingLangs, updateSection } from './editor'
import { ImagePickerModal } from './ImagePickerModal'
import { MediaThumb } from './MediaThumb'
import { BROCHURE_LANGS, BROCHURE_SECTION_KEYS } from './model'
import type { BrochureContent, BrochureLang, BrochureSectionKey, MediaAsset } from './model'

interface BrochureEditorProps {
  content: BrochureContent
  onChange: (next: BrochureContent) => void
  lang: BrochureLang
  onLangChange: (lang: BrochureLang) => void
  assets: readonly MediaAsset[]
}

export function BrochureEditor({
  content,
  onChange,
  lang,
  onLangChange,
  assets,
}: BrochureEditorProps) {
  const { t } = useTranslation()
  const [active, setActive] = useState<BrochureSectionKey>('what')
  const [picking, setPicking] = useState(false)
  const section = content.sections.find((s) => s.key === active) ?? content.sections[0]
  if (!section) return null

  const missing = sectionMissingLangs(section)
  const asset = section.image_asset_id
    ? assets.find((a) => a.id === section.image_asset_id)
    : undefined
  // A version may name an image retired since: saving it again is refused.
  const imageProblem =
    section.image_asset_id && (!asset || asset.retired_at) ? 'brochure.editor.imageRetired' : null
  const imagePath = asset?.storage_path ?? section.image_path ?? null
  const imageAlt = asset?.alt[lang] ?? section.image_alt?.[lang] ?? ''

  const change = (patch: { title?: string; body?: string; image?: string | null }) =>
    onChange(
      updateSection(content, section.key, (s) => ({
        ...s,
        title: patch.title !== undefined ? { ...s.title, [lang]: patch.title } : s.title,
        body: patch.body !== undefined ? { ...s.body, [lang]: patch.body } : s.body,
        ...(patch.image !== undefined
          ? { image_asset_id: patch.image, image_path: null, image_alt: null }
          : {}),
      })),
    )

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        size="sm"
        tabs={BROCHURE_SECTION_KEYS.map((key) => ({ key, label: t(`brochure.sections.${key}`) }))}
        active={section.key}
        onChange={(key) => setActive(key as BrochureSectionKey)}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={lang}
          ariaLabel={t('brochure.editor.language')}
          options={BROCHURE_LANGS.map((l) => ({ key: l, label: t(`brochure.langs.${l}`) }))}
          onChange={(l) => onLangChange(l as BrochureLang)}
        />
        {/* Reserved: appears and disappears without moving the fields. */}
        <p
          className={`min-h-5 text-xs ${missing.length ? 'font-medium text-slate-700' : 'text-pos-500'}`}
        >
          {missing.length ? (
            <>
              <span
                aria-hidden
                className="mr-1.5 inline-block size-2 rounded-full bg-warn-500 align-middle"
              />
              {t('brochure.editor.missingIn', {
                langs: missing.map((l) => l.toUpperCase()).join(', '),
              })}
            </>
          ) : (
            t('brochure.editor.complete')
          )}
        </p>
      </div>

      <Field label={t('brochure.editor.title')}>
        <Input
          lang={lang}
          value={section.title[lang]}
          maxLength={200}
          onChange={(e) => change({ title: e.target.value })}
        />
      </Field>

      <Field
        label={t('brochure.editor.body')}
        hint={
          section.key === 'how'
            ? `${t('brochure.editor.conventions')} ${t('brochure.editor.diagramNote')}`
            : t('brochure.editor.conventions')
        }
      >
        <Textarea
          lang={lang}
          rows={16}
          value={section.body[lang]}
          onChange={(e) => change({ body: e.target.value })}
          className="font-mono text-[13px] leading-relaxed"
        />
      </Field>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold tracking-wide text-slate-600 uppercase">
          {t('brochure.editor.image')}
        </span>
        <div className="flex items-start gap-3">
          {imagePath ? (
            <MediaThumb path={imagePath} alt={imageAlt} className="h-[4.5rem] w-24" />
          ) : (
            <span className="block h-[4.5rem] w-24 shrink-0 rounded border border-dashed border-slate-300 bg-slate-50" />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="truncate text-[13px] text-slate-600" title={imageAlt || undefined}>
              {section.image_asset_id ? imageAlt || '—' : t('brochure.editor.noImage')}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
                <ImagePlus aria-hidden />
                {t('brochure.editor.pickImage')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!section.image_asset_id}
                onClick={() => change({ image: null })}
              >
                <X aria-hidden />
                {t('brochure.editor.removeImage')}
              </Button>
            </div>
          </div>
        </div>
        <p
          className={`min-h-5 text-xs ${imageProblem ? 'font-medium text-neg-500' : 'text-slate-500'}`}
        >
          {imageProblem ? t(imageProblem) : t('brochure.editor.imageHint')}
        </p>
      </div>

      <ImagePickerModal
        open={picking}
        assets={assets}
        selected={section.image_asset_id}
        lang={lang}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          change({ image: id })
          setPicking(false)
        }}
      />
    </div>
  )
}
