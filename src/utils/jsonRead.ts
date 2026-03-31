

const UTF8_BOM = '\uFEFF'

export function stripBOM(content: string): string {
  return content.startsWith(UTF8_BOM) ? content.slice(1) : content
}
