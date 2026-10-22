/** Choose a section's image from the media library (active images only), or
 * none. New images are uploaded in the library view, never from here. */

import { useTranslation } from 'react-i18next'
import { Check, ImageOff } from 'lucide-react'

import { Button, EmptyState, LinkButton, Modal } from '../../components/ui'
import { MediaThumb } from './MediaThumb'
import type { BrochureLang, MediaAsset } from './model'

interface ImagePickerModalProps {
  open: boolean
  assets: readonly MediaAsset[]
  selected: string | null | undefined
  lang: BrochureLang
  onPick: (assetId: string | null) => void
  onClose: () => void
}

export function ImagePickerModal({
  open,
  assets,
  selected,
  lang,
  onPick,
  onClose,
}: ImagePickerModalProps) {
  const { t } = useTranslation()
  const active = assets.filter((a) => !a.retired_at)
  const tile = (pressed: boolean) =>
    `relative flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent-500 ${
      pressed
        ? 'border-accent-600 bg-accent-50 ring-1 ring-accent-600'
        : 'border-slate-200 hover:border-accent-300'
    }`

  return (
    <Modal
      open={open}
      wide
      title={t('brochure.editor.pickImage')}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      }
    >
      {active.length === 0 ? (
        <EmptyState
          title={t('brochure.editor.noImages')}
          hint={t('brochure.editor.noImagesHint')}
          action={
            <LinkButton to="/brochure?view=media" variant="secondary" onClick={onClose}>
              {t('brochure.editor.goToLibrary')}
            </LinkButton>
          }
        />
      ) : (
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          <button
            type="button"
            aria-pressed={!selected}
            className={tile(!selected)}
            onClick={() => onPick(null)}
          >
            <span className="flex aspect-[4/3] w-full items-center justify-center rounded bg-slate-50 text-slate-400">
              <ImageOff aria-hidden className="size-6" />
            </span>
            <span className="truncate text-xs text-slate-600">{t('brochure.editor.noImage')}</span>
          </button>
          {active.map((asset) => {
            const pressed = asset.id === selected
            return (
              <button
                key={asset.id}
                type="button"
                aria-pressed={pressed}
                className={tile(pressed)}
                title={asset.alt[lang]}
                onClick={() => onPick(asset.id)}
              >
                <MediaThumb
                  path={asset.storage_path}
                  alt={asset.alt[lang]}
                  className="aspect-[4/3] w-full"
                />
                <span className="truncate text-xs text-slate-600">{asset.alt[lang]}</span>
                {pressed && (
                  <Check
                    aria-hidden
                    className="absolute top-2.5 right-2.5 size-5 rounded-full bg-accent-600 p-0.5 text-white"
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
