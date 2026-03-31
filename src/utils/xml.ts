

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeXmlAttr(s: string): string {
  return escapeXml(s).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}
