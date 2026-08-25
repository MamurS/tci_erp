/** Excel export of a rendered analysis table (SheetJS). */
import * as XLSX from 'xlsx'

export function exportTableToExcel(container: HTMLElement | null, fileName: string): void {
  const table = container?.querySelector('table')
  if (!table) return
  const workbook = XLSX.utils.table_to_book(table)
  XLSX.writeFile(workbook, fileName)
}

export function exportFileName(buyer: string, tab: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const safe = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, '_')
  return `${safe(buyer)}_${safe(tab)}_${date}.xlsx`
}
