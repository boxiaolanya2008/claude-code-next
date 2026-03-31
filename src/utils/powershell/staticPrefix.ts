

import { getCommandSpec } from '../bash/registry.js'
import { buildPrefix, DEPTH_RULES } from '../shell/specPrefix.js'
import { countCharInString } from '../stringUtils.js'
import { NEVER_SUGGEST } from './dangerousCmdlets.js'
import {
  getAllCommands,
  type ParsedCommandElement,
  parsePowerShellCommand,
} from './parser.js'

async function extractPrefixFromElement(
  cmd: ParsedCommandElement,
): Promise<string | null> {
  
  
  
  if (cmd.nameType === 'application') {
    return null
  }

  const name = cmd.name
  if (!name) {
    return null
  }

  if (NEVER_SUGGEST.has(name.toLowerCase())) {
    return null
  }

  
  
  if (cmd.nameType === 'cmdlet') {
    return name
  }

  
  
  
  
  
  
  
  
  
  
  if (cmd.elementTypes?.[0] !== 'StringConstant') {
    return null
  }
  for (let i = 0; i < cmd.args.length; i++) {
    const t = cmd.elementTypes[i + 1]
    if (t !== 'StringConstant' && t !== 'Parameter') {
      return null
    }
  }

  
  
  
  
  
  
  
  
  
  
  const nameLower = name.toLowerCase()
  const spec = await getCommandSpec(nameLower)
  const prefix = await buildPrefix(name, cmd.args, spec)

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  let argIdx = 0
  for (const word of prefix.split(' ').slice(1)) {
    if (word.includes('\\')) return null
    while (argIdx < cmd.args.length) {
      const a = cmd.args[argIdx]!
      if (a === word) break
      if (a.startsWith('-')) {
        argIdx++
        
        
        
        if (
          spec?.options &&
          argIdx < cmd.args.length &&
          cmd.args[argIdx] !== word &&
          !cmd.args[argIdx]!.startsWith('-')
        ) {
          const flagLower = a.toLowerCase()
          const opt = spec.options.find(o =>
            Array.isArray(o.name)
              ? o.name.includes(flagLower)
              : o.name === flagLower,
          )
          if (opt?.args) {
            argIdx++
          }
        }
        continue
      }
      
      return null
    }
    if (argIdx >= cmd.args.length) return null
    argIdx++
  }

  
  
  
  
  
  
  
  if (
    !prefix.includes(' ') &&
    (spec?.subcommands?.length || DEPTH_RULES[nameLower])
  ) {
    return null
  }
  return prefix
}

export async function getCommandPrefixStatic(
  command: string,
): Promise<{ commandPrefix: string | null } | null> {
  const parsed = await parsePowerShellCommand(command)
  if (!parsed.valid) {
    return null
  }

  
  
  
  
  const firstCommand = getAllCommands(parsed).find(
    cmd => cmd.elementType === 'CommandAst',
  )
  if (!firstCommand) {
    return { commandPrefix: null }
  }

  return { commandPrefix: await extractPrefixFromElement(firstCommand) }
}

export async function getCompoundCommandPrefixesStatic(
  command: string,
  excludeSubcommand?: (element: ParsedCommandElement) => boolean,
): Promise<string[]> {
  const parsed = await parsePowerShellCommand(command)
  if (!parsed.valid) {
    return []
  }

  const commands = getAllCommands(parsed).filter(
    cmd => cmd.elementType === 'CommandAst',
  )

  
  if (commands.length <= 1) {
    const prefix = commands[0]
      ? await extractPrefixFromElement(commands[0])
      : null
    return prefix ? [prefix] : []
  }

  const prefixes: string[] = []
  for (const cmd of commands) {
    if (excludeSubcommand?.(cmd)) {
      continue
    }
    const prefix = await extractPrefixFromElement(cmd)
    if (prefix) {
      prefixes.push(prefix)
    }
  }

  if (prefixes.length === 0) {
    return []
  }

  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const groups = new Map<string, string[]>()
  for (const prefix of prefixes) {
    const root = prefix.split(' ')[0]!
    const key = root.toLowerCase()
    const group = groups.get(key)
    if (group) {
      group.push(prefix)
    } else {
      groups.set(key, [prefix])
    }
  }

  const collapsed: string[] = []
  for (const [rootLower, group] of groups) {
    const lcp = wordAlignedLCP(group)
    const lcpWordCount = lcp === '' ? 0 : countCharInString(lcp, ' ') + 1
    if (lcpWordCount <= 1) {
      
      
      
      
      const rootSpec = await getCommandSpec(rootLower)
      if (rootSpec?.subcommands?.length || DEPTH_RULES[rootLower]) {
        continue
      }
    }
    collapsed.push(lcp)
  }
  return collapsed
}

function wordAlignedLCP(strings: string[]): string {
  if (strings.length === 0) return ''
  if (strings.length === 1) return strings[0]!

  const firstWords = strings[0]!.split(' ')
  let commonWordCount = firstWords.length

  for (let i = 1; i < strings.length; i++) {
    const words = strings[i]!.split(' ')
    let matchCount = 0
    while (
      matchCount < commonWordCount &&
      matchCount < words.length &&
      words[matchCount]!.toLowerCase() === firstWords[matchCount]!.toLowerCase()
    ) {
      matchCount++
    }
    commonWordCount = matchCount
    if (commonWordCount === 0) break
  }

  return firstWords.slice(0, commonWordCount).join(' ')
}
