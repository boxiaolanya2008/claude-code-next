import type { Dirent, Stats } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import * as path from 'path'
import { z } from 'zod/v4'
import { errorMessage, getErrnoCode, isENOENT } from '../errors.js'
import { FRONTMATTER_REGEX } from '../frontmatterParser.js'
import { jsonParse } from '../slowOperations.js'
import { parseYaml } from '../yaml.js'
import {
  PluginHooksSchema,
  PluginManifestSchema,
  PluginMarketplaceEntrySchema,
  PluginMarketplaceSchema,
} from './schemas.js'

const MARKETPLACE_ONLY_MANIFEST_FIELDS = new Set([
  'category',
  'source',
  'tags',
  'strict',
  'id',
])

export type ValidationResult = {
  success: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  filePath: string
  fileType: 'plugin' | 'marketplace' | 'skill' | 'agent' | 'command' | 'hooks'
}

export type ValidationError = {
  path: string
  message: string
  code?: string
}

export type ValidationWarning = {
  path: string
  message: string
}

function detectManifestType(
  filePath: string,
): 'plugin' | 'marketplace' | 'unknown' {
  const fileName = path.basename(filePath)
  const dirName = path.basename(path.dirname(filePath))

  
  if (fileName === 'plugin.json') return 'plugin'
  if (fileName === 'marketplace.json') return 'marketplace'

  
  if (dirName === '.claude-plugin') {
    return 'plugin' 
  }

  return 'unknown'
}

function formatZodErrors(zodError: z.ZodError): ValidationError[] {
  return zodError.issues.map(error => ({
    path: error.path.join('.') || 'root',
    message: error.message,
    code: error.code,
  }))
}

function checkPathTraversal(
  p: string,
  field: string,
  errors: ValidationError[],
  hint?: string,
): void {
  if (p.includes('..')) {
    errors.push({
      path: field,
      message: hint
        ? `Path contains "..": ${p}. ${hint}`
        : `Path contains ".." which could be a path traversal attempt: ${p}`,
    })
  }
}

function marketplaceSourceHint(p: string): string {
  
  
  
  const stripped = p.replace(/^(\.\.\/)+/, '')
  const corrected = stripped !== p ? `./${stripped}` : './plugins/my-plugin'
  return (
    'Plugin source paths are resolved relative to the marketplace root (the directory ' +
    'containing .claude-plugin/), not relative to marketplace.json. ' +
    `Use "${corrected}" instead of "${p}".`
  )
}

export async function validatePluginManifest(
  filePath: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const absolutePath = path.resolve(filePath)

  
  let content: string
  try {
    content = await readFile(absolutePath, { encoding: 'utf-8' })
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    let message: string
    if (code === 'ENOENT') {
      message = `File not found: ${absolutePath}`
    } else if (code === 'EISDIR') {
      message = `Path is not a file: ${absolutePath}`
    } else {
      message = `Failed to read file: ${errorMessage(error)}`
    }
    return {
      success: false,
      errors: [{ path: 'file', message, code }],
      warnings: [],
      filePath: absolutePath,
      fileType: 'plugin',
    }
  }

  let parsed: unknown
  try {
    parsed = jsonParse(content)
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'json',
          message: `Invalid JSON syntax: ${errorMessage(error)}`,
        },
      ],
      warnings: [],
      filePath: absolutePath,
      fileType: 'plugin',
    }
  }

  
  
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>

    
    if (obj.commands) {
      const commands = Array.isArray(obj.commands)
        ? obj.commands
        : [obj.commands]
      commands.forEach((cmd, i) => {
        if (typeof cmd === 'string') {
          checkPathTraversal(cmd, `commands[${i}]`, errors)
        }
      })
    }

    
    if (obj.agents) {
      const agents = Array.isArray(obj.agents) ? obj.agents : [obj.agents]
      agents.forEach((agent, i) => {
        if (typeof agent === 'string') {
          checkPathTraversal(agent, `agents[${i}]`, errors)
        }
      })
    }

    
    if (obj.skills) {
      const skills = Array.isArray(obj.skills) ? obj.skills : [obj.skills]
      skills.forEach((skill, i) => {
        if (typeof skill === 'string') {
          checkPathTraversal(skill, `skills[${i}]`, errors)
        }
      })
    }
  }

  
  
  
  
  
  
  let toValidate = parsed
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>
    const strayKeys = Object.keys(obj).filter(k =>
      MARKETPLACE_ONLY_MANIFEST_FIELDS.has(k),
    )
    if (strayKeys.length > 0) {
      const stripped = { ...obj }
      for (const key of strayKeys) {
        delete stripped[key]
        warnings.push({
          path: key,
          message:
            `Field '${key}' belongs in the marketplace entry (marketplace.json), ` +
            `not plugin.json. It's harmless here but unused — Claude Code Next ` +
            `ignores it at load time.`,
        })
      }
      toValidate = stripped
    }
  }

  
  
  
  
  const result = PluginManifestSchema().strict().safeParse(toValidate)

  if (!result.success) {
    errors.push(...formatZodErrors(result.error))
  }

  
  if (result.success) {
    const manifest = result.data

    
    
    
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name)) {
      warnings.push({
        path: 'name',
        message:
          `Plugin name "${manifest.name}" is not kebab-case. Claude Code Next accepts ` +
          `it, but the Claude.ai marketplace sync requires kebab-case ` +
          `(lowercase letters, digits, and hyphens only, e.g., "my-plugin").`,
      })
    }

    
    if (!manifest.version) {
      warnings.push({
        path: 'version',
        message:
          'No version specified. Consider adding a version following semver (e.g., "1.0.0")',
      })
    }

    
    if (!manifest.description) {
      warnings.push({
        path: 'description',
        message:
          'No description provided. Adding a description helps users understand what your plugin does',
      })
    }

    
    if (!manifest.author) {
      warnings.push({
        path: 'author',
        message:
          'No author information provided. Consider adding author details for plugin attribution',
      })
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    filePath: absolutePath,
    fileType: 'plugin',
  }
}

export async function validateMarketplaceManifest(
  filePath: string,
): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const absolutePath = path.resolve(filePath)

  
  let content: string
  try {
    content = await readFile(absolutePath, { encoding: 'utf-8' })
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    let message: string
    if (code === 'ENOENT') {
      message = `File not found: ${absolutePath}`
    } else if (code === 'EISDIR') {
      message = `Path is not a file: ${absolutePath}`
    } else {
      message = `Failed to read file: ${errorMessage(error)}`
    }
    return {
      success: false,
      errors: [{ path: 'file', message, code }],
      warnings: [],
      filePath: absolutePath,
      fileType: 'marketplace',
    }
  }

  let parsed: unknown
  try {
    parsed = jsonParse(content)
  } catch (error) {
    return {
      success: false,
      errors: [
        {
          path: 'json',
          message: `Invalid JSON syntax: ${errorMessage(error)}`,
        },
      ],
      warnings: [],
      filePath: absolutePath,
      fileType: 'marketplace',
    }
  }

  
  
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>

    if (Array.isArray(obj.plugins)) {
      obj.plugins.forEach((plugin: unknown, i: number) => {
        if (plugin && typeof plugin === 'object' && 'source' in plugin) {
          const source = (plugin as { source: unknown }).source
          
          if (typeof source === 'string') {
            checkPathTraversal(
              source,
              `plugins[${i}].source`,
              errors,
              marketplaceSourceHint(source),
            )
          }
          
          
          
          
          if (
            source &&
            typeof source === 'object' &&
            'path' in source &&
            typeof (source as { path: unknown }).path === 'string'
          ) {
            checkPathTraversal(
              (source as { path: string }).path,
              `plugins[${i}].source.path`,
              errors,
            )
          }
        }
      })
    }
  }

  
  
  
  
  
  
  const strictMarketplaceSchema = PluginMarketplaceSchema()
    .extend({
      plugins: z.array(PluginMarketplaceEntrySchema().strict()),
    })
    .strict()
  const result = strictMarketplaceSchema.safeParse(parsed)

  if (!result.success) {
    errors.push(...formatZodErrors(result.error))
  }

  
  if (result.success) {
    const marketplace = result.data

    
    if (!marketplace.plugins || marketplace.plugins.length === 0) {
      warnings.push({
        path: 'plugins',
        message: 'Marketplace has no plugins defined',
      })
    }

    
    if (marketplace.plugins) {
      marketplace.plugins.forEach((plugin, i) => {
        
        const duplicates = marketplace.plugins.filter(
          p => p.name === plugin.name,
        )
        if (duplicates.length > 1) {
          errors.push({
            path: `plugins[${i}].name`,
            message: `Duplicate plugin name "${plugin.name}" found in marketplace`,
          })
        }
      })

      
      
      
      
      
      
      
      const manifestDir = path.dirname(absolutePath)
      const marketplaceRoot =
        path.basename(manifestDir) === '.claude-plugin'
          ? path.dirname(manifestDir)
          : manifestDir
      for (const [i, entry] of marketplace.plugins.entries()) {
        if (
          !entry.version ||
          typeof entry.source !== 'string' ||
          !entry.source.startsWith('./')
        ) {
          continue
        }
        const pluginJsonPath = path.join(
          marketplaceRoot,
          entry.source,
          '.claude-plugin',
          'plugin.json',
        )
        let manifestVersion: string | undefined
        try {
          const raw = await readFile(pluginJsonPath, { encoding: 'utf-8' })
          const parsed = jsonParse(raw) as { version?: unknown }
          if (typeof parsed.version === 'string') {
            manifestVersion = parsed.version
          }
        } catch {
          
          continue
        }
        if (manifestVersion && manifestVersion !== entry.version) {
          warnings.push({
            path: `plugins[${i}].version`,
            message:
              `Entry declares version "${entry.version}" but ${entry.source}/.claude-plugin/plugin.json says "${manifestVersion}". ` +
              `At install time, plugin.json wins (calculatePluginVersion precedence) — the entry version is silently ignored. ` +
              `Update this entry to "${manifestVersion}" to match.`,
          })
        }
      }
    }

    
    if (!marketplace.metadata?.description) {
      warnings.push({
        path: 'metadata.description',
        message:
          'No marketplace description provided. Adding a description helps users understand what this marketplace offers',
      })
    }
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
    filePath: absolutePath,
    fileType: 'marketplace',
  }
}

function validateComponentFile(
  filePath: string,
  content: string,
  fileType: 'skill' | 'agent' | 'command',
): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  const match = content.match(FRONTMATTER_REGEX)
  if (!match) {
    warnings.push({
      path: 'frontmatter',
      message:
        'No frontmatter block found. Add YAML frontmatter between --- delimiters ' +
        'at the top of the file to set description and other metadata.',
    })
    return { success: true, errors, warnings, filePath, fileType }
  }

  const frontmatterText = match[1] || ''
  let parsed: unknown
  try {
    parsed = parseYaml(frontmatterText)
  } catch (e) {
    errors.push({
      path: 'frontmatter',
      message:
        `YAML frontmatter failed to parse: ${errorMessage(e)}. ` +
        `At runtime this ${fileType} loads with empty metadata (all frontmatter ` +
        `fields silently dropped).`,
    })
    return { success: false, errors, warnings, filePath, fileType }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push({
      path: 'frontmatter',
      message:
        'Frontmatter must be a YAML mapping (key: value pairs), got ' +
        `${Array.isArray(parsed) ? 'an array' : parsed === null ? 'null' : typeof parsed}.`,
    })
    return { success: false, errors, warnings, filePath, fileType }
  }

  const fm = parsed as Record<string, unknown>

  
  if (fm.description !== undefined) {
    const d = fm.description
    if (
      typeof d !== 'string' &&
      typeof d !== 'number' &&
      typeof d !== 'boolean' &&
      d !== null
    ) {
      errors.push({
        path: 'description',
        message:
          `description must be a string, got ${Array.isArray(d) ? 'array' : typeof d}. ` +
          `At runtime this value is dropped.`,
      })
    }
  } else {
    warnings.push({
      path: 'description',
      message:
        `No description in frontmatter. A description helps users and Claude ` +
        `understand when to use this ${fileType}.`,
    })
  }

  
  
  if (
    fm.name !== undefined &&
    fm.name !== null &&
    typeof fm.name !== 'string'
  ) {
    errors.push({
      path: 'name',
      message: `name must be a string, got ${typeof fm.name}.`,
    })
  }

  
  const at = fm['allowed-tools']
  if (at !== undefined && at !== null) {
    if (typeof at !== 'string' && !Array.isArray(at)) {
      errors.push({
        path: 'allowed-tools',
        message: `allowed-tools must be a string or array of strings, got ${typeof at}.`,
      })
    } else if (Array.isArray(at) && at.some(t => typeof t !== 'string')) {
      errors.push({
        path: 'allowed-tools',
        message: 'allowed-tools array must contain only strings.',
      })
    }
  }

  
  const sh = fm.shell
  if (sh !== undefined && sh !== null) {
    if (typeof sh !== 'string') {
      errors.push({
        path: 'shell',
        message: `shell must be a string, got ${typeof sh}.`,
      })
    } else {
      
      
      const normalized = sh.trim().toLowerCase()
      if (normalized !== 'bash' && normalized !== 'powershell') {
        errors.push({
          path: 'shell',
          message: `shell must be 'bash' or 'powershell', got '${sh}'.`,
        })
      }
    }
  }

  return { success: errors.length === 0, errors, warnings, filePath, fileType }
}

async function validateHooksJson(filePath: string): Promise<ValidationResult> {
  let content: string
  try {
    content = await readFile(filePath, { encoding: 'utf-8' })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    
    if (code === 'ENOENT') {
      return {
        success: true,
        errors: [],
        warnings: [],
        filePath,
        fileType: 'hooks',
      }
    }
    return {
      success: false,
      errors: [
        { path: 'file', message: `Failed to read file: ${errorMessage(e)}` },
      ],
      warnings: [],
      filePath,
      fileType: 'hooks',
    }
  }

  let parsed: unknown
  try {
    parsed = jsonParse(content)
  } catch (e) {
    return {
      success: false,
      errors: [
        {
          path: 'json',
          message:
            `Invalid JSON syntax: ${errorMessage(e)}. ` +
            `At runtime this breaks the entire plugin load.`,
        },
      ],
      warnings: [],
      filePath,
      fileType: 'hooks',
    }
  }

  const result = PluginHooksSchema().safeParse(parsed)
  if (!result.success) {
    return {
      success: false,
      errors: formatZodErrors(result.error),
      warnings: [],
      filePath,
      fileType: 'hooks',
    }
  }

  return {
    success: true,
    errors: [],
    warnings: [],
    filePath,
    fileType: 'hooks',
  }
}

async function collectMarkdown(
  dir: string,
  isSkillsDir: boolean,
): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code === 'ENOENT' || code === 'ENOTDIR') return []
    throw e
  }

  
  
  
  
  if (isSkillsDir) {
    return entries
      .filter(e => e.isDirectory())
      .map(e => path.join(dir, e.name, 'SKILL.md'))
  }

  
  const out: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdown(full, false)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

export async function validatePluginContents(
  pluginDir: string,
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []

  const dirs: Array<['skill' | 'agent' | 'command', string]> = [
    ['skill', path.join(pluginDir, 'skills')],
    ['agent', path.join(pluginDir, 'agents')],
    ['command', path.join(pluginDir, 'commands')],
  ]

  for (const [fileType, dir] of dirs) {
    const files = await collectMarkdown(dir, fileType === 'skill')
    for (const filePath of files) {
      let content: string
      try {
        content = await readFile(filePath, { encoding: 'utf-8' })
      } catch (e: unknown) {
        
        if (isENOENT(e)) continue
        results.push({
          success: false,
          errors: [
            { path: 'file', message: `Failed to read: ${errorMessage(e)}` },
          ],
          warnings: [],
          filePath,
          fileType,
        })
        continue
      }
      const r = validateComponentFile(filePath, content, fileType)
      if (r.errors.length > 0 || r.warnings.length > 0) {
        results.push(r)
      }
    }
  }

  const hooksResult = await validateHooksJson(
    path.join(pluginDir, 'hooks', 'hooks.json'),
  )
  if (hooksResult.errors.length > 0 || hooksResult.warnings.length > 0) {
    results.push(hooksResult)
  }

  return results
}

export async function validateManifest(
  filePath: string,
): Promise<ValidationResult> {
  const absolutePath = path.resolve(filePath)

  
  let stats: Stats | null = null
  try {
    stats = await stat(absolutePath)
  } catch (e: unknown) {
    if (!isENOENT(e)) {
      throw e
    }
  }

  if (stats?.isDirectory()) {
    
    
    const marketplacePath = path.join(
      absolutePath,
      '.claude-plugin',
      'marketplace.json',
    )
    const marketplaceResult = await validateMarketplaceManifest(marketplacePath)
    
    if (marketplaceResult.errors[0]?.code !== 'ENOENT') {
      return marketplaceResult
    }

    const pluginPath = path.join(absolutePath, '.claude-plugin', 'plugin.json')
    const pluginResult = await validatePluginManifest(pluginPath)
    if (pluginResult.errors[0]?.code !== 'ENOENT') {
      return pluginResult
    }

    return {
      success: false,
      errors: [
        {
          path: 'directory',
          message: `No manifest found in directory. Expected .claude-plugin/marketplace.json or .claude-plugin/plugin.json`,
        },
      ],
      warnings: [],
      filePath: absolutePath,
      fileType: 'plugin',
    }
  }

  const manifestType = detectManifestType(filePath)

  switch (manifestType) {
    case 'plugin':
      return validatePluginManifest(filePath)
    case 'marketplace':
      return validateMarketplaceManifest(filePath)
    case 'unknown': {
      
      try {
        const content = await readFile(absolutePath, { encoding: 'utf-8' })
        const parsed = jsonParse(content) as Record<string, unknown>

        
        if (Array.isArray(parsed.plugins)) {
          return validateMarketplaceManifest(filePath)
        }
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code === 'ENOENT') {
          return {
            success: false,
            errors: [
              {
                path: 'file',
                message: `File not found: ${absolutePath}`,
              },
            ],
            warnings: [],
            filePath: absolutePath,
            fileType: 'plugin', 
          }
        }
        
      }

      
      return validatePluginManifest(filePath)
    }
  }
}
