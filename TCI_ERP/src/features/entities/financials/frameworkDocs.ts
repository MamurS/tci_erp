/**
 * The framework documents exactly as the migrations load them
 * (`select tci.seed_statement_framework($fw$ … $fw$::jsonb)`), parsed from
 * the migration text. Test-only: the app reads templates from the database;
 * the tests use this to hold every seeded form to the same rules the
 * database enforces, and to run the mapping over real template data.
 */

import type { LocalFormula, MappingRule, TemplateRules } from './mapping'
import { templateRules } from './mapping'

const MIGRATIONS = import.meta.glob('../../../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export interface SeedLine {
  code: string
  section: string
  indent: number
  subtotal: boolean
  negative: boolean
  name: { en: string; ru: string; uz: string; local: string }
  map: { column: string; sign: 1 | -1 } | null
  formula: LocalFormula | null
  check: string | null
  note: string | null
}

export interface SeedTemplate {
  code: string
  form_kind: 'balance_sheet' | 'income_statement'
  fidelity: string
  local_language: string
  name: { en: string; ru: string; uz: string; local: string }
  lines: SeedLine[]
}

export interface FrameworkDoc {
  /** The migration file the document is loaded by. */
  source: string
  framework: {
    code: string
    kind: string
    short: { en: string; ru: string; uz: string }
    name: { en: string; ru: string; uz: string }
    legal_basis: string
    countries: string[]
  }
  templates: SeedTemplate[]
}

const DOC = /select tci\.seed_statement_framework\(\$fw\$([\s\S]*?)\$fw\$::jsonb\)/g

export function frameworkDocs(): FrameworkDoc[] {
  const docs: FrameworkDoc[] = []
  for (const [path, sql] of Object.entries(MIGRATIONS).sort(([a], [b]) => a.localeCompare(b))) {
    for (const match of sql.matchAll(DOC)) {
      docs.push({ source: path.split('/').pop() ?? path, ...(JSON.parse(match[1]) as Omit<FrameworkDoc, 'source'>) })
    }
  }
  return docs
}

export function seedTemplate(code: string): SeedTemplate {
  for (const doc of frameworkDocs()) {
    const hit = doc.templates.find((t) => t.code === code)
    if (hit) return hit
  }
  throw new Error(`no seeded template ${code}`)
}

export function rulesOf(template: SeedTemplate): TemplateRules {
  return templateRules(
    template.lines.map((l) => ({ line_code: l.code, formula: l.formula, crosscheck_column: l.check })),
  )
}

export function mappingsOf(template: SeedTemplate): MappingRule[] {
  return template.lines
    .filter((l): l is SeedLine & { map: NonNullable<SeedLine['map']> } => l.map !== null)
    .map((l) => ({
      line_code: l.code,
      target_table: template.form_kind,
      target_column: l.map.column,
      sign: l.map.sign,
    }))
}
