import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { constants as fsConstants } from 'fs'
import { mkdir, open } from 'fs/promises'
import { dirname, isAbsolute, join, normalize, sep as pathSep } from 'path'
import type { ToolUseContext } from '../Tool.js'
import type { Command } from '../types/command.js'
import { logForDebugging } from '../utils/debug.js'
import { getBundledSkillsRoot } from '../utils/permissions/filesystem.js'
import type { HooksSettings } from '../utils/settings/types.js'

export type BundledSkillDefinition = {
  name: string
  description: string
  aliases?: string[]
  whenToUse?: string
  argumentHint?: string
  allowedTools?: string[]
  model?: string
  disableModelInvocation?: boolean
  userInvocable?: boolean
  isEnabled?: () => boolean
  hooks?: HooksSettings
  context?: 'inline' | 'fork'
  agent?: string
  

  files?: Record<string, string>
  getPromptForCommand: (
    args: string,
    context: ToolUseContext,
  ) => Promise<ContentBlockParam[]>
}

const bundledSkills: Command[] = []

export function registerBundledSkill(definition: BundledSkillDefinition): void {
  const { files } = definition

  let skillRoot: string | undefined
  let getPromptForCommand = definition.getPromptForCommand

  if (files && Object.keys(files).length > 0) {
    skillRoot = getBundledSkillExtractDir(definition.name)
    
    
    
    let extractionPromise: Promise<string | null> | undefined
    const inner = definition.getPromptForCommand
    getPromptForCommand = async (args, ctx) => {
      extractionPromise ??= extractBundledSkillFiles(definition.name, files)
      const extractedDir = await extractionPromise
      const blocks = await inner(args, ctx)
      if (extractedDir === null) return blocks
      return prependBaseDir(blocks, extractedDir)
    }
  }

  const command: Command = {
    type: 'prompt',
    name: definition.name,
    description: definition.description,
    aliases: definition.aliases,
    hasUserSpecifiedDescription: true,
    allowedTools: definition.allowedTools ?? [],
    argumentHint: definition.argumentHint,
    whenToUse: definition.whenToUse,
    model: definition.model,
    disableModelInvocation: definition.disableModelInvocation ?? false,
    userInvocable: definition.userInvocable ?? true,
    contentLength: 0, 
    source: 'bundled',
    loadedFrom: 'bundled',
    hooks: definition.hooks,
    skillRoot,
    context: definition.context,
    agent: definition.agent,
    isEnabled: definition.isEnabled,
    isHidden: !(definition.userInvocable ?? true),
    progressMessage: 'running',
    getPromptForCommand,
  }
  bundledSkills.push(command)
}

export function getBundledSkills(): Command[] {
  return [...bundledSkills]
}

export function clearBundledSkills(): void {
  bundledSkills.length = 0
}

export function getBundledSkillExtractDir(skillName: string): string {
  return join(getBundledSkillsRoot(), skillName)
}

async function extractBundledSkillFiles(
  skillName: string,
  files: Record<string, string>,
): Promise<string | null> {
  const dir = getBundledSkillExtractDir(skillName)
  try {
    await writeSkillFiles(dir, files)
    return dir
  } catch (e) {
    logForDebugging(
      `Failed to extract bundled skill '${skillName}' to ${dir}: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

async function writeSkillFiles(
  dir: string,
  files: Record<string, string>,
): Promise<void> {
  
  const byParent = new Map<string, [string, string][]>()
  for (const [relPath, content] of Object.entries(files)) {
    const target = resolveSkillFilePath(dir, relPath)
    const parent = dirname(target)
    const entry: [string, string] = [target, content]
    const group = byParent.get(parent)
    if (group) group.push(entry)
    else byParent.set(parent, [entry])
  }
  await Promise.all(
    [...byParent].map(async ([parent, entries]) => {
      await mkdir(parent, { recursive: true, mode: 0o700 })
      await Promise.all(entries.map(([p, c]) => safeWriteFile(p, c)))
    }),
  )
}

const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0

const SAFE_WRITE_FLAGS =
  process.platform === 'win32'
    ? 'wx'
    : fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      O_NOFOLLOW

async function safeWriteFile(p: string, content: string): Promise<void> {
  const fh = await open(p, SAFE_WRITE_FLAGS, 0o600)
  try {
    await fh.writeFile(content, 'utf8')
  } finally {
    await fh.close()
  }
}

function resolveSkillFilePath(baseDir: string, relPath: string): string {
  const normalized = normalize(relPath)
  if (
    isAbsolute(normalized) ||
    normalized.split(pathSep).includes('..') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`bundled skill file path escapes skill dir: ${relPath}`)
  }
  return join(baseDir, normalized)
}

function prependBaseDir(
  blocks: ContentBlockParam[],
  baseDir: string,
): ContentBlockParam[] {
  const prefix = `Base directory for this skill: ${baseDir}\n\n`
  if (blocks.length > 0 && blocks[0]!.type === 'text') {
    return [
      { type: 'text', text: prefix + blocks[0]!.text },
      ...blocks.slice(1),
    ]
  }
  return [{ type: 'text', text: prefix }, ...blocks]
}
