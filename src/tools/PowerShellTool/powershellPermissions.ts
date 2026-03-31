

import { resolve } from 'path'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import type {
  PermissionDecisionReason,
  PermissionResult,
} from '../../types/permissions.js'
import { getCwd } from '../../utils/cwd.js'
import { isCurrentDirectoryBareGitRepo } from '../../utils/git.js'
import type { PermissionRule } from '../../utils/permissions/PermissionRule.js'
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'
import {
  createPermissionRequestMessage,
  getRuleByContentsForToolName,
} from '../../utils/permissions/permissions.js'
import {
  matchWildcardPattern,
  parsePermissionRule,
  type ShellPermissionRule,
  suggestionForExactCommand as sharedSuggestionForExactCommand,
} from '../../utils/permissions/shellRuleMatching.js'
import {
  classifyCommandName,
  deriveSecurityFlags,
  getAllCommandNames,
  getFileRedirections,
  type ParsedCommandElement,
  type ParsedPowerShellCommand,
  PS_TOKENIZER_DASH_CHARS,
  parsePowerShellCommand,
  stripModulePrefix,
} from '../../utils/powershell/parser.js'
import { containsVulnerableUncPath } from '../../utils/shell/readOnlyCommandValidation.js'
import { isDotGitPathPS, isGitInternalPathPS } from './gitSafety.js'
import {
  checkPermissionMode,
  isSymlinkCreatingCommand,
} from './modeValidation.js'
import {
  checkPathConstraints,
  dangerousRemovalDeny,
  isDangerousRemovalRawPath,
} from './pathValidation.js'
import { powershellCommandIsSafe } from './powershellSecurity.js'
import {
  argLeaksValue,
  isAllowlistedCommand,
  isCwdChangingCmdlet,
  isProvablySafeStatement,
  isReadOnlyCommand,
  isSafeOutputCommand,
  resolveToCanonical,
} from './readOnlyValidation.js'
import { POWERSHELL_TOOL_NAME } from './toolName.js'

const PS_ASSIGN_PREFIX_RE = /^\$[\w:]+\s*(?:[+\-*/%]|\?\?)?\s*=\s*/

const GIT_SAFETY_WRITE_CMDLETS = new Set([
  'new-item',
  'set-content',
  'add-content',
  'out-file',
  'copy-item',
  'move-item',
  'rename-item',
  'expand-archive',
  'invoke-webrequest',
  'invoke-restmethod',
  'tee-object',
  'export-csv',
  'export-clixml',
])

const GIT_SAFETY_ARCHIVE_EXTRACTORS = new Set([
  'tar',
  'tar.exe',
  'bsdtar',
  'bsdtar.exe',
  'unzip',
  'unzip.exe',
  '7z',
  '7z.exe',
  '7za',
  '7za.exe',
  'gzip',
  'gzip.exe',
  'gunzip',
  'gunzip.exe',
  'expand-archive',
])

async function extractCommandName(command: string): Promise<string> {
  const trimmed = command.trim()
  if (!trimmed) {
    return ''
  }
  const parsed = await parsePowerShellCommand(trimmed)
  const names = getAllCommandNames(parsed)
  return names[0] ?? ''
}

/**
 * Parse a permission rule string into a structured rule object.
 * Delegates to shared parsePermissionRule.
 */
export function powershellPermissionRule(
  permissionRule: string,
): ShellPermissionRule {
  return parsePermissionRule(permissionRule)
}

/**
 * Generate permission update suggestion for exact command match.
 *
 * Skip exact-command suggestion for commands that can't round-trip cleanly:
 * - Multi-line: newlines don't survive normalization, rule would never match
 * - Literal *: storing `Remove-Item * -Force` verbatim re-parses as a wildcard
 *   rule via hasWildcards() (matches `^Remove-Item .* -Force$`). Escaping to
 *   `\*` creates a dead rule — parsePermissionRule's exact branch returns the
 *   raw string with backslash intact, so `Remove-Item \* -Force` never matches
 *   the incoming `Remove-Item * -Force`. Globs are unsafe to exact-auto-allow
 *   anyway; prefix suggestion still offered. (finding #12)
 */
function suggestionForExactCommand(command: string): PermissionUpdate[] {
  if (command.includes('\n') || command.includes('*')) {
    return []
  }
  return sharedSuggestionForExactCommand(POWERSHELL_TOOL_NAME, command)
}

/**
 * PowerShell input schema type - simplified for initial implementation
 */
type PowerShellInput = {
  command: string
  timeout?: number
}

/**
 * Filter rules by contents matching an input command.
 * PowerShell-specific: uses case-insensitive matching throughout.
 * Follows the same structure as BashTool's local filterRulesByContentsMatchingInput.
 */
function filterRulesByContentsMatchingInput(
  input: PowerShellInput,
  rules: Map<string, PermissionRule>,
  matchMode: 'exact' | 'prefix',
  behavior: 'deny' | 'ask' | 'allow',
): PermissionRule[] {
  const command = input.command.trim()

  function strEquals(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase()
  }
  function strStartsWith(str: string, prefix: string): boolean {
    return str.toLowerCase().startsWith(prefix.toLowerCase())
  }
  // SECURITY: stripModulePrefix on RULE names widens the
  
  
  
  
  function stripModulePrefixForRule(name: string): string {
    if (behavior === 'allow') {
      return name
    }
    return stripModulePrefix(name)
  }

  // Extract the first word (command name) from the input for canonical matching.
  
  
  
  
  const rawCmdName = command.split(/\s+/)[0] ?? ''
  const inputCmdName = stripModulePrefix(rawCmdName)
  const inputCanonical = resolveToCanonical(inputCmdName)

  
  
  
  
  // but prefix rule matching uses `prefix + ' '` (literal space). Without this,
  // `rm\t./x` canonicalizes to `remove-item\t./x` and misses the deny rule
  
  
  
  const rest = command.slice(rawCmdName.length).replace(/^\s+/, ' ')
  const canonicalCommand = inputCanonical + rest

  return Array.from(rules.entries())
    .filter(([ruleContent]) => {
      const rule = powershellPermissionRule(ruleContent)

      
      
      function matchesCommand(cmd: string): boolean {
        switch (rule.type) {
          case 'exact':
            return strEquals(rule.command, cmd)
          case 'prefix':
            switch (matchMode) {
              case 'exact':
                return strEquals(rule.prefix, cmd)
              case 'prefix': {
                if (strEquals(cmd, rule.prefix)) {
                  return true
                }
                return strStartsWith(cmd, rule.prefix + ' ')
              }
            }
            break
          case 'wildcard':
            if (matchMode === 'exact') {
              return false
            }
            return matchWildcardPattern(rule.pattern, cmd, true)
        }
      }

      // Check against the original command
      if (matchesCommand(command)) {
        return true
      }

      // Also check against the canonical form of the command
      
      if (matchesCommand(canonicalCommand)) {
        return true
      }

      // Also resolve the rule's command name to canonical and compare
      // This ensures 'deny rm' also blocks 'Remove-Item'
      // SECURITY: stripModulePrefix applied to DENY/ASK rule command
      // names too, not just input. Otherwise a deny rule written as
      // `Microsoft.PowerShell.Management\Remove-Item:*` is bypassed by `rm`,
      // `del`, or plain `Remove-Item` — resolveToCanonical won't match the
      
      if (rule.type === 'exact') {
        const rawRuleCmdName = rule.command.split(/\s+/)[0] ?? ''
        const ruleCanonical = resolveToCanonical(
          stripModulePrefixForRule(rawRuleCmdName),
        )
        if (ruleCanonical === inputCanonical) {
          // Rule and input resolve to same canonical cmdlet
          
          
          
          
          const ruleRest = rule.command
            .slice(rawRuleCmdName.length)
            .replace(/^\s+/, ' ')
          const inputRest = rest
          if (strEquals(ruleRest, inputRest)) {
            return true
          }
        }
      } else if (rule.type === 'prefix') {
        const rawRuleCmdName = rule.prefix.split(/\s+/)[0] ?? ''
        const ruleCanonical = resolveToCanonical(
          stripModulePrefixForRule(rawRuleCmdName),
        )
        if (ruleCanonical === inputCanonical) {
          const ruleRest = rule.prefix
            .slice(rawRuleCmdName.length)
            .replace(/^\s+/, ' ')
          const canonicalPrefix = inputCanonical + ruleRest
          if (matchMode === 'exact') {
            if (strEquals(canonicalPrefix, canonicalCommand)) {
              return true
            }
          } else {
            if (
              strEquals(canonicalCommand, canonicalPrefix) ||
              strStartsWith(canonicalCommand, canonicalPrefix + ' ')
            ) {
              return true
            }
          }
        }
      } else if (rule.type === 'wildcard') {
        // Resolve the wildcard pattern's command name to canonical and re-match
        // This ensures 'deny rm *' also blocks 'Remove-Item secret.txt'
        const rawRuleCmdName = rule.pattern.split(/\s+/)[0] ?? ''
        const ruleCanonical = resolveToCanonical(
          stripModulePrefixForRule(rawRuleCmdName),
        )
        if (ruleCanonical === inputCanonical && matchMode !== 'exact') {
          // Rebuild the pattern with the canonical cmdlet name
          // Normalize separator same as exact and prefix branches.
          // Without this, a wildcard rule `rm\t*` produces canonicalPattern
          // with a literal tab that never matches the space-normalized
          // canonicalCommand.
          const ruleRest = rule.pattern
            .slice(rawRuleCmdName.length)
            .replace(/^\s+/, ' ')
          const canonicalPattern = inputCanonical + ruleRest
          if (matchWildcardPattern(canonicalPattern, canonicalCommand, true)) {
            return true
          }
        }
      }

      return false
    })
    .map(([, rule]) => rule)
}

/**
 * Get matching rules for input across all rule types (deny, ask, allow)
 */
function matchingRulesForInput(
  input: PowerShellInput,
  toolPermissionContext: ToolPermissionContext,
  matchMode: 'exact' | 'prefix',
) {
  const denyRuleByContents = getRuleByContentsForToolName(
    toolPermissionContext,
    POWERSHELL_TOOL_NAME,
    'deny',
  )
  const matchingDenyRules = filterRulesByContentsMatchingInput(
    input,
    denyRuleByContents,
    matchMode,
    'deny',
  )

  const askRuleByContents = getRuleByContentsForToolName(
    toolPermissionContext,
    POWERSHELL_TOOL_NAME,
    'ask',
  )
  const matchingAskRules = filterRulesByContentsMatchingInput(
    input,
    askRuleByContents,
    matchMode,
    'ask',
  )

  const allowRuleByContents = getRuleByContentsForToolName(
    toolPermissionContext,
    POWERSHELL_TOOL_NAME,
    'allow',
  )
  const matchingAllowRules = filterRulesByContentsMatchingInput(
    input,
    allowRuleByContents,
    matchMode,
    'allow',
  )

  return { matchingDenyRules, matchingAskRules, matchingAllowRules }
}

/**
 * Check if the command is an exact match for a permission rule.
 */
export function powershellToolCheckExactMatchPermission(
  input: PowerShellInput,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  const trimmedCommand = input.command.trim()
  const { matchingDenyRules, matchingAskRules, matchingAllowRules } =
    matchingRulesForInput(input, toolPermissionContext, 'exact')

  if (matchingDenyRules[0] !== undefined) {
    return {
      behavior: 'deny',
      message: `Permission to use ${POWERSHELL_TOOL_NAME} with command ${trimmedCommand} has been denied.`,
      decisionReason: { type: 'rule', rule: matchingDenyRules[0] },
    }
  }

  if (matchingAskRules[0] !== undefined) {
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(POWERSHELL_TOOL_NAME),
      decisionReason: { type: 'rule', rule: matchingAskRules[0] },
    }
  }

  if (matchingAllowRules[0] !== undefined) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'rule', rule: matchingAllowRules[0] },
    }
  }

  const decisionReason: PermissionDecisionReason = {
    type: 'other' as const,
    reason: 'This command requires approval',
  }
  return {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(
      POWERSHELL_TOOL_NAME,
      decisionReason,
    ),
    decisionReason,
    suggestions: suggestionForExactCommand(trimmedCommand),
  }
}

/**
 * Check permission for a PowerShell command including prefix matches.
 */
export function powershellToolCheckPermission(
  input: PowerShellInput,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  const command = input.command.trim()

  // 1. Check exact match first
  const exactMatchResult = powershellToolCheckExactMatchPermission(
    input,
    toolPermissionContext,
  )

  // 1a. Deny/ask if exact command has a rule
  if (
    exactMatchResult.behavior === 'deny' ||
    exactMatchResult.behavior === 'ask'
  ) {
    return exactMatchResult
  }

  // 2. Find all matching rules (prefix or exact)
  const { matchingDenyRules, matchingAskRules, matchingAllowRules } =
    matchingRulesForInput(input, toolPermissionContext, 'prefix')

  // 2a. Deny if command has a deny rule
  if (matchingDenyRules[0] !== undefined) {
    return {
      behavior: 'deny',
      message: `Permission to use ${POWERSHELL_TOOL_NAME} with command ${command} has been denied.`,
      decisionReason: {
        type: 'rule',
        rule: matchingDenyRules[0],
      },
    }
  }

  // 2b. Ask if command has an ask rule
  if (matchingAskRules[0] !== undefined) {
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(POWERSHELL_TOOL_NAME),
      decisionReason: {
        type: 'rule',
        rule: matchingAskRules[0],
      },
    }
  }

  // 3. Allow if command had an exact match allow
  if (exactMatchResult.behavior === 'allow') {
    return exactMatchResult
  }

  // 4. Allow if command has an allow rule
  if (matchingAllowRules[0] !== undefined) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'rule',
        rule: matchingAllowRules[0],
      },
    }
  }

  // 5. Passthrough since no rules match, will trigger permission prompt
  const decisionReason = {
    type: 'other' as const,
    reason: 'This command requires approval',
  }
  return {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(
      POWERSHELL_TOOL_NAME,
      decisionReason,
    ),
    decisionReason,
    suggestions: suggestionForExactCommand(command),
  }
}

/**
 * Information about a sub-command for permission checking.
 */
type SubCommandInfo = {
  text: string
  element: ParsedCommandElement
  statement: ParsedPowerShellCommand['statements'][number] | null
  isSafeOutput: boolean
}

/**
 * Extract sub-commands that need independent permission checking from a parsed command.
 * Safe output cmdlets (Format-Table, Select-Object, etc.) are flagged but NOT
 * filtered out — step 4.4 still checks deny rules against them (deny always
 * wins), step 5 skips them for approval collection (they inherit the permission
 * of the preceding command).
 *
 * Also includes nested commands from control flow statements (if, for, foreach, etc.)
 * to ensure commands hidden inside control flow are checked.
 *
 * Returns sub-command info including both text and the parsed element for accurate
 * suggestion generation.
 */
async function getSubCommandsForPermissionCheck(
  parsed: ParsedPowerShellCommand,
  originalCommand: string,
): Promise<SubCommandInfo[]> {
  if (!parsed.valid) {
    // Return a fallback element for unparsed commands
    return [
      {
        text: originalCommand,
        element: {
          name: await extractCommandName(originalCommand),
          nameType: 'unknown',
          elementType: 'CommandAst',
          args: [],
          text: originalCommand,
        },
        statement: null,
        isSafeOutput: false,
      },
    ]
  }

  const subCommands: SubCommandInfo[] = []

  // Check direct commands in pipelines
  for (const statement of parsed.statements) {
    for (const cmd of statement.commands) {
      // Only check actual commands (CommandAst), not expressions
      if (cmd.elementType !== 'CommandAst') {
        continue
      }
      subCommands.push({
        text: cmd.text,
        element: cmd,
        statement,
        // SECURITY: nameType gate — scripts\\Out-Null strips to Out-Null and
        // would match SAFE_OUTPUT_CMDLETS, but PowerShell runs the .ps1 file.
        // isSafeOutput: true causes step 5 to filter this command out of the
        // approval list, so it would silently execute. See isAllowlistedCommand.
        // SECURITY: args.length === 0 gate — Out-Null -InputObject:(1 > /etc/x)
        // was filtered as safe-output (name-only) → step-5 subCommands empty →
        // auto-allow → redirection inside paren writes file. Only zero-arg
        // Out-String/Out-Null/Out-Host invocations are provably safe.
        isSafeOutput:
          cmd.nameType !== 'application' &&
          isSafeOutputCommand(cmd.name) &&
          cmd.args.length === 0,
      })
    }

    // Also check nested commands from control flow statements
    if (statement.nestedCommands) {
      for (const cmd of statement.nestedCommands) {
        subCommands.push({
          text: cmd.text,
          element: cmd,
          statement,
          isSafeOutput:
            cmd.nameType !== 'application' &&
            isSafeOutputCommand(cmd.name) &&
            cmd.args.length === 0,
        })
      }
    }
  }

  if (subCommands.length > 0) {
    return subCommands
  }

  // Fallback for commands with no sub-commands
  return [
    {
      text: originalCommand,
      element: {
        name: await extractCommandName(originalCommand),
        nameType: 'unknown',
        elementType: 'CommandAst',
        args: [],
        text: originalCommand,
      },
      statement: null,
      isSafeOutput: false,
    },
  ]
}

/**
 * Main permission check function for PowerShell tool.
 *
 * This function implements the full permission flow:
 * 1. Check exact match against deny/ask/allow rules
 * 2. Check prefix match against rules
 * 3. Run security check via powershellCommandIsSafe()
 * 4. Return appropriate PermissionResult
 *
 * @param input - The PowerShell tool input
 * @param context - The tool use context (for abort signal and session info)
 * @returns Promise resolving to PermissionResult
 */
export async function powershellToolHasPermission(
  input: PowerShellInput,
  context: ToolUseContext,
): Promise<PermissionResult> {
  const toolPermissionContext = context.getAppState().toolPermissionContext
  const command = input.command.trim()

  // Empty command check
  if (!command) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: 'Empty command is safe',
      },
    }
  }

  // Parse the command once and thread through all sub-functions
  const parsed = await parsePowerShellCommand(command)

  // SECURITY: Check deny/ask rules BEFORE parse validity check.
  // Deny rules operate on the raw command string and don't need the parsed AST.
  
  
  const exactMatchResult = powershellToolCheckExactMatchPermission(
    input,
    toolPermissionContext,
  )

  
  if (exactMatchResult.behavior === 'deny') {
    return exactMatchResult
  }

  // 2. Check prefix/wildcard rules
  const { matchingDenyRules, matchingAskRules } = matchingRulesForInput(
    input,
    toolPermissionContext,
    'prefix',
  )

  
  if (matchingDenyRules[0] !== undefined) {
    return {
      behavior: 'deny',
      message: `Permission to use ${POWERSHELL_TOOL_NAME} with command ${command} has been denied.`,
      decisionReason: {
        type: 'rule',
        rule: matchingDenyRules[0],
      },
    }
  }

  // 2b. Ask if command has an ask rule — DEFERRED into decisions[].
  
  
  
  
  
  
  let preParseAskDecision: PermissionResult | null = null
  if (matchingAskRules[0] !== undefined) {
    preParseAskDecision = {
      behavior: 'ask',
      message: createPermissionRequestMessage(POWERSHELL_TOOL_NAME),
      decisionReason: {
        type: 'rule',
        rule: matchingAskRules[0],
      },
    }
  }

  // Block UNC paths — reading from UNC paths can trigger network requests
  
  
  
  if (preParseAskDecision === null && containsVulnerableUncPath(command)) {
    preParseAskDecision = {
      behavior: 'ask',
      message:
        'Command contains a UNC path that could trigger network requests',
    }
  }

  // 2c. Exact allow rules short-circuit here ONLY when parsing failed AND
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  // canonicalCommand matches exact allow, and without this guard we'd
  // return allow here and execute the local script. classifyCommandName
  // is a pure string function (no AST needed). `scripts\build.exe` →
  // 'application' (has `\`). Same tradeoff as step 5: `build.exe` alone
  // also classifies 'application' (has `.`) so legitimate executable
  // exact-allows downgrade to ask when pwsh is degraded — fail-safe.
  // Module-qualified cmdlets (Module\Cmdlet) also classify 'application'
  // (same `\`); same fail-safe over-fire.
  if (
    exactMatchResult.behavior === 'allow' &&
    !parsed.valid &&
    preParseAskDecision === null &&
    classifyCommandName(command.split(/\s+/)[0] ?? '') !== 'application'
  ) {
    return exactMatchResult
  }

  // 0. Check if command can be parsed - if not, require approval but don't suggest persisting
  
  
  
  
  if (!parsed.valid) {
    // SECURITY: Fallback sub-command deny scan for parse-failed path.
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    const backtickStripped = command
      .replace(/`[\r\n]+\s*/g, '')
      .replace(/`/g, '')
    for (const fragment of backtickStripped.split(/[;|\n\r{}()&]+/)) {
      const trimmedFrag = fragment.trim()
      if (!trimmedFrag) continue 
      
      
      
      
      
      
      if (
        trimmedFrag === command &&
        !/^\$[\w:]/.test(trimmedFrag) &&
        !/^[&.]\s/.test(trimmedFrag)
      ) {
        continue
      }
      // SECURITY: Normalize invocation-operator and assignment prefixes before
      
      
      
      //   `$x = Invoke-Expression 'p'` → first token `$x` → deny(iex:*) misses
      
      
      
      
      
      
      
      
      let normalized = trimmedFrag
      let m: RegExpMatchArray | null
      while ((m = normalized.match(PS_ASSIGN_PREFIX_RE))) {
        normalized = normalized.slice(m[0].length)
      }
      normalized = normalized.replace(/^[&.]\s+/, '') 
      const rawFirst = normalized.split(/\s+/)[0] ?? ''
      const firstTok = rawFirst.replace(/^['"]|['"]$/g, '')
      const normalizedFrag = firstTok + normalized.slice(rawFirst.length)
      
      
      
      // `Remove-Item /` degrades from hard-deny to generic ask. Check
      
      
      
      
      if (resolveToCanonical(firstTok) === 'remove-item') {
        for (const arg of normalized.split(/\s+/).slice(1)) {
          if (PS_TOKENIZER_DASH_CHARS.has(arg[0] ?? '')) continue
          if (isDangerousRemovalRawPath(arg)) {
            return dangerousRemovalDeny(arg)
          }
        }
      }
      const { matchingDenyRules: fragDenyRules } = matchingRulesForInput(
        { command: normalizedFrag },
        toolPermissionContext,
        'prefix',
      )
      if (fragDenyRules[0] !== undefined) {
        return {
          behavior: 'deny',
          message: `Permission to use ${POWERSHELL_TOOL_NAME} with command ${command} has been denied.`,
          decisionReason: { type: 'rule', rule: fragDenyRules[0] },
        }
      }
    }
    // Preserve pre-parse ask messaging when parse fails. The deferred ask
    
    
    
    if (preParseAskDecision !== null) {
      return preParseAskDecision
    }
    const decisionReason = {
      type: 'other' as const,
      reason: `Command contains malformed syntax that cannot be parsed: ${parsed.errors[0]?.message ?? 'unknown error'}`,
    }
    return {
      behavior: 'ask',
      decisionReason,
      message: createPermissionRequestMessage(
        POWERSHELL_TOOL_NAME,
        decisionReason,
      ),
      // No suggestions - don't recommend persisting invalid syntax
    }
  }

  // ========================================================================
  // COLLECT-THEN-REDUCE: post-parse decisions (deny > ask > allow > passthrough)
  // ========================================================================
  // Ported from bashPermissions.ts:1446-1472. Every post-parse check pushes
  // its decision into a single array; a single reduce applies precedence.
  // This structurally closes the ask-before-deny bug class: an 'ask' from an
  // earlier check (security flags, provider paths, cd+git) can no longer mask
  // a 'deny' from a later check (sub-command deny, checkPathConstraints).
  //
  // Supersedes the firstSubCommandAskRule stash from commit 8f5ae6c56b — that
  // fix only patched step 4; steps 3, 3.5, 4.42 had the same flaw. The stash
  // pattern is also fragile: the next author who writes `return ask` is back
  // where we started. Collect-then-reduce makes the bypass impossible to write.
  //
  // First-of-each-behavior wins (array order = step order), so single-check
  // ask messages are unchanged vs. sequential-early-return.
  //
  // Pre-parse deny checks above (exact/prefix deny) stay sequential: they
  // fire even when pwsh is unavailable. Pre-parse asks (prefix ask, raw UNC)
  // are now deferred here so sub-command deny (step 4) beats them.

  // Gather sub-commands once (used by decisions 3, 4, and fallthrough step 5).
  const allSubCommands = await getSubCommandsForPermissionCheck(parsed, command)

  const decisions: PermissionResult[] = []

  // Decision: deferred pre-parse ask (2b prefix ask or UNC path).
  // Pushed first so its message wins over later asks (first-of-behavior wins),
  // but the reduce ensures any deny in decisions[] still beats it.
  if (preParseAskDecision !== null) {
    decisions.push(preParseAskDecision)
  }

  // Decision: security check — was step 3 (:630-650).
  // powershellCommandIsSafe returns 'ask' for subexpressions, script blocks,
  // encoded commands, download cradles, etc. Only 'ask' | 'passthrough'.
  const safetyResult = powershellCommandIsSafe(command, parsed)
  if (safetyResult.behavior !== 'passthrough') {
    const decisionReason: PermissionDecisionReason = {
      type: 'other' as const,
      reason:
        safetyResult.behavior === 'ask' && safetyResult.message
          ? safetyResult.message
          : 'This command contains patterns that could pose security risks and requires approval',
    }
    decisions.push({
      behavior: 'ask',
      message: createPermissionRequestMessage(
        POWERSHELL_TOOL_NAME,
        decisionReason,
      ),
      decisionReason,
      suggestions: suggestionForExactCommand(command),
    })
  }

  // Decision: using statements / script requirements — invisible to AST block walk.
  // `using module ./evil.psm1` loads and executes a module's top-level script body;
  // `using assembly ./evil.dll` loads a .NET assembly (module initializers run).
  
  
  
  
  // bypassing the empty-statement fallback, and isReadOnlyCommand auto-allows.
  if (parsed.hasUsingStatements) {
    const decisionReason: PermissionDecisionReason = {
      type: 'other' as const,
      reason:
        'Command contains a `using` statement that may load external code (module or assembly)',
    }
    decisions.push({
      behavior: 'ask',
      message: createPermissionRequestMessage(
        POWERSHELL_TOOL_NAME,
        decisionReason,
      ),
      decisionReason,
      suggestions: suggestionForExactCommand(command),
    })
  }
  if (parsed.hasScriptRequirements) {
    const decisionReason: PermissionDecisionReason = {
      type: 'other' as const,
      reason:
        'Command contains a `#Requires` directive that may trigger module loading',
    }
    decisions.push({
      behavior: 'ask',
      message: createPermissionRequestMessage(
        POWERSHELL_TOOL_NAME,
        decisionReason,
      ),
      decisionReason,
      suggestions: suggestionForExactCommand(command),
    })
  }

  // Decision: resolved-arg provider/UNC scan — was step 3.5 (:652-709).
  
  
  
  
  
  
  
  
  
  const NON_FS_PROVIDER_PATTERN =
    /^(?:[\w.]+\\)?(env|hklm|hkcu|function|alias|variable|cert|wsman|registry)::?/i
  function extractProviderPathFromArg(arg: string): string {
    // Handle colon parameter syntax: -Path:env:HOME → extract 'env:HOME'.
    
    
    
    
    let s = arg
    if (s.length > 0 && PS_TOKENIZER_DASH_CHARS.has(s[0]!)) {
      const colonIdx = s.indexOf(':', 1) 
      if (colonIdx > 0) {
        s = s.substring(colonIdx + 1)
      }
    }
    // Strip backtick escapes before matching: `Registry`::HKLM\...` has a
    // backtick before `::` that the PS tokenizer removes at runtime but that
    // would otherwise prevent the ^-anchored pattern from matching.
    return s.replace(/`/g, '')
  }
  function providerOrUncDecisionForArg(arg: string): PermissionResult | null {
    const value = extractProviderPathFromArg(arg)
    if (NON_FS_PROVIDER_PATTERN.test(value)) {
      return {
        behavior: 'ask',
        message: `Command argument '${arg}' uses a non-filesystem provider path and requires approval`,
      }
    }
    if (containsVulnerableUncPath(value)) {
      return {
        behavior: 'ask',
        message: `Command argument '${arg}' contains a UNC path that could trigger network requests`,
      }
    }
    return null
  }
  providerScan: for (const statement of parsed.statements) {
    for (const cmd of statement.commands) {
      if (cmd.elementType !== 'CommandAst') continue
      for (const arg of cmd.args) {
        const decision = providerOrUncDecisionForArg(arg)
        if (decision !== null) {
          decisions.push(decision)
          break providerScan
        }
      }
    }
    if (statement.nestedCommands) {
      for (const cmd of statement.nestedCommands) {
        for (const arg of cmd.args) {
          const decision = providerOrUncDecisionForArg(arg)
          if (decision !== null) {
            decisions.push(decision)
            break providerScan
          }
        }
      }
    }
  }

  // Decision: per-sub-command deny/ask rules — was step 4 (:711-803).
  
  
  
  
  
  
  
  //   - Invocation operators (`& 'Remove-Item' ./x`): raw text starts with `&`,
  //     splitting on whitespace yields the operator, not the cmdlet name.
  
  
  
  
  
  //     element.name has the module prefix stripped.
  for (const { text: subCmd, element } of allSubCommands) {
    // element.name is quote-stripped at the parser (transformCommandAst) so
    
    
    
    const canonicalSubCmd =
      element.name !== '' ? [element.name, ...element.args].join(' ') : null

    const subInput = { command: subCmd }
    const { matchingDenyRules: subDenyRules, matchingAskRules: subAskRules } =
      matchingRulesForInput(subInput, toolPermissionContext, 'prefix')
    let matchedDenyRule = subDenyRules[0]
    let matchedAskRule = subAskRules[0]

    if (matchedDenyRule === undefined && canonicalSubCmd !== null) {
      const {
        matchingDenyRules: canonicalDenyRules,
        matchingAskRules: canonicalAskRules,
      } = matchingRulesForInput(
        { command: canonicalSubCmd },
        toolPermissionContext,
        'prefix',
      )
      matchedDenyRule = canonicalDenyRules[0]
      if (matchedAskRule === undefined) {
        matchedAskRule = canonicalAskRules[0]
      }
    }

    if (matchedDenyRule !== undefined) {
      decisions.push({
        behavior: 'deny',
        message: `Permission to use ${POWERSHELL_TOOL_NAME} with command ${command} has been denied.`,
        decisionReason: {
          type: 'rule',
          rule: matchedDenyRule,
        },
      })
    } else if (matchedAskRule !== undefined) {
      decisions.push({
        behavior: 'ask',
        message: createPermissionRequestMessage(POWERSHELL_TOOL_NAME),
        decisionReason: {
          type: 'rule',
          rule: matchedAskRule,
        },
      })
    }
  }

  // Decision: cd+git compound guard — was step 4.42 (:805-833).
  
  
  
  // bash, cd+git (B9, line 1416) runs BEFORE sub-command deny (B11), so cd+git
  
  
  
  
  
  // `Set-Location -Path:/etc .` — real target is /etc, heuristic sees `.`,
  // exclusion fires, bypass. The UX case (model emitting `Set-Location .; foo`)
  
  
  
  
  
  
  const hasCdSubCommand =
    allSubCommands.length > 1 &&
    allSubCommands.some(({ element }) => isCwdChangingCmdlet(element.name))
  
  
  
  const hasSymlinkCreate =
    allSubCommands.length > 1 &&
    allSubCommands.some(({ element }) => isSymlinkCreatingCommand(element))
  const hasGitSubCommand = allSubCommands.some(
    ({ element }) => resolveToCanonical(element.name) === 'git',
  )
  if (hasCdSubCommand && hasGitSubCommand) {
    decisions.push({
      behavior: 'ask',
      message:
        'Compound commands with cd/Set-Location and git require approval to prevent bare repository attacks',
    })
  }

  // cd+write compound guard — SUBSUMED by checkPathConstraints(compoundCommandHasCd).
  
  // but checkPathConstraints now receives hasCdSubCommand and pushes 'ask' for ANY
  
  
  
  

  
  
  
  
  
  if (hasGitSubCommand && isCurrentDirectoryBareGitRepo()) {
    decisions.push({
      behavior: 'ask',
      message:
        'Git command in a directory with bare-repository indicators (HEAD, objects/, refs/ in cwd without .git/HEAD). Git may execute hooks from cwd.',
    })
  }

  // Decision: git-internal-paths write guard — bash parity.
  
  
  
  
  if (hasGitSubCommand) {
    const writesToGitInternal = allSubCommands.some(
      ({ element, statement }) => {
        // Redirection targets on this sub-command (raw Extent.Text — quotes
        
        for (const r of element.redirections ?? []) {
          if (isGitInternalPathPS(r.target)) return true
        }
        // Write cmdlet args (new-item HEAD; mkdir hooks; set-content hooks/pre-commit)
        const canonical = resolveToCanonical(element.name)
        if (!GIT_SAFETY_WRITE_CMDLETS.has(canonical)) return false
        
        
        
        if (
          element.args
            .flatMap(a => a.split(','))
            .some(a => isGitInternalPathPS(a))
        ) {
          return true
        }
        // Pipeline input: `"hooks/pre-commit" | New-Item -ItemType File` binds the
        
        
        
        
        if (statement !== null) {
          for (const c of statement.commands) {
            if (c.elementType === 'CommandAst') continue
            if (isGitInternalPathPS(c.text)) return true
          }
        }
        return false
      },
    )
    
    const redirWritesToGitInternal = getFileRedirections(parsed).some(r =>
      isGitInternalPathPS(r.target),
    )
    if (writesToGitInternal || redirWritesToGitInternal) {
      decisions.push({
        behavior: 'ask',
        message:
          'Command writes to a git-internal path (HEAD, objects/, refs/, hooks/, .git/) and runs git. This could plant a malicious hook that git then executes.',
      })
    }
    // SECURITY: Archive-extraction TOCTOU. isCurrentDirectoryBareGitRepo
    
    
    
    
    const hasArchiveExtractor = allSubCommands.some(({ element }) =>
      GIT_SAFETY_ARCHIVE_EXTRACTORS.has(element.name.toLowerCase()),
    )
    if (hasArchiveExtractor) {
      decisions.push({
        behavior: 'ask',
        message:
          'Compound command extracts an archive and runs git. Archive contents may plant bare-repository indicators (HEAD, hooks/, refs/) that git then treats as the repository root.',
      })
    }
  }

  // .git/ writes are dangerous even WITHOUT a git subcommand — a planted
  
  
  
  {
    const found =
      allSubCommands.some(({ element }) => {
        for (const r of element.redirections ?? []) {
          if (isDotGitPathPS(r.target)) return true
        }
        const canonical = resolveToCanonical(element.name)
        if (!GIT_SAFETY_WRITE_CMDLETS.has(canonical)) return false
        return element.args.flatMap(a => a.split(',')).some(isDotGitPathPS)
      }) || getFileRedirections(parsed).some(r => isDotGitPathPS(r.target))
    if (found) {
      decisions.push({
        behavior: 'ask',
        message:
          'Command writes to .git/ — hooks or config planted there execute on the next git operation.',
      })
    }
  }

  // Decision: path constraints — was step 4.44 (:835-845).
  
  
  
  
  
  
  
  
  
  
  
  const pathResult = checkPathConstraints(
    input,
    parsed,
    toolPermissionContext,
    hasCdSubCommand,
  )
  if (pathResult.behavior !== 'passthrough') {
    decisions.push(pathResult)
  }

  // Decision: exact allow (parse-succeeded case) — was step 4.45 (:861-867).
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  if (
    exactMatchResult.behavior === 'allow' &&
    allSubCommands[0] !== undefined &&
    allSubCommands.every(
      sc =>
        sc.element.nameType !== 'application' &&
        !argLeaksValue(sc.text, sc.element),
    )
  ) {
    decisions.push(exactMatchResult)
  }

  // Decision: read-only allowlist — was step 4.5 (:869-885).
  
  
  
  if (isReadOnlyCommand(command, parsed)) {
    decisions.push({
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: 'Command is read-only and safe to execute',
      },
    })
  }

  // Decision: file redirections — was :887-900.
  
  
  
  const fileRedirections = getFileRedirections(parsed)
  if (fileRedirections.length > 0) {
    decisions.push({
      behavior: 'ask',
      message:
        'Command contains file redirections that could write to arbitrary paths',
      suggestions: suggestionForExactCommand(command),
    })
  }

  // Decision: mode-specific handling (acceptEdits) — was step 4.7 (:902-906).
  
  const modeResult = checkPermissionMode(input, parsed, toolPermissionContext)
  if (modeResult.behavior !== 'passthrough') {
    decisions.push(modeResult)
  }

  // REDUCE: deny > ask > allow > passthrough. First of each behavior type
  
  
  const deniedDecision = decisions.find(d => d.behavior === 'deny')
  if (deniedDecision !== undefined) {
    return deniedDecision
  }
  const askDecision = decisions.find(d => d.behavior === 'ask')
  if (askDecision !== undefined) {
    return askDecision
  }
  const allowDecision = decisions.find(d => d.behavior === 'allow')
  if (allowDecision !== undefined) {
    return allowDecision
  }

  // 5. Pipeline/statement splitting: check each sub-command independently.
  
  
  
  

  
  
  
  const subCommands = allSubCommands.filter(({ element, isSafeOutput }) => {
    if (isSafeOutput) {
      return false
    }
    // SECURITY: nameType gate — sixth location. Filtering out of the approval
    
    
    // then scripts\\Set-Location.ps1 executes with no prompt. Keep 'application'
    
    if (element.nameType === 'application') {
      return true
    }
    const canonical = resolveToCanonical(element.name)
    if (canonical === 'set-location' && element.args.length > 0) {
      // SECURITY: use PS_TOKENIZER_DASH_CHARS, not ASCII-only startsWith('-').
      
      
      
      
      // list — also correct. The risk is the inverse: a Unicode-dash parameter
      
      const target = element.args.find(
        a => a.length === 0 || !PS_TOKENIZER_DASH_CHARS.has(a[0]!),
      )
      if (target && resolve(getCwd(), target) === getCwd()) {
        return false
      }
    }
    return true
  })

  
  // either there's no cd or no git in the compound.

  const subCommandsNeedingApproval: string[] = []
  // Statements whose sub-commands were PUSHED to subCommandsNeedingApproval
  // in the step-5 loop below. The fail-closed gate (after the loop) only
  // pushes statements NOT tracked here — prevents duplicate suggestions where
  // both "Get-Process" (sub-command) AND "$x = Get-Process" (full statement)
  // appear.
  //
  // SECURITY: track on PUSH only, not on loop entry.
  // If a statement's only sub-commands `continue` via user allow rules
  
  
  
  
  
  
  
  
  const statementsSeenInLoop = new Set<
    ParsedPowerShellCommand['statements'][number]
  >()

  for (const { text: subCmd, element, statement } of subCommands) {
    // Check deny rules FIRST - user explicit rules take precedence over allowlist
    const subInput = { command: subCmd }
    const subResult = powershellToolCheckPermission(
      subInput,
      toolPermissionContext,
    )

    if (subResult.behavior === 'deny') {
      return {
        behavior: 'deny',
        message: `Permission to use ${POWERSHELL_TOOL_NAME} with command ${command} has been denied.`,
        decisionReason: subResult.decisionReason,
      }
    }

    if (subResult.behavior === 'ask') {
      if (statement !== null) {
        statementsSeenInLoop.add(statement)
      }
      subCommandsNeedingApproval.push(subCmd)
      continue
    }

    // Explicitly allowed by a user rule — BUT NOT for applications/scripts.
    
    
    
    
    
    
    
    if (
      subResult.behavior === 'allow' &&
      element.nameType !== 'application' &&
      !hasSymlinkCreate
    ) {
      // SECURITY: User allow rule asserts the cmdlet is safe, NOT that
      
      
      
      
      
      
      
      
      
      
      // allowlist path (below) and acceptEdits path both gate on
      
      if (argLeaksValue(subCmd, element)) {
        if (statement !== null) {
          statementsSeenInLoop.add(statement)
        }
        subCommandsNeedingApproval.push(subCmd)
        continue
      }
      continue
    }
    if (subResult.behavior === 'allow') {
      // nameType === 'application' with a matching allow rule: the rule was
      
      
      
      if (statement !== null) {
        statementsSeenInLoop.add(statement)
      }
      subCommandsNeedingApproval.push(subCmd)
      continue
    }

    // SECURITY: fail-closed gate. Do NOT take the allowlist shortcut unless
    
    
    
    
    
    //   'env:SECRET_API_KEY' | Get-Content  — CommandExpressionAst element
    
    
    
    
    
    
    
    
    
    
    
    if (
      statement !== null &&
      !hasCdSubCommand &&
      !hasSymlinkCreate &&
      isProvablySafeStatement(statement) &&
      isAllowlistedCommand(element, subCmd)
    ) {
      continue
    }

    // Check per-sub-command acceptEdits mode (BashTool parity).
    
    
    // security flags (subexpressions, script blocks, assignments, splatting, etc.),
    // and the ACCEPT_EDITS_ALLOWED_CMDLETS allowlist. This keeps one source of
    
    
    
    
    
    
    
    
    
    
    
    
    
    // and auto-allows — but PowerShell runs it from the changed cwd, writing to
    
    
    if (statement !== null && !hasCdSubCommand && !hasSymlinkCreate) {
      const subModeResult = checkPermissionMode(
        { command: subCmd },
        {
          valid: true,
          errors: [],
          variables: parsed.variables,
          hasStopParsing: parsed.hasStopParsing,
          originalCommand: subCmd,
          statements: [statement],
        },
        toolPermissionContext,
      )
      if (subModeResult.behavior === 'allow') {
        continue
      }
    }

    // Not allowlisted, no mode auto-allow, and no explicit rule — needs approval
    if (statement !== null) {
      statementsSeenInLoop.add(statement)
    }
    subCommandsNeedingApproval.push(subCmd)
  }

  // SECURITY: fail-closed gate (second half). The step-5 loop above only
  
  
  
  
  
  
  
  
  
  
  
  
  
  for (const stmt of parsed.statements) {
    if (!isProvablySafeStatement(stmt) && !statementsSeenInLoop.has(stmt)) {
      subCommandsNeedingApproval.push(stmt.text)
    }
  }

  if (subCommandsNeedingApproval.length === 0) {
    // SECURITY: empty-list auto-allow is only safe when there's nothing
    // unverifiable. If the pipeline has script blocks, every safe-output
    // cmdlet was filtered at :1032, but the block content wasn't verified —
    
    
    
    
    if (deriveSecurityFlags(parsed).hasScriptBlocks) {
      return {
        behavior: 'ask',
        message: createPermissionRequestMessage(POWERSHELL_TOOL_NAME),
        decisionReason: {
          type: 'other',
          reason:
            'Pipeline consists of output-formatting cmdlets with script blocks — block content cannot be verified',
        },
      }
    }
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: 'All pipeline commands are individually allowed',
      },
    }
  }

  // 6. Some sub-commands need approval — build suggestions
  const decisionReason = {
    type: 'other' as const,
    reason: 'This command requires approval',
  }

  const pendingSuggestions: PermissionUpdate[] = []
  for (const subCmd of subCommandsNeedingApproval) {
    pendingSuggestions.push(...suggestionForExactCommand(subCmd))
  }

  return {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(
      POWERSHELL_TOOL_NAME,
      decisionReason,
    ),
    decisionReason,
    suggestions: pendingSuggestions,
  }
}
