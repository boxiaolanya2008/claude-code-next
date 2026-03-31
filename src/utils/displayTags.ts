

const XML_TAG_BLOCK_PATTERN = /<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>\n?/g

export function stripDisplayTags(text: string): string {
  const result = text.replace(XML_TAG_BLOCK_PATTERN, '').trim()
  return result || text
}

export function stripDisplayTagsAllowEmpty(text: string): string {
  return text.replace(XML_TAG_BLOCK_PATTERN, '').trim()
}

const IDE_CONTEXT_TAGS_PATTERN =
  /<(ide_opened_file|ide_selection)(?:\s[^>]*)?>[\s\S]*?<\/\1>\n?/g

export function stripIdeContextTags(text: string): string {
  return text.replace(IDE_CONTEXT_TAGS_PATTERN, '').trim()
}
