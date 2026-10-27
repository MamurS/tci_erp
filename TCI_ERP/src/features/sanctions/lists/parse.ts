/**
 * Reading the official sanctions lists as their publishers publish them
 * (migration 0091 stores what these return): OFAC's SDN list (sdn.csv, with
 * alt.csv for the aliases), the UN Security Council consolidated list (XML),
 * the EU consolidated financial sanctions list (CSV, «;»), the UK Sanctions
 * List (CSV) and, for any other list, the simple CSV format OpenSanctions
 * publishes. Pure: a file's text in, parties out — testable without a
 * browser. Nothing here decides anything; a person reviews every match.
 */

export const LISTS = ['ofac_sdn', 'un', 'eu', 'uk', 'other'] as const
export type SanctionsList = (typeof LISTS)[number]

/** The official lists the reminder expects (workflow_settings.sanctions_required_lists). */
export const REQUIRED_LISTS = ['ofac_sdn', 'un', 'eu', 'uk'] as const

export const ENTRY_KINDS = ['person', 'entity', 'vessel', 'aircraft', 'other'] as const
export type EntryKind = (typeof ENTRY_KINDS)[number]

export interface ParsedName {
  /** the name as published */
  n: string
  /** the primary name */
  p: boolean
}

/** One listed party, in the shape tci.add_sanctions_list_entries takes. */
export interface ParsedEntry {
  ref: string
  kind: EntryKind
  names: ParsedName[]
  programmes: string[]
  countries: string[]
  birth_dates: string[]
  listed_on: string | null
  remarks: string | null
}

export interface ParsedList {
  list: SanctionsList
  /** The list's own date when the file carries one (YYYY-MM-DD). */
  publishedAt: string | null
  entries: ParsedEntry[]
}

export type ListFormatProblem = 'format' | 'empty' | 'aliases'

export class ListFormatError extends Error {
  readonly code: ListFormatProblem
  constructor(code: ListFormatProblem) {
    super(code)
    this.code = code
  }
}

/** Upper bounds the database checks (0091). */
const MAX_NAMES = 300
const MAX_NAME = 500
const MAX_REMARKS = 2000

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180-ish: quoted fields with doubled quotes, any line ending. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const src = text.replace(/^\uFEFF/, '')
  while (i < src.length) {
    const c = src[i]!
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
      } else field += c
      i += 1
      continue
    }
    if (c === '"' && field.trim() === '') {
      quoted = true
      field = ''
    } else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (c === '\r' && src[i + 1] === '\n') i += 1
    } else field += c
    i += 1
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''))
}

const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim()

/** OFAC writes «-0-» for an empty field. */
const ofacValue = (s: string | undefined): string => {
  const v = clean(s)
  return v === '-0-' ? '' : v
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const c = clean(v)
    if (!c) continue
    const k = c.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c)
  }
  return out
}

function addName(names: ParsedName[], name: string, primary: boolean) {
  const n = clean(name).slice(0, MAX_NAME)
  if (!n) return
  const existing = names.find((x) => x.n.toLowerCase() === n.toLowerCase())
  if (existing) {
    existing.p = existing.p || primary
    return
  }
  if (names.length < MAX_NAMES) names.push({ n, p: primary })
}

/** At most one primary name, and one there always is. */
function settle(entry: ParsedEntry): ParsedEntry {
  let seen = false
  for (const n of entry.names) {
    if (n.p && !seen) seen = true
    else n.p = false
  }
  if (!seen && entry.names[0]) entry.names[0].p = true
  entry.programmes = uniq(entry.programmes)
  entry.countries = uniq(entry.countries)
  entry.birth_dates = uniq(entry.birth_dates)
  entry.remarks = entry.remarks ? entry.remarks.slice(0, MAX_REMARKS) : null
  return entry
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const isoOrNull = (s: string | null | undefined): string | null => {
  const v = clean(s)
  if (ISO_DATE.test(v)) return v
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`
  return null
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

// ---------------------------------------------------------------------------
// OFAC SDN (sdn.csv + alt.csv)
// ---------------------------------------------------------------------------

/**
 * sdn.csv: ent_num, name, type («individual» / «vessel» / «aircraft» / «-0-»
 * for an entity), programmes («SDGT] [IRGC»), title, call sign, vessel
 * columns, remarks («DOB 12 Jan 1960; nationality Iran; …»). alt.csv:
 * ent_num, alt_num, type (aka / fka / nka), alias, remarks. Neither file
 * carries a date: the person importing gives the publication date.
 */
export function parseOfacSdn(sdnText: string, altText: string | null): ParsedList {
  const rows = parseCsv(sdnText, ',')
  const byRef = new Map<string, ParsedEntry>()
  for (const r of rows) {
    if (r.length < 4 || !/^\d+$/.test(clean(r[0]))) continue
    const ref = clean(r[0])
    const type = ofacValue(r[2]).toLowerCase()
    const remarks = ofacValue(r[11])
    const entry: ParsedEntry = {
      ref,
      kind: type === 'individual' ? 'person' : type === 'vessel' ? 'vessel' : type === 'aircraft' ? 'aircraft' : 'entity',
      names: [],
      programmes: ofacValue(r[3]).replace(/^\[|\]$/g, '').split(/\]\s*\[/).map(clean),
      countries: [],
      birth_dates: [],
      listed_on: null,
      remarks: remarks || null,
    }
    addName(entry.names, ofacValue(r[1]), true)
    for (const m of remarks.matchAll(/\bDOB ([^;]+)/g)) entry.birth_dates.push(clean(m[1]).replace(/\.$/, ''))
    for (const m of remarks.matchAll(/\b(?:nationality|citizen) ([^;]+)/gi))
      entry.countries.push(clean(m[1]).replace(/\.$/, ''))
    if (entry.names.length) byRef.set(ref, entry)
  }
  if (altText !== null) {
    const alts = parseCsv(altText, ',')
    let matched = 0
    for (const r of alts) {
      const ref = clean(r[0])
      const entry = byRef.get(ref)
      if (!entry) continue
      matched += 1
      addName(entry.names, ofacValue(r[3]), false)
    }
    if (alts.length > 0 && matched === 0) throw new ListFormatError('aliases')
  }
  if (!byRef.size) throw new ListFormatError(rows.length ? 'format' : 'empty')
  return { list: 'ofac_sdn', publishedAt: null, entries: [...byRef.values()].map(settle) }
}

// ---------------------------------------------------------------------------
// UN Security Council consolidated list (XML)
// ---------------------------------------------------------------------------

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** The blocks <tag>…</tag> directly in `xml` (the list's elements do not nest in themselves). */
function blocks(xml: string, tag: string): string[] {
  const out: string[] = []
  const open = `<${tag}>`
  const close = `</${tag}>`
  let from = 0
  for (;;) {
    const a = xml.indexOf(open, from)
    if (a < 0) break
    const b = xml.indexOf(close, a)
    if (b < 0) break
    out.push(xml.slice(a + open.length, b))
    from = b + close.length
  }
  return out
}

/** Text of every <tag>value</tag> in a block (self-closing ones are empty). */
function texts(xml: string, tag: string): string[] {
  return blocks(xml, tag).map((v) => clean(decodeXml(v.replace(/<[^>]+>/g, ' '))))
}
const text1 = (xml: string, tag: string): string => texts(xml, tag)[0] ?? ''

export function parseUn(xmlText: string): ParsedList {
  if (!xmlText.includes('<CONSOLIDATED_LIST')) throw new ListFormatError('format')
  const generated = /dateGenerated="(\d{4}-\d{2}-\d{2})/.exec(xmlText)?.[1] ?? null
  const entries: ParsedEntry[] = []
  const read = (block: string, kind: EntryKind) => {
    const ref = text1(block, 'REFERENCE_NUMBER') || text1(block, 'DATAID')
    if (!ref) return
    const entry: ParsedEntry = {
      ref,
      kind,
      names: [],
      programmes: [text1(block, 'UN_LIST_TYPE')],
      countries: [],
      birth_dates: [],
      listed_on: isoOrNull(text1(block, 'LISTED_ON')),
      remarks: text1(block, 'COMMENTS1') || null,
    }
    const full = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map((t) => text1(block, t)).filter(Boolean).join(' ')
    addName(entry.names, full, true)
    addName(entry.names, text1(block, 'NAME_ORIGINAL_SCRIPT'), false)
    for (const alias of [...blocks(block, 'INDIVIDUAL_ALIAS'), ...blocks(block, 'ENTITY_ALIAS')]) {
      addName(entry.names, text1(alias, 'ALIAS_NAME'), false)
    }
    for (const nat of blocks(block, 'NATIONALITY')) entry.countries.push(...texts(nat, 'VALUE'))
    for (const addr of [...blocks(block, 'ENTITY_ADDRESS'), ...blocks(block, 'INDIVIDUAL_ADDRESS')]) {
      entry.countries.push(text1(addr, 'COUNTRY'))
    }
    for (const dob of blocks(block, 'INDIVIDUAL_DATE_OF_BIRTH')) {
      const d = text1(dob, 'DATE') || text1(dob, 'YEAR') ||
        [text1(dob, 'FROM_YEAR'), text1(dob, 'TO_YEAR')].filter(Boolean).join('–')
      if (d) entry.birth_dates.push(d.slice(0, 10))
    }
    if (entry.names.length) entries.push(settle(entry))
  }
  for (const b of blocks(xmlText, 'INDIVIDUAL')) read(b, 'person')
  for (const b of blocks(xmlText, 'ENTITY')) read(b, 'entity')
  if (!entries.length) throw new ListFormatError('empty')
  return { list: 'un', publishedAt: generated, entries }
}

// ---------------------------------------------------------------------------
// EU consolidated financial sanctions list (CSV 1.1, «;»)
// ---------------------------------------------------------------------------

/** Rows per (party × name × address × birth date × …), grouped by Entity_LogicalId. */
export function parseEu(csvText: string): ParsedList {
  const rows = parseCsv(csvText, ';')
  const head = rows[0]?.map(clean) ?? []
  const col = (name: string) => head.indexOf(name)
  const iId = col('Entity_LogicalId')
  const iName = col('NameAlias_WholeName')
  if (iId < 0 || iName < 0) throw new ListFormatError('format')
  const iRef = col('Entity_EU_ReferenceNumber')
  const iType = col('Entity_SubjectType_ClassificationCode')
  const iProg = col('Entity_Regulation_Programme')
  const iPub = col('Entity_Regulation_PublicationDate')
  const iRemark = col('Entity_Remark')
  const iAddr = col('Address_CountryDescription')
  const iCit = col('Citizenship_CountryDescription')
  const iBirth = col('BirthDate_BirthDate')
  const iBirthYear = col('BirthDate_Year')
  const iGen = col('fileGenerationDate')
  const at = (r: string[], i: number) => (i >= 0 ? clean(r[i]) : '')

  const byId = new Map<string, ParsedEntry>()
  let generated: string | null = null
  for (const r of rows.slice(1)) {
    const id = at(r, iId)
    if (!id) continue
    generated = generated ?? isoOrNull(at(r, iGen))
    let entry = byId.get(id)
    if (!entry) {
      const type = at(r, iType).toLowerCase()
      entry = {
        ref: at(r, iRef) || id,
        kind: type === 'person' ? 'person' : type === 'enterprise' ? 'entity' : 'other',
        names: [],
        programmes: [],
        countries: [],
        birth_dates: [],
        listed_on: isoOrNull(at(r, iPub)),
        remarks: at(r, iRemark) || null,
      }
      byId.set(id, entry)
    }
    addName(entry.names, at(r, iName), entry.names.length === 0)
    entry.programmes.push(at(r, iProg))
    entry.countries.push(at(r, iAddr), at(r, iCit))
    entry.birth_dates.push(at(r, iBirth) || at(r, iBirthYear))
  }
  const entries = [...byId.values()].filter((e) => e.names.length).map(settle)
  if (!entries.length) throw new ListFormatError('empty')
  // The EU reference is not unique on its own for every party: keep the
  // logical id when two parties share one.
  const seen = new Map<string, number>()
  for (const e of entries) seen.set(e.ref, (seen.get(e.ref) ?? 0) + 1)
  for (const [id, e] of byId) if ((seen.get(e.ref) ?? 0) > 1) e.ref = `${e.ref}#${id}`
  return { list: 'eu', publishedAt: generated, entries }
}

// ---------------------------------------------------------------------------
// UK Sanctions List (CSV)
// ---------------------------------------------------------------------------

/** «Report Date: 27-Oct-2026», then a header, then a row per name. */
export function parseUk(csvText: string): ParsedList {
  const firstLine = /^\uFEFF?([^\r\n]*)/.exec(csvText)?.[1] ?? ''
  const reported = /Report Date:\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(firstLine)
  const publishedAt = reported
    ? `${reported[3]}-${MONTHS[reported[2]!.toLowerCase()] ?? '01'}-${reported[1]!.padStart(2, '0')}`
    : null
  const rows = parseCsv(csvText, ',')
  const headAt = rows.findIndex((r) => r.map(clean).includes('Unique ID'))
  if (headAt < 0) throw new ListFormatError('format')
  const head = rows[headAt]!.map(clean)
  const col = (name: string) => head.indexOf(name)
  const iId = col('Unique ID')
  const iNames = ['Name 1', 'Name 2', 'Name 3', 'Name 4', 'Name 5', 'Name 6'].map(col)
  const iType = col('Name type')
  const iScript = col('Name non-latin script')
  const iRegime = col('Regime Name')
  const iDesig = col('Designation Type')
  const iDob = col('D.O.B')
  const iNat = col('Nationality(/ies)')
  const iCountry = col('Address Country')
  const iDate = col('Date Designated')
  const iInfo = col('Other Information')
  if (iId < 0 || iNames[5]! < 0) throw new ListFormatError('format')
  const at = (r: string[], i: number) => (i >= 0 ? clean(r[i]) : '')

  const byId = new Map<string, ParsedEntry>()
  for (const r of rows.slice(headAt + 1)) {
    const id = at(r, iId)
    if (!id) continue
    let entry = byId.get(id)
    if (!entry) {
      const d = at(r, iDesig).toLowerCase()
      entry = {
        ref: id,
        kind: d === 'individual' ? 'person' : d === 'entity' ? 'entity' : d === 'ship' ? 'vessel' : 'other',
        names: [],
        programmes: [],
        countries: [],
        birth_dates: [],
        listed_on: isoOrNull(at(r, iDate)),
        remarks: at(r, iInfo) || null,
      }
      byId.set(id, entry)
    }
    const name = iNames.map((i) => at(r, i)).filter(Boolean).join(' ')
    addName(entry.names, name, /primary/i.test(at(r, iType)))
    addName(entry.names, at(r, iScript), false)
    entry.programmes.push(at(r, iRegime))
    entry.countries.push(...at(r, iNat).split(/[;,]/), at(r, iCountry))
    entry.birth_dates.push(at(r, iDob))
  }
  const entries = [...byId.values()].filter((e) => e.names.length).map(settle)
  if (!entries.length) throw new ListFormatError('empty')
  return { list: 'uk', publishedAt, entries }
}

// ---------------------------------------------------------------------------
// Any other list: the OpenSanctions «simple» CSV
// ---------------------------------------------------------------------------

/** id, schema, name, aliases («;»), birth_date, countries, …, sanctions, …, first_seen. */
export function parseSimpleCsv(csvText: string): ParsedList {
  const rows = parseCsv(csvText, ',')
  const head = rows[0]?.map((h) => clean(h).toLowerCase()) ?? []
  const col = (name: string) => head.indexOf(name)
  const iId = col('id')
  const iName = col('name')
  if (iId < 0 || iName < 0) throw new ListFormatError('format')
  const iSchema = col('schema')
  const iAliases = col('aliases')
  const iBirth = col('birth_date')
  const iCountries = col('countries')
  const iSanctions = col('sanctions')
  const iFirst = col('first_seen')
  const at = (r: string[], i: number) => (i >= 0 ? clean(r[i]) : '')
  const entries: ParsedEntry[] = []
  for (const r of rows.slice(1)) {
    const ref = at(r, iId)
    if (!ref) continue
    const schema = at(r, iSchema).toLowerCase()
    const entry: ParsedEntry = {
      ref,
      kind: schema === 'person' ? 'person'
        : schema === 'vessel' ? 'vessel'
        : schema === 'airplane' ? 'aircraft'
        : ['company', 'organization', 'legalentity'].includes(schema) ? 'entity' : 'other',
      names: [],
      programmes: at(r, iSanctions).split(';'),
      countries: at(r, iCountries).split(';'),
      birth_dates: at(r, iBirth).split(';'),
      listed_on: isoOrNull(at(r, iFirst).slice(0, 10)),
      remarks: null,
    }
    addName(entry.names, at(r, iName), true)
    for (const a of at(r, iAliases).split(';')) addName(entry.names, a, false)
    if (entry.names.length) entries.push(settle(entry))
  }
  if (!entries.length) throw new ListFormatError('empty')
  return { list: 'other', publishedAt: null, entries }
}

// ---------------------------------------------------------------------------

/** The list a file most likely is, from its first bytes — a suggestion the
 * person confirms, never a decision. */
export function guessList(fileName: string, head: string): SanctionsList | null {
  const h = head.replace(/^\uFEFF/, '')
  if (h.includes('<CONSOLIDATED_LIST')) return 'un'
  if (h.startsWith('fileGenerationDate;') || h.includes('Entity_LogicalId')) return 'eu'
  if (/^Report Date:/.test(h) || h.includes('OFSI Group ID')) return 'uk'
  if (/^\d+,"[^"]*",/.test(h) || /sdn/i.test(fileName)) return 'ofac_sdn'
  if (/^id,schema,name/i.test(h)) return 'other'
  return null
}

/** Batches for tci.add_sanctions_list_entries (at most 1000 parties, and a
 * byte budget so one request stays well under the API's body limit). */
export function batches(entries: ParsedEntry[], maxCount = 500, maxBytes = 900_000): ParsedEntry[][] {
  const out: ParsedEntry[][] = []
  let cur: ParsedEntry[] = []
  let bytes = 0
  for (const e of entries) {
    const size = JSON.stringify(e).length
    if (cur.length && (cur.length >= maxCount || bytes + size > maxBytes)) {
      out.push(cur)
      cur = []
      bytes = 0
    }
    cur.push(e)
    bytes += size
  }
  if (cur.length) out.push(cur)
  return out
}
