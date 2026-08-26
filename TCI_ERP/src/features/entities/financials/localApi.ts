/** Data access for local (statutory) statement templates and values. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../../lib/supabase'
import type { StatementHeaderInput } from '../api'
import { mapLocalStatement } from './mapping'
import type { MappingRule } from './mapping'

export interface TemplateLine {
  id: string
  line_code: string
  name_en: string
  name_ru: string
  name_uz: string
  section: string
  display_order: number
  is_subtotal: boolean
  indent_level: number
}

export interface StatementTemplate {
  id: string
  country_code: string
  form_kind: 'balance_sheet' | 'income_statement'
  code: string
  name_en: string
  name_ru: string
  name_uz: string
  version: string
  is_active: boolean
  statement_template_lines: TemplateLine[]
}

export function useTemplates(countryCode: string | undefined) {
  return useQuery({
    queryKey: ['ref', 'templates', countryCode],
    enabled: Boolean(countryCode),
    staleTime: Infinity,
    queryFn: async (): Promise<StatementTemplate[]> => {
      const { data, error } = await tci()
        .from('statement_templates')
        .select('*, statement_template_lines(*)')
        .eq('country_code', countryCode as string)
        .eq('is_active', true)
        .order('code')
      if (error) throw error
      const templates = (data ?? []) as unknown as StatementTemplate[]
      for (const t of templates) {
        t.statement_template_lines.sort((a, b) => a.display_order - b.display_order)
      }
      return templates
    },
  })
}

export function useTemplateMappings(templateIds: string[]) {
  return useQuery({
    queryKey: ['ref', 'mappings', ...templateIds],
    enabled: templateIds.length > 0,
    staleTime: Infinity,
    queryFn: async (): Promise<(MappingRule & { template_line_id: string })[]> => {
      const { data, error } = await tci()
        .from('ifrs_mappings')
        .select('template_line_id, target_table, target_column, sign, statement_template_lines!inner(line_code, template_id)')
        .in('statement_template_lines.template_id', templateIds)
      if (error) throw error
      type Row = {
        template_line_id: string
        target_table: 'balance_sheet' | 'income_statement'
        target_column: string
        sign: number
        statement_template_lines: { line_code: string; template_id: string }
      }
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        template_line_id: r.template_line_id,
        line_code: r.statement_template_lines.line_code,
        target_table: r.target_table,
        target_column: r.target_column,
        sign: r.sign,
      }))
    },
  })
}

/** Values keyed by template_line_id (line codes may repeat across forms). */
export function useLocalValues(statementId: string | undefined) {
  return useQuery({
    queryKey: ['statements', statementId, 'local-values'],
    enabled: Boolean(statementId),
    queryFn: async (): Promise<Record<string, number | null>> => {
      const { data, error } = await tci()
        .from('local_statement_values')
        .select('template_line_id, amount')
        .eq('statement_id', statementId as string)
      if (error) throw error
      type Row = { template_line_id: string; amount: number | null }
      const result: Record<string, number | null> = {}
      for (const row of (data ?? []) as unknown as Row[]) {
        result[row.template_line_id] = row.amount === null ? null : Number(row.amount)
      }
      return result
    },
  })
}

export type TemplateMappingRule = MappingRule & { template_line_id: string }

export interface LocalStatementSaveInput {
  header: StatementHeaderInput
  /** Balance sheet + income statement templates used (both UZ NAS forms). */
  templates: StatementTemplate[]
  /** line_code -> amount, across both forms (codes are unique per template;
   *  values are keyed by `${templateCode}:${lineCode}` to stay unambiguous). */
  values: Record<string, number | null>
  mappings: TemplateMappingRule[]
}

/** Key helper: line codes can repeat across forms (F1 '010' vs F2 '010'). */
export function valueKey(templateCode: string, lineCode: string): string {
  return `${templateCode}:${lineCode}`
}

async function saveLocalStatement(
  statementId: string,
  input: LocalStatementSaveInput,
): Promise<void> {
  // 1. Mark stale while re-writing values + mapped result.
  await tci().from('financial_statements').update({ mapping_status: 'stale' }).eq('id', statementId)

  // 2. Replace local values (delete + insert keeps absent lines truly absent).
  const { error: delError } = await tci()
    .from('local_statement_values')
    .delete()
    .eq('statement_id', statementId)
  if (delError) throw delError

  const rows: { statement_id: string; template_line_id: string; amount: number | null }[] = []
  for (const template of input.templates) {
    for (const line of template.statement_template_lines) {
      const amount = input.values[valueKey(template.code, line.line_code)]
      if (amount !== null && amount !== undefined) {
        rows.push({ statement_id: statementId, template_line_id: line.id, amount })
      }
    }
  }
  if (rows.length) {
    const { error } = await tci().from('local_statement_values').insert(rows)
    if (error) throw error
  }

  // 3. Run the mapping per form and materialize the IFRS rows.
  const bsTemplate = input.templates.find((t) => t.form_kind === 'balance_sheet')
  const isTemplate = input.templates.find((t) => t.form_kind === 'income_statement')

  const valuesFor = (template: StatementTemplate | undefined): Record<string, number | null> => {
    if (!template) return {}
    const out: Record<string, number | null> = {}
    for (const line of template.statement_template_lines) {
      const v = input.values[valueKey(template.code, line.line_code)]
      if (v !== null && v !== undefined) out[line.line_code] = v
    }
    return out
  }

  const lineIds = (template: StatementTemplate | undefined): Set<string> =>
    new Set(template?.statement_template_lines.map((l) => l.id) ?? [])

  const bsMapped = mapLocalStatement(
    bsTemplate?.code ?? '',
    valuesFor(bsTemplate),
    input.mappings.filter((m) => lineIds(bsTemplate).has(m.template_line_id)),
  )
  const isMapped = mapLocalStatement(
    isTemplate?.code ?? '',
    valuesFor(isTemplate),
    input.mappings.filter((m) => lineIds(isTemplate).has(m.template_line_id)),
  )

  const { error: bsError } = await tci()
    .from('balance_sheets')
    .upsert({ statement_id: statementId, ...bsMapped.balanceSheet })
  if (bsError) throw bsError
  const { error: isError } = await tci()
    .from('income_statements')
    .upsert({ statement_id: statementId, ...isMapped.incomeStatement })
  if (isError) throw isError

  // 4. Done.
  const { error: statusError } = await tci()
    .from('financial_statements')
    .update({ mapping_status: 'mapped' })
    .eq('id', statementId)
  if (statusError) throw statusError
}

export function useCreateLocalStatement(entityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: LocalStatementSaveInput) => {
      const { data, error } = await tci()
        .from('financial_statements')
        .insert(input.header)
        .select('id')
        .single()
      if (error) throw error
      await saveLocalStatement((data as { id: string }).id, input)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buyers', entityId, 'statements'] })
      void queryClient.invalidateQueries({ queryKey: ['buyers'] })
    },
  })
}

export function useUpdateLocalStatement(entityId: string, statementId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: LocalStatementSaveInput) => {
      const { error } = await tci()
        .from('financial_statements')
        .update(input.header)
        .eq('id', statementId)
      if (error) throw error
      await saveLocalStatement(statementId, input)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['buyers', entityId, 'statements'] })
      void queryClient.invalidateQueries({ queryKey: ['statements', statementId, 'local-values'] })
    },
  })
}
