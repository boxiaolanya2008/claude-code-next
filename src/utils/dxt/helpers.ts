import type { McpbManifest } from '@anthropic-ai/mcpb'
import { errorMessage } from '../errors.js'
import { jsonParse } from '../slowOperations.js'

export async function validateManifest(
  manifestJson: unknown,
): Promise<McpbManifest> {
  const { McpbManifestSchema } = await import('@anthropic-ai/mcpb')
  const parseResult = McpbManifestSchema.safeParse(manifestJson)

  if (!parseResult.success) {
    const errors = parseResult.error.flatten()
    const errorMessages = [
      ...Object.entries(errors.fieldErrors).map(
        ([field, errs]) => `${field}: ${errs?.join(', ')}`,
      ),
      ...(errors.formErrors || []),
    ]
      .filter(Boolean)
      .join('; ')

    throw new Error(`Invalid manifest: ${errorMessages}`)
  }

  return parseResult.data
}

export async function parseAndValidateManifestFromText(
  manifestText: string,
): Promise<McpbManifest> {
  let manifestJson: unknown

  try {
    manifestJson = jsonParse(manifestText)
  } catch (error) {
    throw new Error(`Invalid JSON in manifest.json: ${errorMessage(error)}`)
  }

  return validateManifest(manifestJson)
}

export async function parseAndValidateManifestFromBytes(
  manifestData: Uint8Array,
): Promise<McpbManifest> {
  const manifestText = new TextDecoder().decode(manifestData)
  return parseAndValidateManifestFromText(manifestText)
}

export function generateExtensionId(
  manifest: McpbManifest,
  prefix?: 'local.unpacked' | 'local.dxt',
): string {
  const sanitize = (str: string) =>
    str
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_.]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')

  const authorName = manifest.author.name
  const extensionName = manifest.name

  const sanitizedAuthor = sanitize(authorName)
  const sanitizedName = sanitize(extensionName)

  return prefix
    ? `${prefix}.${sanitizedAuthor}.${sanitizedName}`
    : `${sanitizedAuthor}.${sanitizedName}`
}
