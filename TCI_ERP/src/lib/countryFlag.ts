/** Country flag emoji from ISO alpha-2 via regional indicator symbols. */
export function countryFlag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return ''
  const base = 0x1f1e6
  const upper = code.toUpperCase()
  return String.fromCodePoint(
    base + upper.charCodeAt(0) - 65,
    base + upper.charCodeAt(1) - 65,
  )
}
