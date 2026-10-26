/**
 * Colour maths for the design tokens (Prompt 30): OKLCH → sRGB with gamut
 * mapping by chroma reduction, hex output, and WCAG 2 relative luminance and
 * contrast. Pure; no dependency. The palette (palette.ts) is built with it,
 * and the contrast test (contrast.test.ts) checks every pair with it.
 */

export interface Oklch {
  l: number
  c: number
  h: number
}

const toGamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)

/** OKLCH → linear sRGB (may fall outside [0, 1]). */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const inGamut = (rgb: number[]) => rgb.every((x) => x >= -1e-4 && x <= 1 + 1e-4)

/** The colour, its chroma reduced until it fits sRGB (hue and lightness kept). */
export function toGamut(color: Oklch): Oklch {
  if (inGamut(oklchToLinear(color))) return color
  let lo = 0
  let hi = color.c
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(oklchToLinear({ ...color, c: mid }))) lo = mid
    else hi = mid
  }
  return { ...color, c: lo }
}

/** sRGB channels 0–255 of an OKLCH colour (gamut-mapped). */
export function oklchToRgb(color: Oklch): [number, number, number] {
  const lin = oklchToLinear(toGamut(color))
  return lin.map((x) => Math.round(Math.min(Math.max(toGamma(Math.min(Math.max(x, 0), 1)), 0), 1) * 255)) as [
    number,
    number,
    number,
  ]
}

export function oklchToHex(color: Oklch): string {
  return `#${oklchToRgb(color)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')}`
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map((x) => toLinear(x / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h }
}

/** WCAG 2 relative luminance of a hex colour. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((x) => toLinear(x / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio of two hex colours (≥ 1). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `oklch(L C H)` as CSS writes it. */
export function cssOklch({ l, c, h }: Oklch): string {
  return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(1)})`
}
