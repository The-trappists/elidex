// Client-side file download from data already loaded in the page.
export function downloadText(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(cell).join(',')).join('\n')

export type ExportFormat = 'csv' | 'json' | 'markdown'
export const EXPORT_FORMATS: { id: ExportFormat; label: string; help: string; ext: string; mime: string }[] = [
  { id: 'csv', label: 'CSV', help: 'One row per item, for spreadsheets', ext: 'csv', mime: 'text/csv' },
  { id: 'json', label: 'JSON', help: 'Every field, for programs', ext: 'json', mime: 'application/json' },
  { id: 'markdown', label: 'Markdown', help: 'A readable document', ext: 'md', mime: 'text/markdown' },
]
