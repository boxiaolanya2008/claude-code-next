import { execa } from 'execa'
import { logForDebugging } from '../debug.js'
import { memoizeWithLRU } from '../memoize.js'
import { getCachedPowerShellPath } from '../shell/powershellDetection.js'
import { jsonParse } from '../slowOperations.js'

type PipelineElementType =
  | 'CommandAst'
  | 'CommandExpressionAst'
  | 'ParenExpressionAst'

type CommandElementType =
  | 'ScriptBlock'
  | 'SubExpression'
  | 'ExpandableString'
  | 'MemberInvocation'
  | 'Variable'
  | 'StringConstant'
  | 'Parameter'
  | 'Other'

export type CommandElementChild = {
  type: CommandElementType
  text: string
}

/**
 * The PowerShell AST statement type.
 * Maps directly to StatementAst derivatives in System.Management.Automation.Language.
 */
type StatementType =
  | 'PipelineAst'
  | 'PipelineChainAst'
  | 'AssignmentStatementAst'
  | 'IfStatementAst'
  | 'ForStatementAst'
  | 'ForEachStatementAst'
  | 'WhileStatementAst'
  | 'DoWhileStatementAst'
  | 'DoUntilStatementAst'
  | 'SwitchStatementAst'
  | 'TryStatementAst'
  | 'TrapStatementAst'
  | 'FunctionDefinitionAst'
  | 'DataStatementAst'
  | 'UnknownStatementAst'

export type ParsedCommandElement = {
  /** The command/cmdlet name (e.g., "Get-ChildItem", "git") */
  name: string
  
  nameType: 'cmdlet' | 'application' | 'unknown'
  
  elementType: PipelineElementType
  
  args: string[]
  
  text: string
  
  elementTypes?: CommandElementType[]
  

  children?: (CommandElementChild[] | undefined)[]
  
  redirections?: ParsedRedirection[]
}

/**
 * A redirection found in the command.
 */
type ParsedRedirection = {
  /** The redirection operator */
  operator: '>' | '>>' | '2>' | '2>>' | '*>' | '*>>' | '2>&1'
  
  target: string
  
  isMerging: boolean
}

/**
 * A parsed statement from PowerShell.
 * Can be a pipeline, assignment, control flow statement, etc.
 */
type ParsedStatement = {
  /** The AST statement type from PowerShell's parser */
  statementType: StatementType
  
  commands: ParsedCommandElement[]
  
  redirections: ParsedRedirection[]
  
  text: string
  

  nestedCommands?: ParsedCommandElement[]
  

  securityPatterns?: {
    hasMemberInvocations?: boolean
    hasSubExpressions?: boolean
    hasExpandableStrings?: boolean
    hasScriptBlocks?: boolean
  }
}

/**
 * A variable reference found in the command.
 */
type ParsedVariable = {
  /** The variable path (e.g., "HOME", "env:PATH", "global:x") */
  path: string
  
  isSplatted: boolean
}

/**
 * A parse error from PowerShell's parser.
 */
type ParseError = {
  message: string
  errorId: string
}

/**
 * The complete parsed result from the PowerShell AST parser.
 */
export type ParsedPowerShellCommand = {
  /** Whether the command parsed successfully (no syntax errors) */
  valid: boolean
  
  errors: ParseError[]
  
  statements: ParsedStatement[]
  
  variables: ParsedVariable[]
  
  hasStopParsing: boolean
  
  originalCommand: string
  

  typeLiterals?: string[]
  

  hasUsingStatements?: boolean
  

  hasScriptRequirements?: boolean
}

// ---------------------------------------------------------------------------

// attackVectors F1 hit 2×5s timeout → valid:false → 'ask' instead of 'deny').

const DEFAULT_PARSE_TIMEOUT_MS = 5_000
function getParseTimeoutMs(): number {
  const env = process.env.CLAUDE_CODE_PWSH_PARSE_TIMEOUT_MS
  if (env) {
    const parsed = parseInt(env, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_PARSE_TIMEOUT_MS
}
// MAX_COMMAND_LENGTH is derived from PARSE_SCRIPT_BODY.length below (after the

export type RawCommandElement = {
  type: string 
  text: string 
  value?: string 
  expressionType?: string 
  children?: { type: string; text: string }[] 
}

export type RawRedirection = {
  type: string 
  append?: boolean 
  fromStream?: string 
  locationText?: string 
}

export type RawPipelineElement = {
  type: string 
  text: string 
  commandElements?: RawCommandElement[]
  redirections?: RawRedirection[]
  expressionType?: string 
}

export type RawStatement = {
  type: string 
  text: string 
  elements?: RawPipelineElement[] 
  nestedCommands?: RawPipelineElement[] 
  redirections?: RawRedirection[] 
  securityPatterns?: {
    // Security-relevant AST node types found via FindAll on the statement
    hasMemberInvocations?: boolean
    hasSubExpressions?: boolean
    hasExpandableStrings?: boolean
    hasScriptBlocks?: boolean
  }
}

type RawParsedOutput = {
  valid: boolean
  errors: { message: string; errorId: string }[]
  statements: RawStatement[]
  variables: { path: string; isSplatted: boolean }[]
  hasStopParsing: boolean
  originalCommand: string
  typeLiterals?: string[]
  hasUsingStatements?: boolean
  hasScriptRequirements?: boolean
}

// This is the canonical copy of the parse script. There is no separate .ps1 file.

export const PARSE_SCRIPT_BODY = `
if (-not $EncodedCommand) {
    Write-Output '{"valid":false,"errors":[{"message":"No command provided","errorId":"NoInput"}],"statements":[],"variables":[],"hasStopParsing":false,"originalCommand":""}'
    exit 0
}

$Command = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EncodedCommand))

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput(
    $Command,
    [ref]$tokens,
    [ref]$parseErrors
)

$allVariables = [System.Collections.ArrayList]::new()

function Get-RawCommandElements {
    param([System.Management.Automation.Language.CommandAst]$CmdAst)
    $elems = [System.Collections.ArrayList]::new()
    foreach ($ce in $CmdAst.CommandElements) {
        $ceData = @{ type = $ce.GetType().Name; text = $ce.Extent.Text }
        if ($ce.PSObject.Properties['Value'] -and $null -ne $ce.Value -and $ce.Value -is [string]) {
            $ceData.value = $ce.Value
        }
        if ($ce -is [System.Management.Automation.Language.CommandExpressionAst]) {
            $ceData.expressionType = $ce.Expression.GetType().Name
        }
        $a=$ce.Argument;if($a){$ceData.children=@(@{type=$a.GetType().Name;text=$a.Extent.Text})}
        [void]$elems.Add($ceData)
    }
    return $elems
}

function Get-RawRedirections {
    param($Redirections)
    $result = [System.Collections.ArrayList]::new()
    foreach ($redir in $Redirections) {
        $redirData = @{ type = $redir.GetType().Name }
        if ($redir -is [System.Management.Automation.Language.FileRedirectionAst]) {
            $redirData.append = [bool]$redir.Append
            $redirData.fromStream = $redir.FromStream.ToString()
            $redirData.locationText = $redir.Location.Extent.Text
        }
        [void]$result.Add($redirData)
    }
    return $result
}

function Get-SecurityPatterns($A) {
    $p = @{}
    foreach ($n in $A.FindAll({ param($x)
        $x -is [System.Management.Automation.Language.MemberExpressionAst] -or
        $x -is [System.Management.Automation.Language.SubExpressionAst] -or
        $x -is [System.Management.Automation.Language.ArrayExpressionAst] -or
        $x -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -or
        $x -is [System.Management.Automation.Language.ScriptBlockExpressionAst] -or
        $x -is [System.Management.Automation.Language.ParenExpressionAst]
    }, $true)) { switch ($n.GetType().Name) {
        'InvokeMemberExpressionAst' { $p.hasMemberInvocations = $true }
        'MemberExpressionAst' { $p.hasMemberInvocations = $true }
        'SubExpressionAst' { $p.hasSubExpressions = $true }
        'ArrayExpressionAst' { $p.hasSubExpressions = $true }
        'ParenExpressionAst' { $p.hasSubExpressions = $true }
        'ExpandableStringExpressionAst' { $p.hasExpandableStrings = $true }
        'ScriptBlockExpressionAst' { $p.hasScriptBlocks = $true }
    }}
    if ($p.Count -gt 0) { return $p }
    return $null
}

$varExprs = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.VariableExpressionAst] }, $true)
foreach ($v in $varExprs) {
    [void]$allVariables.Add(@{
        path = $v.VariablePath.ToString()
        isSplatted = [bool]$v.Splatted
    })
}

$typeLiterals = [System.Collections.ArrayList]::new()
foreach ($t in $ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.TypeExpressionAst] -or
    $n -is [System.Management.Automation.Language.TypeConstraintAst]
}, $true)) { [void]$typeLiterals.Add($t.TypeName.FullName) }

$hasStopParsing = $false
$tk = [System.Management.Automation.Language.TokenKind]
foreach ($tok in $tokens) {
    if ($tok.Kind -eq $tk::MinusMinus) { $hasStopParsing = $true; break }
    if ($tok.Kind -eq $tk::Generic -and ($tok.Text -replace '[\u2013\u2014\u2015]','-') -eq '--%') {
        $hasStopParsing = $true; break
    }
}

$statements = [System.Collections.ArrayList]::new()

function Process-BlockStatements {
    param($Block)
    if (-not $Block) { return }

    foreach ($stmt in $Block.Statements) {
        $statement = @{
            type = $stmt.GetType().Name
            text = $stmt.Extent.Text
        }

        if ($stmt -is [System.Management.Automation.Language.PipelineAst]) {
            $elements = [System.Collections.ArrayList]::new()
            foreach ($element in $stmt.PipelineElements) {
                $elemData = @{
                    type = $element.GetType().Name
                    text = $element.Extent.Text
                }

                if ($element -is [System.Management.Automation.Language.CommandAst]) {
                    $elemData.commandElements = @(Get-RawCommandElements -CmdAst $element)
                    $elemData.redirections = @(Get-RawRedirections -Redirections $element.Redirections)
                } elseif ($element -is [System.Management.Automation.Language.CommandExpressionAst]) {
                    $elemData.expressionType = $element.Expression.GetType().Name
                    $elemData.redirections = @(Get-RawRedirections -Redirections $element.Redirections)
                }

                [void]$elements.Add($elemData)
            }
            $statement.elements = @($elements)

            $allNestedCmds = $stmt.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
                $true
            )
            $nestedCmds = [System.Collections.ArrayList]::new()
            foreach ($cmd in $allNestedCmds) {
                if ($cmd.Parent -eq $stmt) { continue }
                $nested = @{
                    type = $cmd.GetType().Name
                    text = $cmd.Extent.Text
                    commandElements = @(Get-RawCommandElements -CmdAst $cmd)
                    redirections = @(Get-RawRedirections -Redirections $cmd.Redirections)
                }
                [void]$nestedCmds.Add($nested)
            }
            if ($nestedCmds.Count -gt 0) {
                $statement.nestedCommands = @($nestedCmds)
            }
            $r = $stmt.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
            if ($r.Count -gt 0) {
                $rr = @(Get-RawRedirections -Redirections $r)
                $statement.redirections = if ($statement.redirections) { @($statement.redirections) + $rr } else { $rr }
            }
        } else {
            $nestedCmdAsts = $stmt.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
                $true
            )
            $nested = [System.Collections.ArrayList]::new()
            foreach ($cmd in $nestedCmdAsts) {
                [void]$nested.Add(@{
                    type = 'CommandAst'
                    text = $cmd.Extent.Text
                    commandElements = @(Get-RawCommandElements -CmdAst $cmd)
                    redirections = @(Get-RawRedirections -Redirections $cmd.Redirections)
                })
            }
            if ($nested.Count -gt 0) {
                $statement.nestedCommands = @($nested)
            }
            $r = $stmt.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
            if ($r.Count -gt 0) { $statement.redirections = @(Get-RawRedirections -Redirections $r) }
        }

        $sp = Get-SecurityPatterns $stmt
        if ($sp) { $statement.securityPatterns = $sp }

        [void]$statements.Add($statement)
    }

    if ($Block.Traps) {
        foreach ($trap in $Block.Traps) {
            $statement = @{
                type = 'TrapStatementAst'
                text = $trap.Extent.Text
            }
            $nestedCmdAsts = $trap.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
                $true
            )
            $nestedCmds = [System.Collections.ArrayList]::new()
            foreach ($cmd in $nestedCmdAsts) {
                $nested = @{
                    type = $cmd.GetType().Name
                    text = $cmd.Extent.Text
                    commandElements = @(Get-RawCommandElements -CmdAst $cmd)
                    redirections = @(Get-RawRedirections -Redirections $cmd.Redirections)
                }
                [void]$nestedCmds.Add($nested)
            }
            if ($nestedCmds.Count -gt 0) {
                $statement.nestedCommands = @($nestedCmds)
            }
            $r = $trap.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
            if ($r.Count -gt 0) { $statement.redirections = @(Get-RawRedirections -Redirections $r) }
            $sp = Get-SecurityPatterns $trap
            if ($sp) { $statement.securityPatterns = $sp }
            [void]$statements.Add($statement)
        }
    }
}

Process-BlockStatements -Block $ast.BeginBlock
Process-BlockStatements -Block $ast.ProcessBlock
Process-BlockStatements -Block $ast.EndBlock
Process-BlockStatements -Block $ast.CleanBlock
Process-BlockStatements -Block $ast.DynamicParamBlock

if ($ast.ParamBlock) {
  $pb = $ast.ParamBlock
  $pn = [System.Collections.ArrayList]::new()
  foreach ($c in $pb.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]}, $true)) {
    [void]$pn.Add(@{type='CommandAst';text=$c.Extent.Text;commandElements=@(Get-RawCommandElements -CmdAst $c);redirections=@(Get-RawRedirections -Redirections $c.Redirections)})
  }
  $pr = $pb.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
  $ps = Get-SecurityPatterns $pb
  if ($pn.Count -gt 0 -or $pr.Count -gt 0 -or $ps) {
    $st = @{type='ParamBlockAst';text=$pb.Extent.Text}
    if ($pn.Count -gt 0) { $st.nestedCommands = @($pn) }
    if ($pr.Count -gt 0) { $st.redirections = @(Get-RawRedirections -Redirections $pr) }
    if ($ps) { $st.securityPatterns = $ps }
    [void]$statements.Add($st)
  }
}

$hasUsingStatements = $ast.UsingStatements -and $ast.UsingStatements.Count -gt 0
$hasScriptRequirements = $ast.ScriptRequirements -ne $null

$output = @{
    valid = ($parseErrors.Count -eq 0)
    errors = @($parseErrors | ForEach-Object {
        @{
            message = $_.Message
            errorId = $_.ErrorId
        }
    })
    statements = @($statements)
    variables = @($allVariables)
    hasStopParsing = $hasStopParsing
    originalCommand = $Command
    typeLiterals = @($typeLiterals)
    hasUsingStatements = [bool]$hasUsingStatements
    hasScriptRequirements = [bool]$hasScriptRequirements
}

$output | ConvertTo-Json -Depth 10 -Compress
`

//   command (N UTF-8 bytes) → Base64 (~4N/3 chars) → $EncodedCommand = '...'\n

//   script_budget   = (32767 - argv_overhead) × 3/8

const WINDOWS_ARGV_CAP = 32_767

const FIXED_ARGV_OVERHEAD = 200

const ENCODED_CMD_WRAPPER = `$EncodedCommand = ''\n`.length

const SAFETY_MARGIN = 100
const SCRIPT_CHARS_BUDGET = ((WINDOWS_ARGV_CAP - FIXED_ARGV_OVERHEAD) * 3) / 8
const CMD_B64_BUDGET =
  SCRIPT_CHARS_BUDGET - PARSE_SCRIPT_BODY.length - ENCODED_CMD_WRAPPER

export const WINDOWS_MAX_COMMAND_LENGTH = Math.max(
  0,
  Math.floor((CMD_B64_BUDGET * 3) / 4) - SAFETY_MARGIN,
)

const UNIX_MAX_COMMAND_LENGTH = 4_500

export const MAX_COMMAND_LENGTH =
  process.platform === 'win32'
    ? WINDOWS_MAX_COMMAND_LENGTH
    : UNIX_MAX_COMMAND_LENGTH

const INVALID_RESULT_BASE: Omit<
  ParsedPowerShellCommand,
  'errors' | 'originalCommand'
> = {
  valid: false,
  statements: [],
  variables: [],
  hasStopParsing: false,
}

function makeInvalidResult(
  command: string,
  message: string,
  errorId: string,
): ParsedPowerShellCommand {
  return {
    ...INVALID_RESULT_BASE,
    errors: [{ message, errorId }],
    originalCommand: command,
  }
}

/**
 * Base64-encode a string as UTF-16LE, which is the encoding required by
 * PowerShell's -EncodedCommand parameter.
 */
function toUtf16LeBase64(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf16le').toString('base64')
  }
  // Fallback for non-Node environments
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes.push(code & 0xff, (code >> 8) & 0xff)
  }
  return btoa(bytes.map(b => String.fromCharCode(b)).join(''))
}

/**
 * Build the full PowerShell script that parses a command.
 * The user command is Base64-encoded (UTF-8) and embedded in a variable
 * to prevent injection attacks.
 */
function buildParseScript(command: string): string {
  const encoded =
    typeof Buffer !== 'undefined'
      ? Buffer.from(command, 'utf8').toString('base64')
      : btoa(
          new TextEncoder()
            .encode(command)
            .reduce((s, b) => s + String.fromCharCode(b), ''),
        )
  return `$EncodedCommand = '${encoded}'\n${PARSE_SCRIPT_BODY}`
}

/**
 * Ensure a value is an array. PowerShell 5.1's ConvertTo-Json may unwrap
 * single-element arrays into plain objects.
 */
function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

/** Map raw .NET AST type name to our StatementType union */

export function mapStatementType(rawType: string): StatementType {
  switch (rawType) {
    case 'PipelineAst':
      return 'PipelineAst'
    case 'PipelineChainAst':
      return 'PipelineChainAst'
    case 'AssignmentStatementAst':
      return 'AssignmentStatementAst'
    case 'IfStatementAst':
      return 'IfStatementAst'
    case 'ForStatementAst':
      return 'ForStatementAst'
    case 'ForEachStatementAst':
      return 'ForEachStatementAst'
    case 'WhileStatementAst':
      return 'WhileStatementAst'
    case 'DoWhileStatementAst':
      return 'DoWhileStatementAst'
    case 'DoUntilStatementAst':
      return 'DoUntilStatementAst'
    case 'SwitchStatementAst':
      return 'SwitchStatementAst'
    case 'TryStatementAst':
      return 'TryStatementAst'
    case 'TrapStatementAst':
      return 'TrapStatementAst'
    case 'FunctionDefinitionAst':
      return 'FunctionDefinitionAst'
    case 'DataStatementAst':
      return 'DataStatementAst'
    default:
      return 'UnknownStatementAst'
  }
}

/** Map raw .NET AST type name to our CommandElementType union */

export function mapElementType(
  rawType: string,
  expressionType?: string,
): CommandElementType {
  switch (rawType) {
    case 'ScriptBlockExpressionAst':
      return 'ScriptBlock'
    case 'SubExpressionAst':
    case 'ArrayExpressionAst':
      // SECURITY: ArrayExpressionAst (@()) is a sibling of SubExpressionAst,
      // not a subclass. Both evaluate arbitrary pipelines with side effects:
      // Get-ChildItem @(Remove-Item ./data) runs Remove-Item inside @().
      
      
      return 'SubExpression'
    case 'ExpandableStringExpressionAst':
      return 'ExpandableString'
    case 'InvokeMemberExpressionAst':
    case 'MemberExpressionAst':
      return 'MemberInvocation'
    case 'VariableExpressionAst':
      return 'Variable'
    case 'StringConstantExpressionAst':
    case 'ConstantExpressionAst':
      // ConstantExpressionAst covers numeric literals (5, 3.14). For
      
      
      // `-Seconds:5` produced children[0].type='Other' and consumers
      
      
      return 'StringConstant'
    case 'CommandParameterAst':
      return 'Parameter'
    case 'ParenExpressionAst':
      return 'SubExpression'
    case 'CommandExpressionAst':
      // Delegate to the wrapped expression type so we catch SubExpressionAst,
      // ExpandableStringExpressionAst, ScriptBlockExpressionAst, etc.
      
      
      if (expressionType) {
        return mapElementType(expressionType)
      }
      return 'Other'
    default:
      return 'Other'
  }
}

/** Classify command name as cmdlet, application, or unknown */

export function classifyCommandName(
  name: string,
): 'cmdlet' | 'application' | 'unknown' {
  if (/^[A-Za-z]+-[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return 'cmdlet'
  }
  if (/[.\\/]/.test(name)) {
    return 'application'
  }
  return 'unknown'
}

/** Strip module prefix from command name (e.g. "Microsoft.PowerShell.Utility\\Invoke-Expression" -> "Invoke-Expression") */

export function stripModulePrefix(name: string): string {
  const idx = name.lastIndexOf('\\')
  if (idx < 0) return name
  
  if (
    /^[A-Za-z]:/.test(name) ||
    name.startsWith('\\\\') ||
    name.startsWith('.\\') ||
    name.startsWith('..\\')
  )
    return name
  return name.substring(idx + 1)
}

/** Transform a raw CommandAst pipeline element into ParsedCommandElement */

export function transformCommandAst(
  raw: RawPipelineElement,
): ParsedCommandElement {
  const cmdElements = ensureArray(raw.commandElements)
  let name = ''
  const args: string[] = []
  const elementTypes: CommandElementType[] = []
  const children: (CommandElementChild[] | undefined)[] = []
  let hasChildren = false

  
  
  
  
  
  
  
  
  
  let nameType: 'cmdlet' | 'application' | 'unknown' = 'unknown'
  if (cmdElements.length > 0) {
    const first = cmdElements[0]!
    // SECURITY: only trust .value for string-literal element types with a
    
    
    
    const isFirstStringLiteral =
      first.type === 'StringConstantExpressionAst' ||
      first.type === 'ExpandableStringExpressionAst'
    const rawNameUnstripped =
      isFirstStringLiteral && typeof first.value === 'string'
        ? first.value
        : first.text
    
    
    
    
    
    
    const rawName = rawNameUnstripped.replace(/^['"]|['"]$/g, '')
    
    
    
    
    
    
    
    // security validators) misses. Force 'application' to gate auto-allow
    
    
    
    
    if (/[\u0080-\uFFFF]/.test(rawName)) {
      nameType = 'application'
    } else {
      nameType = classifyCommandName(rawName)
    }
    name = stripModulePrefix(rawName)
    elementTypes.push(mapElementType(first.type, first.expressionType))

    for (let i = 1; i < cmdElements.length; i++) {
      const ce = cmdElements[i]!
      // Use resolved .value for string constants (strips quotes, resolves
      
      
      // variables, and other non-string types.
      const isStringLiteral =
        ce.type === 'StringConstantExpressionAst' ||
        ce.type === 'ExpandableStringExpressionAst'
      args.push(isStringLiteral && ce.value != null ? ce.value : ce.text)
      elementTypes.push(mapElementType(ce.type, ce.expressionType))
      
      
      const rawChildren = ensureArray(ce.children)
      if (rawChildren.length > 0) {
        hasChildren = true
        children.push(
          rawChildren.map(c => ({
            type: mapElementType(c.type),
            text: c.text,
          })),
        )
      } else {
        children.push(undefined)
      }
    }
  }

  const result: ParsedCommandElement = {
    name,
    nameType,
    elementType: 'CommandAst',
    args,
    text: raw.text,
    elementTypes,
    ...(hasChildren ? { children } : {}),
  }

  // Preserve redirections from nested commands (e.g., in && / || chains)
  const rawRedirs = ensureArray(raw.redirections)
  if (rawRedirs.length > 0) {
    result.redirections = rawRedirs.map(transformRedirection)
  }

  return result
}

/** Transform a non-CommandAst pipeline element into ParsedCommandElement */

export function transformExpressionElement(
  raw: RawPipelineElement,
): ParsedCommandElement {
  const elementType: PipelineElementType =
    raw.type === 'ParenExpressionAst'
      ? 'ParenExpressionAst'
      : 'CommandExpressionAst'
  const elementTypes: CommandElementType[] = [
    mapElementType(raw.type, raw.expressionType),
  ]

  return {
    name: raw.text,
    nameType: 'unknown',
    elementType,
    args: [],
    text: raw.text,
    elementTypes,
  }
}

/** Map raw redirection to ParsedRedirection */

export function transformRedirection(raw: RawRedirection): ParsedRedirection {
  if (raw.type === 'MergingRedirectionAst') {
    return { operator: '2>&1', target: '', isMerging: true }
  }

  const append = raw.append ?? false
  const fromStream = raw.fromStream ?? 'Output'

  let operator: ParsedRedirection['operator']
  if (append) {
    switch (fromStream) {
      case 'Error':
        operator = '2>>'
        break
      case 'All':
        operator = '*>>'
        break
      default:
        operator = '>>'
        break
    }
  } else {
    switch (fromStream) {
      case 'Error':
        operator = '2>'
        break
      case 'All':
        operator = '*>'
        break
      default:
        operator = '>'
        break
    }
  }

  return { operator, target: raw.locationText ?? '', isMerging: false }
}

/** Transform a raw statement into ParsedStatement */

export function transformStatement(raw: RawStatement): ParsedStatement {
  const statementType = mapStatementType(raw.type)
  const commands: ParsedCommandElement[] = []
  const redirections: ParsedRedirection[] = []

  if (raw.elements) {
    // PipelineAst: walk pipeline elements
    for (const elem of ensureArray(raw.elements)) {
      if (elem.type === 'CommandAst') {
        commands.push(transformCommandAst(elem))
        for (const redir of ensureArray(elem.redirections)) {
          redirections.push(transformRedirection(redir))
        }
      } else {
        commands.push(transformExpressionElement(elem))
        
        
        
        
        
        for (const redir of ensureArray(elem.redirections)) {
          redirections.push(transformRedirection(redir))
        }
      }
    }
    // SECURITY: The PS1 PipelineAst branch does a deep FindAll for
    
    //  - colon-bound ParenExpressionAst args: -Name:('payload' > file)
    
    // Both are invisible at the element level — the redirection's parent
    // is a child of CommandParameterAst / CommandExpressionAst, not a
    // separate pipeline element. Merge into statement-level redirections.
    //
    // The FindAll ALSO re-discovers direct-element redirections already
    // captured in the per-element loop above. Dedupe by (operator, target)
    // so tests and consumers see the real count.
    const seen = new Set(redirections.map(r => `${r.operator}\0${r.target}`))
    for (const redir of ensureArray(raw.redirections)) {
      const r = transformRedirection(redir)
      const key = `${r.operator}\0${r.target}`
      if (!seen.has(key)) {
        seen.add(key)
        redirections.push(r)
      }
    }
  } else {
    // Non-pipeline statement: add synthetic command entry with full text
    commands.push({
      name: raw.text,
      nameType: 'unknown',
      elementType: 'CommandExpressionAst',
      args: [],
      text: raw.text,
    })
    // SECURITY: The PS1 else-branch does a direct recursive FindAll on
    // FileRedirectionAst to catch expression redirections inside control flow
    // (if/for/foreach/while/switch/try/trap/&& and ||). The CommandAst FindAll
    // above CANNOT see these: in if ($x) { 1 > /tmp/evil }, the literal 1 with
    // its attached redirection is a CommandExpressionAst — a SIBLING of
    // CommandAst in the type hierarchy, not a subclass. So nestedCommands never
    // contains it, and without this hoist the redirection is invisible to
    // getFileRedirections → step 4.6 misses it → compound commands like
    // `Get-Process && 1 > /tmp/evil` auto-allow at step 5 (only Get-Process
    // is checked, allowlisted).
    //
    // Finding FileRedirectionAst DIRECTLY (rather than finding CommandExpressionAst
    // and extracting .Redirections) is both simpler and more robust: it catches
    // redirections on any node type, including ones we don't know about yet.
    
    
    
    
    
    
    
    // because PS1 comments bloat the -EncodedCommand payload and push the
    
    for (const redir of ensureArray(raw.redirections)) {
      redirections.push(transformRedirection(redir))
    }
  }

  let nestedCommands: ParsedCommandElement[] | undefined
  const rawNested = ensureArray(raw.nestedCommands)
  if (rawNested.length > 0) {
    nestedCommands = rawNested.map(transformCommandAst)
  }

  const result: ParsedStatement = {
    statementType,
    commands,
    redirections,
    text: raw.text,
    nestedCommands,
  }

  if (raw.securityPatterns) {
    result.securityPatterns = raw.securityPatterns
  }

  return result
}

/** Transform the complete raw PS output into ParsedPowerShellCommand */
function transformRawOutput(raw: RawParsedOutput): ParsedPowerShellCommand {
  const result: ParsedPowerShellCommand = {
    valid: raw.valid,
    errors: ensureArray(raw.errors),
    statements: ensureArray(raw.statements).map(transformStatement),
    variables: ensureArray(raw.variables),
    hasStopParsing: raw.hasStopParsing,
    originalCommand: raw.originalCommand,
  }
  const tl = ensureArray(raw.typeLiterals)
  if (tl.length > 0) {
    result.typeLiterals = tl
  }
  if (raw.hasUsingStatements) {
    result.hasUsingStatements = true
  }
  if (raw.hasScriptRequirements) {
    result.hasScriptRequirements = true
  }
  return result
}

/**
 * Parse a PowerShell command using the native AST parser.
 * Spawns pwsh to parse the command and returns structured results.
 * Results are memoized by command string.
 *
 * @param command - The PowerShell command to parse
 * @returns Parsed command structure, or a result with valid=false on failure
 */
async function parsePowerShellCommandImpl(
  command: string,
): Promise<ParsedPowerShellCommand> {
  // SECURITY: MAX_COMMAND_LENGTH is a UTF-8 BYTE budget (see derivation at the
  
  
  
  
  const commandBytes = Buffer.byteLength(command, 'utf8')
  if (commandBytes > MAX_COMMAND_LENGTH) {
    logForDebugging(
      `PowerShell parser: command too long (${commandBytes} bytes, max ${MAX_COMMAND_LENGTH})`,
    )
    return makeInvalidResult(
      command,
      `Command too long for parsing (${commandBytes} bytes). Maximum supported length is ${MAX_COMMAND_LENGTH} bytes.`,
      'CommandTooLong',
    )
  }

  const pwshPath = await getCachedPowerShellPath()
  if (!pwshPath) {
    return makeInvalidResult(
      command,
      'PowerShell is not available',
      'NoPowerShell',
    )
  }

  const script = buildParseScript(command)

  
  
  // which avoids: (1) stdin interactive-mode issues where -File - produces
  
  // (3) temp files. The script itself is large but well within OS arg limits
  
  const encodedScript = toUtf16LeBase64(script)
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-NoLogo',
    '-EncodedCommand',
    encodedScript,
  ]

  
  
  
  
  
  
  const parseTimeoutMs = getParseTimeoutMs()
  let stdout = ''
  let stderr = ''
  let code: number | null = null
  let timedOut = false
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await execa(pwshPath, args, {
        timeout: parseTimeoutMs,
        reject: false,
      })
      stdout = result.stdout
      stderr = result.stderr
      timedOut = result.timedOut
      code = result.failed ? (result.exitCode ?? 1) : 0
    } catch (e: unknown) {
      logForDebugging(
        `PowerShell parser: failed to spawn pwsh: ${e instanceof Error ? e.message : e}`,
      )
      return makeInvalidResult(
        command,
        `Failed to spawn PowerShell: ${e instanceof Error ? e.message : e}`,
        'PwshSpawnError',
      )
    }
    if (!timedOut) break
    logForDebugging(
      `PowerShell parser: pwsh timed out after ${parseTimeoutMs}ms (attempt ${attempt + 1})`,
    )
  }

  if (timedOut) {
    return makeInvalidResult(
      command,
      `pwsh timed out after ${parseTimeoutMs}ms (2 attempts)`,
      'PwshTimeout',
    )
  }

  if (code !== 0) {
    logForDebugging(
      `PowerShell parser: pwsh exited with code ${code}, stderr: ${stderr}`,
    )
    return makeInvalidResult(
      command,
      `pwsh exited with code ${code}: ${stderr}`,
      'PwshError',
    )
  }

  const trimmed = stdout.trim()
  if (!trimmed) {
    logForDebugging('PowerShell parser: empty stdout from pwsh')
    return makeInvalidResult(
      command,
      'No output from PowerShell parser',
      'EmptyOutput',
    )
  }

  try {
    const raw = jsonParse(trimmed) as RawParsedOutput
    return transformRawOutput(raw)
  } catch {
    logForDebugging(
      `PowerShell parser: invalid JSON output: ${trimmed.slice(0, 200)}`,
    )
    return makeInvalidResult(
      command,
      'Invalid JSON from PowerShell parser',
      'InvalidJson',
    )
  }
}

// Error IDs from makeInvalidResult that represent transient process failures.

const TRANSIENT_ERROR_IDS = new Set([
  'PwshSpawnError',
  'PwshError',
  'PwshTimeout',
  'EmptyOutput',
  'InvalidJson',
])

const parsePowerShellCommandCached = memoizeWithLRU(
  (command: string) => {
    const promise = parsePowerShellCommandImpl(command)
    
    
    // ensuring concurrent callers share the same result.
    void promise.then(result => {
      if (
        !result.valid &&
        TRANSIENT_ERROR_IDS.has(result.errors[0]?.errorId ?? '')
      ) {
        parsePowerShellCommandCached.cache.delete(command)
      }
    })
    return promise
  },
  (command: string) => command,
  256,
)
export { parsePowerShellCommandCached as parsePowerShellCommand }

// ---------------------------------------------------------------------------

type SecurityFlags = {
  /** Contains $(...) subexpression */
  hasSubExpressions: boolean
  
  hasScriptBlocks: boolean
  
  hasSplatting: boolean
  
  hasExpandableStrings: boolean
  
  hasMemberInvocations: boolean
  
  hasAssignments: boolean
  
  hasStopParsing: boolean
}

/**
 * Common PowerShell aliases mapped to their canonical cmdlet names.
 * Uses Object.create(null) to prevent prototype-chain pollution — attacker-controlled
 * command names like 'constructor' or '__proto__' must return undefined, not inherited
 * Object.prototype properties.
 */
export const COMMON_ALIASES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    // Directory listing
    ls: 'Get-ChildItem',
    dir: 'Get-ChildItem',
    gci: 'Get-ChildItem',
    // Content
    cat: 'Get-Content',
    type: 'Get-Content',
    gc: 'Get-Content',
    // Navigation
    cd: 'Set-Location',
    sl: 'Set-Location',
    chdir: 'Set-Location',
    pushd: 'Push-Location',
    popd: 'Pop-Location',
    pwd: 'Get-Location',
    gl: 'Get-Location',
    // Items
    gi: 'Get-Item',
    gp: 'Get-ItemProperty',
    ni: 'New-Item',
    mkdir: 'New-Item',
    // `md` is PowerShell's built-in alias for `mkdir`. resolveToCanonical is
    // single-hop (no md→mkdir→New-Item chaining), so it needs its own entry
    // or `md /etc/x` falls through while `mkdir /etc/x` is caught.
    md: 'New-Item',
    ri: 'Remove-Item',
    del: 'Remove-Item',
    rd: 'Remove-Item',
    rmdir: 'Remove-Item',
    rm: 'Remove-Item',
    erase: 'Remove-Item',
    mi: 'Move-Item',
    mv: 'Move-Item',
    move: 'Move-Item',
    ci: 'Copy-Item',
    cp: 'Copy-Item',
    copy: 'Copy-Item',
    cpi: 'Copy-Item',
    si: 'Set-Item',
    rni: 'Rename-Item',
    ren: 'Rename-Item',
    // Process
    ps: 'Get-Process',
    gps: 'Get-Process',
    kill: 'Stop-Process',
    spps: 'Stop-Process',
    start: 'Start-Process',
    saps: 'Start-Process',
    sajb: 'Start-Job',
    ipmo: 'Import-Module',
    // Output
    echo: 'Write-Output',
    write: 'Write-Output',
    sleep: 'Start-Sleep',
    // Help
    help: 'Get-Help',
    man: 'Get-Help',
    gcm: 'Get-Command',
    // Service
    gsv: 'Get-Service',
    // Variables
    gv: 'Get-Variable',
    sv: 'Set-Variable',
    // History
    h: 'Get-History',
    history: 'Get-History',
    // Invoke
    iex: 'Invoke-Expression',
    iwr: 'Invoke-WebRequest',
    irm: 'Invoke-RestMethod',
    icm: 'Invoke-Command',
    ii: 'Invoke-Item',
    // PSSession — remote code execution surface
    nsn: 'New-PSSession',
    etsn: 'Enter-PSSession',
    exsn: 'Exit-PSSession',
    gsn: 'Get-PSSession',
    rsn: 'Remove-PSSession',
    // Misc
    cls: 'Clear-Host',
    clear: 'Clear-Host',
    select: 'Select-Object',
    where: 'Where-Object',
    foreach: 'ForEach-Object',
    '%': 'ForEach-Object',
    '?': 'Where-Object',
    measure: 'Measure-Object',
    ft: 'Format-Table',
    fl: 'Format-List',
    fw: 'Format-Wide',
    oh: 'Out-Host',
    ogv: 'Out-GridView',
    // SECURITY: The following aliases are deliberately omitted because PS Core 6+
    // removed them (they collide with native executables). Our allowlist logic
    // resolves aliases BEFORE checking safety — if we map 'sort' → 'Sort-Object'
    // but PowerShell 7/Windows actually runs sort.exe, we'd auto-allow the wrong
    
    
    
    
    
    
    
    
    ac: 'Add-Content',
    clc: 'Clear-Content',
    // Write/export: tee-object/export-csv are in
    // CMDLET_PATH_CONFIG so path-level Edit denies fire on the full cmdlet name,
    // but PowerShell's built-in aliases fell through to ask-then-approve because
    // resolveToCanonical couldn't resolve them). Neither tee-object nor
    
    
    
    
    tee: 'Tee-Object',
    epcsv: 'Export-Csv',
    sp: 'Set-ItemProperty',
    rp: 'Remove-ItemProperty',
    cli: 'Clear-Item',
    epal: 'Export-Alias',
    // Text search
    sls: 'Select-String',
  },
)

const DIRECTORY_CHANGE_CMDLETS = new Set([
  'set-location',
  'push-location',
  'pop-location',
])

const DIRECTORY_CHANGE_ALIASES = new Set(['cd', 'sl', 'chdir', 'pushd', 'popd'])

export function getAllCommandNames(parsed: ParsedPowerShellCommand): string[] {
  const names: string[] = []
  for (const statement of parsed.statements) {
    for (const cmd of statement.commands) {
      names.push(cmd.name.toLowerCase())
    }
    if (statement.nestedCommands) {
      for (const cmd of statement.nestedCommands) {
        names.push(cmd.name.toLowerCase())
      }
    }
  }
  return names
}

/**
 * Get all pipeline segments as flat list of commands.
 * Useful for checking each command independently.
 */
export function getAllCommands(
  parsed: ParsedPowerShellCommand,
): ParsedCommandElement[] {
  const commands: ParsedCommandElement[] = []
  for (const statement of parsed.statements) {
    for (const cmd of statement.commands) {
      commands.push(cmd)
    }
    if (statement.nestedCommands) {
      for (const cmd of statement.nestedCommands) {
        commands.push(cmd)
      }
    }
  }
  return commands
}

/**
 * Get all redirections across all statements.
 */

export function getAllRedirections(
  parsed: ParsedPowerShellCommand,
): ParsedRedirection[] {
  const redirections: ParsedRedirection[] = []
  for (const statement of parsed.statements) {
    for (const redir of statement.redirections) {
      redirections.push(redir)
    }
    // Include redirections from nested commands (e.g., from && / || chains)
    if (statement.nestedCommands) {
      for (const cmd of statement.nestedCommands) {
        if (cmd.redirections) {
          for (const redir of cmd.redirections) {
            redirections.push(redir)
          }
        }
      }
    }
  }
  return redirections
}

/**
 * Get all variables, optionally filtered by scope (e.g., 'env').
 * Variable paths in PowerShell can have scopes like "env:PATH", "global:x".
 */
export function getVariablesByScope(
  parsed: ParsedPowerShellCommand,
  scope: string,
): ParsedVariable[] {
  const prefix = scope.toLowerCase() + ':'
  return parsed.variables.filter(v => v.path.toLowerCase().startsWith(prefix))
}

/**
 * Check if any command in the parsed result matches a given name (case-insensitive).
 * Handles common aliases too.
 */
export function hasCommandNamed(
  parsed: ParsedPowerShellCommand,
  name: string,
): boolean {
  const lowerName = name.toLowerCase()
  const canonicalFromAlias = COMMON_ALIASES[lowerName]?.toLowerCase()

  for (const cmdName of getAllCommandNames(parsed)) {
    if (cmdName === lowerName) {
      return true
    }
    // Check if the command is an alias that resolves to the requested name
    const canonical = COMMON_ALIASES[cmdName]?.toLowerCase()
    if (canonical === lowerName) {
      return true
    }
    // Check if the requested name is an alias and the command is its canonical form
    if (canonicalFromAlias && cmdName === canonicalFromAlias) {
      return true
    }
    // Check if both resolve to the same canonical cmdlet (alias-to-alias match)
    if (canonical && canonicalFromAlias && canonical === canonicalFromAlias) {
      return true
    }
  }
  return false
}

/**
 * Check if the command contains any directory-changing commands.
 * (Set-Location, cd, sl, chdir, Push-Location, pushd, Pop-Location, popd)
 */

export function hasDirectoryChange(parsed: ParsedPowerShellCommand): boolean {
  for (const cmdName of getAllCommandNames(parsed)) {
    if (
      DIRECTORY_CHANGE_CMDLETS.has(cmdName) ||
      DIRECTORY_CHANGE_ALIASES.has(cmdName)
    ) {
      return true
    }
  }
  return false
}

/**
 * Check if the command is a single simple command (no pipes, no semicolons, no operators).
 */

export function isSingleCommand(parsed: ParsedPowerShellCommand): boolean {
  const stmt = parsed.statements[0]
  return (
    parsed.statements.length === 1 &&
    stmt !== undefined &&
    stmt.commands.length === 1 &&
    (!stmt.nestedCommands || stmt.nestedCommands.length === 0)
  )
}

/**
 * Check if a specific command has a given argument/flag (case-insensitive).
 * Useful for checking "-EncodedCommand", "-Recurse", etc.
 */
export function commandHasArg(
  command: ParsedCommandElement,
  arg: string,
): boolean {
  const lowerArg = arg.toLowerCase()
  return command.args.some(a => a.toLowerCase() === lowerArg)
}

/**
 * Tokenizer-level dash characters that PowerShell's parser accepts as
 * parameter prefixes. SpecialCharacters.IsDash (CharTraits.cs) accepts exactly
 * these four: ASCII hyphen-minus, en-dash, em-dash, horizontal bar. These are
 * tokenizer-level — they apply to ALL cmdlet parameters, not just argv to
 * powershell.exe (contrast with `/` which is an argv-parser quirk of
 * powershell.exe 5.1 only; see PS_ALT_PARAM_PREFIXES in powershellSecurity.ts).
 *
 * Extent.Text preserves the raw character; transformCommandAst uses ce.text
 * for CommandParameterAst elements, so these reach callers unchanged.
 */
export const PS_TOKENIZER_DASH_CHARS = new Set([
  '-', // U+002D hyphen-minus (ASCII)
  '\u2013', // en-dash
  '\u2014', // em-dash
  '\u2015', // horizontal bar
])

/**
 * Determines if an argument is a PowerShell parameter (flag), using the AST
 * element type as ground truth when available.
 *
 * The parser maps CommandParameterAst → 'Parameter' regardless of which dash
 * character the user typed — PowerShell's tokenizer handles that. So when
 * elementType is available, it's authoritative:
 *   - 'Parameter' → true (covers `-Path`, `–Path`, `—Path`, `―Path`)
 *   - anything else → false (a quoted "-Path" is StringConstant, not a param)
 *
 * When elementType is unavailable (backward compat / no AST detail), fall back
 * to a char check against PS_TOKENIZER_DASH_CHARS.
 */
export function isPowerShellParameter(
  arg: string,
  elementType?: CommandElementType,
): boolean {
  if (elementType !== undefined) {
    return elementType === 'Parameter'
  }
  return arg.length > 0 && PS_TOKENIZER_DASH_CHARS.has(arg[0]!)
}

/**
 * Check if any argument on a command is an unambiguous abbreviation of a PowerShell parameter.
 * PowerShell allows parameter abbreviation as long as the prefix is unambiguous.
 * The minPrefix is the shortest unambiguous prefix for the parameter.
 * For example, minPrefix '-en' for fullParam '-encodedcommand' matches '-en', '-enc', '-enco', etc.
 */
export function commandHasArgAbbreviation(
  command: ParsedCommandElement,
  fullParam: string,
  minPrefix: string,
): boolean {
  const lowerFull = fullParam.toLowerCase()
  const lowerMin = minPrefix.toLowerCase()
  return command.args.some(a => {
    // Strip colon-bound value (e.g., -en:base64value -> -en)
    const colonIndex = a.indexOf(':', 1)
    const paramPart = colonIndex > 0 ? a.slice(0, colonIndex) : a
    // Strip backtick escapes — PowerShell resolves `-Member`Name` to
    
    
    const lower = paramPart.replace(/`/g, '').toLowerCase()
    return (
      lower.startsWith(lowerMin) &&
      lowerFull.startsWith(lower) &&
      lower.length <= lowerFull.length
    )
  })
}

/**
 * Split a parsed command into its pipeline segments for per-segment permission checking.
 * Returns each pipeline's commands separately.
 */
export function getPipelineSegments(
  parsed: ParsedPowerShellCommand,
): ParsedStatement[] {
  return parsed.statements
}

/**
 * True if a redirection target is PowerShell's `$null` automatic variable.
 * `> $null` discards output (like /dev/null) — not a filesystem write.
 * `$null` cannot be reassigned, so this is safe to treat as a no-op sink.
 * `${null}` is the same automatic variable via curly-brace syntax. Spaces
 * inside the braces (`${ null }`) name a different variable, so no regex.
 */
export function isNullRedirectionTarget(target: string): boolean {
  const t = target.trim().toLowerCase()
  return t === '$null' || t === '${null}'
}

/**
 * Get output redirections (file redirections, not merging redirections).
 * Returns only redirections that write to files.
 */

export function getFileRedirections(
  parsed: ParsedPowerShellCommand,
): ParsedRedirection[] {
  return getAllRedirections(parsed).filter(
    r => !r.isMerging && !isNullRedirectionTarget(r.target),
  )
}

/**
 * Derive security-relevant flags from the parsed command structure.
 * This replaces the previous approach of computing flags in PowerShell via
 * separate Find-AstNodes calls. Instead, the PS1 script tags each element
 * with its AST node type, and this function walks those types.
 */

export function deriveSecurityFlags(
  parsed: ParsedPowerShellCommand,
): SecurityFlags {
  const flags: SecurityFlags = {
    hasSubExpressions: false,
    hasScriptBlocks: false,
    hasSplatting: false,
    hasExpandableStrings: false,
    hasMemberInvocations: false,
    hasAssignments: false,
    hasStopParsing: parsed.hasStopParsing,
  }

  function checkElements(cmd: ParsedCommandElement): void {
    if (!cmd.elementTypes) {
      return
    }
    for (const et of cmd.elementTypes) {
      switch (et) {
        case 'ScriptBlock':
          flags.hasScriptBlocks = true
          break
        case 'SubExpression':
          flags.hasSubExpressions = true
          break
        case 'ExpandableString':
          flags.hasExpandableStrings = true
          break
        case 'MemberInvocation':
          flags.hasMemberInvocations = true
          break
      }
    }
  }

  for (const stmt of parsed.statements) {
    if (stmt.statementType === 'AssignmentStatementAst') {
      flags.hasAssignments = true
    }
    for (const cmd of stmt.commands) {
      checkElements(cmd)
    }
    if (stmt.nestedCommands) {
      for (const cmd of stmt.nestedCommands) {
        checkElements(cmd)
      }
    }
    // securityPatterns provides a belt-and-suspenders check that catches
    
    
    if (stmt.securityPatterns) {
      if (stmt.securityPatterns.hasMemberInvocations) {
        flags.hasMemberInvocations = true
      }
      if (stmt.securityPatterns.hasSubExpressions) {
        flags.hasSubExpressions = true
      }
      if (stmt.securityPatterns.hasExpandableStrings) {
        flags.hasExpandableStrings = true
      }
      if (stmt.securityPatterns.hasScriptBlocks) {
        flags.hasScriptBlocks = true
      }
    }
  }

  for (const v of parsed.variables) {
    if (v.isSplatted) {
      flags.hasSplatting = true
      break
    }
  }

  return flags
}

// Raw types exported for testing (function exports are inline above)
