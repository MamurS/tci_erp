/**
 * A country's flag as a real SVG image. Emoji flags are not drawn by
 * Windows (Chrome and Edge show the two letters instead), so they cannot
 * carry meaning on a staff workstation. Each flag is its own small asset,
 * fetched only when that country is shown; an unknown code renders the ISO
 * code itself.
 */

import { useEffect, useState } from 'react'

const FLAGS = import.meta.glob<string>('../../../node_modules/country-flag-icons/3x2/*.svg', {
  query: '?url',
  import: 'default',
})

const loaders = new Map<string, () => Promise<string>>(
  Object.entries(FLAGS).map(([path, load]) => [path.slice(-6, -4), load]),
)

const resolved = new Map<string, string>()

interface CountryFlagProps {
  /** ISO 3166-1 alpha-2. */
  code: string | null | undefined
  className?: string
  title?: string
}

export function CountryFlag({ code, className = '', title }: CountryFlagProps) {
  const iso = (code ?? '').toUpperCase()
  const [url, setUrl] = useState<string | null>(() => resolved.get(iso) ?? null)

  useEffect(() => {
    const cached = resolved.get(iso)
    if (cached) {
      setUrl(cached)
      return
    }
    const load = loaders.get(iso)
    if (!load) {
      setUrl(null)
      return
    }
    let alive = true
    void load().then((src) => {
      resolved.set(iso, src)
      if (alive) setUrl(src)
    })
    return () => {
      alive = false
    }
  }, [iso])

  if (!iso) return null
  if (!loaders.has(iso)) {
    return (
      <span
        className={`inline-flex h-[1em] items-center rounded-[3px] bg-slate-100 px-1 font-mono text-[0.6em] font-semibold text-slate-500 ${className}`}
        title={title ?? iso}
      >
        {iso}
      </span>
    )
  }
  return (
    <span
      className={`inline-block h-[0.8em] w-[1.2em] shrink-0 overflow-hidden rounded-[2px] bg-slate-100 align-[-0.05em] ring-1 ring-black/10 ${className}`}
      title={title ?? iso}
    >
      {url && <img src={url} alt={iso} className="block size-full object-cover" draggable={false} />}
    </span>
  )
}
