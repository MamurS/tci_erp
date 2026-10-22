/** An image from the private media library, in a box of fixed size, so a
 * row or a card is the same height before and after the signed URL arrives. */

import { ImageIcon } from 'lucide-react'

import { useMediaUrls } from './api'

export function MediaThumb({
  path,
  alt,
  className = 'h-12 w-16',
}: {
  path: string | null | undefined
  alt: string
  /** The box (width and height); the image covers it. */
  className?: string
}) {
  const url = useMediaUrls([path])[path ?? '']
  return (
    <span
      className={`relative block shrink-0 overflow-hidden rounded bg-accent-50 ring-1 ring-slate-200 ring-inset ${className}`}
    >
      {url ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <ImageIcon aria-hidden className="absolute inset-0 m-auto size-4 text-accent-300" />
      )}
    </span>
  )
}
