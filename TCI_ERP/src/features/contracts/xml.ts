/**
 * A small, strict-enough XML reader for WordprocessingML parts (pure, no
 * DOM): elements with their attributes and text, entities decoded,
 * declarations, processing instructions and comments skipped, CDATA kept as
 * text. Enough for document.xml / styles.xml / numbering.xml of a .docx,
 * and runs the same in the browser and in the unit tests (node).
 */

export interface XmlEl {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}
export type XmlNode = XmlEl | string

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export function parseXml(xml: string): XmlEl {
  const root: XmlEl = { name: '#root', attrs: {}, children: [] }
  const stack: XmlEl[] = [root]
  let i = 0
  const n = xml.length
  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt === -1) {
      pushText(stack, xml.slice(i))
      break
    }
    if (lt > i) pushText(stack, xml.slice(i, lt))
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      const text = xml.slice(lt + 9, end === -1 ? n : end)
      stack[stack.length - 1]!.children.push(text)
      i = end === -1 ? n : end + 3
      continue
    }
    const gt = xml.indexOf('>', lt)
    if (gt === -1) break
    const raw = xml.slice(lt + 1, gt)
    i = gt + 1
    if (raw[0] === '?' || raw[0] === '!') continue
    if (raw[0] === '/') {
      const name = raw.slice(1).trim()
      // close up to the matching element (tolerates a stray close)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.name === name) {
          stack.length = k
          break
        }
      }
      continue
    }
    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    const space = body.search(/\s/)
    const name = space === -1 ? body : body.slice(0, space)
    const attrs: Record<string, string> = {}
    if (space !== -1) {
      for (const m of body.slice(space).matchAll(ATTR)) attrs[m[1]!] = decodeEntities(m[2] ?? m[3] ?? '')
    }
    const el: XmlEl = { name, attrs, children: [] }
    stack[stack.length - 1]!.children.push(el)
    if (!selfClosing) stack.push(el)
  }
  return root
}

function pushText(stack: XmlEl[], raw: string) {
  stack[stack.length - 1]!.children.push(decodeEntities(raw))
}

export function elements(el: XmlEl): XmlEl[] {
  return el.children.filter((c): c is XmlEl => typeof c !== 'string')
}

export function child(el: XmlEl | undefined, name: string): XmlEl | undefined {
  return el ? elements(el).find((c) => c.name === name) : undefined
}

/** The first descendant with this name (depth-first). */
export function find(el: XmlEl, name: string): XmlEl | undefined {
  for (const c of elements(el)) {
    if (c.name === name) return c
    const hit = find(c, name)
    if (hit) return hit
  }
  return undefined
}

export function textOf(el: XmlEl): string {
  return el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('')
}
