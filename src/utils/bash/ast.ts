

import { SHELL_KEYWORDS } from './bashParser.js'
import type { Node } from './parser.js'
import { PARSE_ABORTED, parseCommandRaw } from './parser.js'

export type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string
  fd?: number
}

export type SimpleCommand = {
  /** argv[0] is the command name, rest are arguments with quotes already resolved */
  argv: string[]
  
  envVars: { name: string; value: string }[]
  
  redirects: Redirect[]
  
  text: string
}

export type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string; nodeType?: string }
  | { kind: 'parse-unavailable' }

/**
 * Structural node types that represent composition of commands. We recurse
 * through these to find the leaf `command` nodes. `program` is the root;
 * `list` is `a && b || c`; `pipeline` is `a | b`; `redirected_statement`
 * wraps a command with its redirects. Semicolon-separated commands appear
 * as direct siblings under `program` (no wrapper node).
 */
const STRUCTURAL_TYPES = new Set([
  'program',
  'list',
  'pipeline',
  'redirected_statement',
])

const SEPARATOR_TYPES = new Set(['&&', '||', '|', ';', '&', '|&', '\n'])

const CMDSUB_PLACEHOLDER = '__CMDSUB_OUTPUT__'

const VAR_PLACEHOLDER = '__TRACKED_VAR__'

function containsAnyPlaceholder(value: string): boolean {
  return value.includes(CMDSUB_PLACEHOLDER) || value.includes(VAR_PLACEHOLDER)
}

/**
 * Unquoted $VAR in bash undergoes word-splitting (on $IFS: space/tab/NL)
 * and pathname expansion (glob matching on * ? [). Our argv stores a
 * single string — but at runtime bash may produce MULTIPLE args, or paths
 * matched by a glob. A value containing these metacharacters cannot be
 * trusted as a bare arg: `VAR="-rf /" && rm $VAR` → bash runs `rm -rf /`
 * (two args) but our argv would have `['rm', '-rf /']` (one arg). Similarly
 * `VAR="/etc/*" && cat $VAR` → bash expands to all /etc files.
 *
 * Inside double-quotes ("$VAR"), neither splitting nor globbing applies —
 * the value IS a single literal argument.
 */
const BARE_VAR_UNSAFE_RE = /[ \t\n*?[]/

const STDBUF_SHORT_SEP_RE = /^-[ioe]$/
const STDBUF_SHORT_FUSED_RE = /^-[ioe]./
const STDBUF_LONG_RE = /^--(input|output|error)=/

const SAFE_ENV_VARS = new Set([
  'HOME', // user's home directory
  'PWD', // current working directory (bash maintains)
  'OLDPWD', // previous directory
  'USER', // current username
  'LOGNAME', // login name
  'SHELL', // user's login shell
  'PATH', // executable search path
  'HOSTNAME', // machine hostname
  'UID', // user id
  'EUID', // effective user id
  'PPID', // parent process id
  'RANDOM', // random number (bash builtin)
  'SECONDS', // seconds since shell start
  'LINENO', // current line number
  'TMPDIR', // temp directory
  
  'BASH_VERSION', // bash version string
  'BASHPID', // current bash process id
  'SHLVL', // shell nesting level
  'HISTFILE', // history file path
  'IFS', // field separator (NOTE: only safe INSIDE strings; as bare arg
  
  
])

const SPECIAL_VAR_NAMES = new Set([
  '?', // exit status of last command
  '$', // current shell PID
  '!', // last background PID
  '#', // number of positional params
  '0', // script name
  '-', // shell option flags
])

const DANGEROUS_TYPES = new Set([
  'command_substitution',
  'process_substitution',
  'expansion',
  'simple_expansion',
  'brace_expression',
  'subshell',
  'compound_statement',
  'for_statement',
  'while_statement',
  'until_statement',
  'if_statement',
  'case_statement',
  'function_definition',
  'test_command',
  'ansi_c_string',
  'translated_string',
  'herestring_redirect',
  'heredoc_redirect',
])

const DANGEROUS_TYPE_IDS = [...DANGEROUS_TYPES]
export function nodeTypeId(nodeType: string | undefined): number {
  if (!nodeType) return -2
  if (nodeType === 'ERROR') return -1
  const i = DANGEROUS_TYPE_IDS.indexOf(nodeType)
  return i >= 0 ? i + 1 : 0
}

/**
 * Redirect operator tokens → canonical operator. tree-sitter produces these
 * as child nodes of `file_redirect`.
 */
const REDIRECT_OPS: Record<string, Redirect['op']> = {
  '>': '>',
  '>>': '>>',
  '<': '<',
  '>&': '>&',
  '<&': '<&',
  '>|': '>|',
  '&>': '&>',
  '&>>': '&>>',
  '<<<': '<<<',
}

/**
 * Brace expansion pattern: {a,b} or {a..b}. Must have , or .. inside
 * braces. We deliberately do NOT try to determine whether the opening brace
 * is backslash-escaped: tree-sitter doesn't unescape backslashes, so
 * distinguishing `\{a,b}` (escaped, literal) from `\\{a,b}` (literal
 * backslash + expansion) would require reimplementing bash quote removal.
 * Reject both — the escaped-brace case is rare and trivially rewritten
 * with single quotes.
 */
const BRACE_EXPANSION_RE = /\{[^{}\s]*(,|\.\.)[^{}\s]*\}/

const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/

const UNICODE_WHITESPACE_RE =
  /[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/

const BACKSLASH_WHITESPACE_RE = /\\[ \t]|[^ \t\n\\]\\\n/

const ZSH_TILDE_BRACKET_RE = /~\[/

const ZSH_EQUALS_EXPANSION_RE = /(?:^|[\s;&|])=[a-zA-Z_]/

const BRACE_WITH_QUOTE_RE = /\{[^}]*['"]/

function maskBracesInQuotedContexts(cmd: string): string {
  // Fast path: no `{` → nothing to mask. Skips the char-by-char scan for
  
  if (!cmd.includes('{')) return cmd
  const out: string[] = []
  let inSingle = false
  let inDouble = false
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]!
    if (inSingle) {
      // Bash single quotes: no escapes, `'` always terminates.
      if (c === "'") inSingle = false
      out.push(c === '{' ? ' ' : c)
      i++
    } else if (inDouble) {
      // Bash double quotes: `\` escapes `"` and `\` (also `$`, backtick,
      // newline — but those don't affect quote state so we let them pass).
      if (c === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) {
        out.push(c, cmd[i + 1]!)
        i += 2
      } else {
        if (c === '"') inDouble = false
        out.push(c === '{' ? ' ' : c)
        i++
      }
    } else {
      // Unquoted: `\` escapes any next char.
      if (c === '\\' && i + 1 < cmd.length) {
        out.push(c, cmd[i + 1]!)
        i += 2
      } else {
        if (c === "'") inSingle = true
        else if (c === '"') inDouble = true
        out.push(c)
        i++
      }
    }
  }
  return out.join('')
}

const DOLLAR = String.fromCharCode(0x24)

/**
 * Parse a bash command string and extract a flat list of simple commands.
 * Returns 'too-complex' if the command uses any shell feature we can't
 * statically analyze. Returns 'parse-unavailable' if tree-sitter WASM isn't
 * loaded — caller should fall back to conservative behavior.
 */
export async function parseForSecurity(
  cmd: string,
): Promise<ParseForSecurityResult> {
  // parseCommandRaw('') returns null (falsy check), so short-circuit here.
  // Don't use .trim() — it strips Unicode whitespace (\u00a0 etc.) which the
  // pre-checks in parseForSecurityFromAst need to see and reject.
  if (cmd === '') return { kind: 'simple', commands: [] }
  const root = await parseCommandRaw(cmd)
  return root === null
    ? { kind: 'parse-unavailable' }
    : parseForSecurityFromAst(cmd, root)
}

/**
 * Same as parseForSecurity but takes a pre-parsed AST root so callers that
 * need the tree for other purposes can parse once and share. Pre-checks
 * still run on `cmd` — they catch tree-sitter/bash differentials that a
 * successful parse doesn't.
 */
export function parseForSecurityFromAst(
  cmd: string,
  root: Node | typeof PARSE_ABORTED,
): ParseForSecurityResult {
  // Pre-checks: characters that cause tree-sitter and bash to disagree on
  // word boundaries. These run before tree-sitter because they're the known
  // tree-sitter/bash differentials. Everything after this point trusts
  // tree-sitter's tokenization.
  if (CONTROL_CHAR_RE.test(cmd)) {
    return { kind: 'too-complex', reason: 'Contains control characters' }
  }
  if (UNICODE_WHITESPACE_RE.test(cmd)) {
    return { kind: 'too-complex', reason: 'Contains Unicode whitespace' }
  }
  if (BACKSLASH_WHITESPACE_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains backslash-escaped whitespace',
    }
  }
  if (ZSH_TILDE_BRACKET_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains zsh ~[ dynamic directory syntax',
    }
  }
  if (ZSH_EQUALS_EXPANSION_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains zsh =cmd equals expansion',
    }
  }
  if (BRACE_WITH_QUOTE_RE.test(maskBracesInQuotedContexts(cmd))) {
    return {
      kind: 'too-complex',
      reason: 'Contains brace with quote character (expansion obfuscation)',
    }
  }

  const trimmed = cmd.trim()
  if (trimmed === '') {
    return { kind: 'simple', commands: [] }
  }

  if (root === PARSE_ABORTED) {
    // SECURITY: module loaded but parse aborted (timeout / node budget /
    // panic). Adversarially triggerable — `(( a[0][0]... ))` with ~2800
    // subscripts hits PARSE_TIMEOUT_MICROS under the 10K length limit.
    // Previously indistinguishable from module-not-loaded → routed to
    // legacy (parse-unavailable), which lacks EVAL_LIKE_BUILTINS — `trap`,
    // `enable`, `hash` leaked with Bash(*). Fail closed: too-complex → ask.
    return {
      kind: 'too-complex',
      reason:
        'Parser aborted (timeout or resource limit) — possible adversarial input',
      nodeType: 'PARSE_ABORT',
    }
  }

  return walkProgram(root)
}

function walkProgram(root: Node): ParseForSecurityResult {
  // ERROR-node check folded into collectCommands — any unhandled node type
  // (including ERROR) falls through to tooComplex() in the default branch.
  // Avoids a separate full-tree walk for error detection.
  const commands: SimpleCommand[] = []
  // Track variables assigned earlier in the same command. When a
  // simple_expansion ($VAR) references a tracked var, we can substitute
  // a placeholder instead of returning too-complex. Enables patterns like
  // `NOW=$(date) && jq --arg now "$NOW" ...` — $NOW is known to be the
  // $(date) output (already extracted as inner command).
  const varScope = new Map<string, string>()
  const err = collectCommands(root, commands, varScope)
  if (err) return err
  return { kind: 'simple', commands }
}

/**
 * Recursively collect leaf `command` nodes from a structural wrapper node.
 * Returns an error result on any disallowed node type, or null on success.
 */
function collectCommands(
  node: Node,
  commands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  if (node.type === 'command') {
    // Pass `commands` as the innerCommands accumulator — any $() extracted
    // during walkCommand gets appended alongside the outer command.
    const result = walkCommand(node, [], commands, varScope)
    if (result.kind !== 'simple') return result
    commands.push(...result.commands)
    return null
  }

  if (node.type === 'redirected_statement') {
    return walkRedirectedStatement(node, commands, varScope)
  }

  if (node.type === 'comment') {
    return null
  }

  if (STRUCTURAL_TYPES.has(node.type)) {
    // SECURITY: `||`, `|`, `|&`, `&` must NOT carry varScope linearly. In bash:
    //   `||` RHS runs conditionally → vars set there MAY not be set
    //   `|`/`|&` stages run in subshells → vars set there are NEVER visible after
    //   `&` LHS runs in a background subshell → same as above
    // Flag-omission attack: `true || FLAG=--dry-run && cmd $FLAG` — bash skips
    // the `||` RHS (FLAG unset → $FLAG empty), runs `cmd` WITHOUT --dry-run.
    // With linear scope, our argv has ['cmd','--dry-run'] → looks SAFE → bypass.
    //
    // Fix: snapshot incoming scope at entry. After these separators, reset to
    // the snapshot — vars set in clauses between separators don't leak. `scope`
    // for clauses BETWEEN `&&`/`;` chains shares state (common `VAR=x && cmd
    // $VAR`). `scope` crosses `||`/`|`/`&` as the pre-structure snapshot only.
    //
    // `&&` and `;` DO carry scope: `VAR=x && cmd $VAR` is sequential, VAR is set.
    //
    // NOTE: `scope` and `varScope` diverge after the first `||`/`|`/`&`. The
    // caller's varScope is only mutated for the `&&`/`;` prefix — this is
    // conservative (vars set in `A && B | C && D` leak A+B into caller, not
    // C+D) but safe.
    //
    // Efficiency: snapshot is only needed if we hit `||`/`|`/`|&`/`&`. For
    // the dominant case (`ls`, `git status` — no such separators), skip the
    // Map alloc via a cheap pre-scan. For `pipeline`, node.type already tells
    // us stages are subshells — copy once at entry, no snapshot needed (each
    // reset uses the entry copy pattern via varScope, which is untouched).
    const isPipeline = node.type === 'pipeline'
    let needsSnapshot = false
    if (!isPipeline) {
      for (const c of node.children) {
        if (c && (c.type === '||' || c.type === '&')) {
          needsSnapshot = true
          break
        }
      }
    }
    const snapshot = needsSnapshot ? new Map(varScope) : null
    // For `pipeline`, ALL stages run in subshells — start with a copy so
    // nothing mutates caller's scope. For `list`/`program`, the `&&`/`;`
    // chain mutates caller's scope (sequential); fork only on `||`/`&`.
    let scope = isPipeline ? new Map(varScope) : varScope
    for (const child of node.children) {
      if (!child) continue
      if (SEPARATOR_TYPES.has(child.type)) {
        if (
          child.type === '||' ||
          child.type === '|' ||
          child.type === '|&' ||
          child.type === '&'
        ) {
          // For pipeline: varScope is untouched (we started with a copy).
          // For list/program: snapshot is non-null (pre-scan set it).
          // `|`/`|&` only appear under `pipeline` nodes; `||`/`&` under list.
          scope = new Map(snapshot ?? varScope)
        }
        continue
      }
      const err = collectCommands(child, commands, scope)
      if (err) return err
    }
    return null
  }

  if (node.type === 'negated_command') {
    // `! cmd` inverts exit code only — doesn't execute code or affect
    // argv. Recurse into the wrapped command. Common in CI: `! grep err`,
    // `! test -f lock`, `! git diff --quiet`.
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '!') continue
      return collectCommands(child, commands, varScope)
    }
    return null
  }

  if (node.type === 'declaration_command') {
    // `export`/`local`/`readonly`/`declare`/`typeset`. tree-sitter emits
    // these as declaration_command, not command, so they previously fell
    // through to tooComplex. Values are validated via walkVariableAssignment:
    // `$()` in the value is recursively extracted (inner command pushed to
    // commands[], outer argv gets CMDSUB_PLACEHOLDER); other disallowed
    // expansions still reject via walkArgument. argv[0] is the builtin name so
    // `Bash(export:*)` rules match.
    const argv: string[] = []
    for (const child of node.children) {
      if (!child) continue
      switch (child.type) {
        case 'export':
        case 'local':
        case 'readonly':
        case 'declare':
        case 'typeset':
          argv.push(child.text)
          break
        case 'word':
        case 'number':
        case 'raw_string':
        case 'string':
        case 'concatenation': {
          // Flags (`declare -r`), quoted names (`export "FOO=bar"`), numbers
          // (`declare -i 42`). Mirrors walkCommand's argv handling — before
          // this, `export "FOO=bar"` hit tooComplex on the `string` child.
          // walkArgument validates each (expansions still reject).
          const arg = walkArgument(child, commands, varScope)
          if (typeof arg !== 'string') return arg
          // SECURITY: declare/typeset/local flags that change assignment
          // semantics break our static model. -n (nameref): `declare -n X=Y`
          // then `$X` dereferences to $Y's VALUE — varScope stores 'Y'
          // (target NAME), argv[0] shows 'Y' while bash runs whatever $Y
          // holds. -i (integer): `declare -i X='a[$(cmd)]'` arithmetically
          // evaluates the RHS at assignment time, running $(cmd) even from
          // a single-quoted raw_string (same primitive walkArithmetic
          // guards in $((…))). -a/-A (array): subscript arithmetic on
          // assignment. -r/-x/-g/-p/-f/-F are inert. Check the resolved
          // arg (not child.text) so `\-n` and quoted `-n` are caught.
          // Scope to declare/typeset/local only: `export -n` means "remove
          
          
          
          if (
            (argv[0] === 'declare' ||
              argv[0] === 'typeset' ||
              argv[0] === 'local') &&
            /^-[a-zA-Z]*[niaA]/.test(arg)
          ) {
            return {
              kind: 'too-complex',
              reason: `declare flag ${arg} changes assignment semantics (nameref/integer/array)`,
              nodeType: 'declaration_command',
            }
          }
          // SECURITY: bare positional assignment with a subscript also
          
          
          
          
          
          // export/readonly reject `[` in identifiers before eval.
          if (
            (argv[0] === 'declare' ||
              argv[0] === 'typeset' ||
              argv[0] === 'local') &&
            arg[0] !== '-' &&
            /^[^=]*\[/.test(arg)
          ) {
            return {
              kind: 'too-complex',
              reason: `declare positional '${arg}' contains array subscript — bash evaluates $(cmd) in subscripts`,
              nodeType: 'declaration_command',
            }
          }
          argv.push(arg)
          break
        }
        case 'variable_assignment': {
          const ev = walkVariableAssignment(child, commands, varScope)
          if ('kind' in ev) return ev
          
          applyVarToScope(varScope, ev)
          argv.push(`${ev.name}=${ev.value}`)
          break
        }
        case 'variable_name':
          // `export FOO` — bare name, no assignment.
          argv.push(child.text)
          break
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  if (node.type === 'variable_assignment') {
    // Bare `VAR=value` at statement level (not a command env prefix).
    
    
    // so `VAR=$(evil)` still recursively extracts/rejects based on the
    
    
    
    const ev = walkVariableAssignment(node, commands, varScope)
    if ('kind' in ev) return ev
    
    applyVarToScope(varScope, ev)
    return null
  }

  if (node.type === 'for_statement') {
    // `for VAR in WORD...; do BODY; done` — iterate BODY once per word.
    
    
    
    
    //  - Absolute paths: `for i in /etc/passwd; do rm $i; done` — body argv
    
    
    
    
    
    
    
    
    
    let loopVar: string | null = null
    let doGroup: Node | null = null
    for (const child of node.children) {
      if (!child) continue
      if (child.type === 'variable_name') {
        loopVar = child.text
      } else if (child.type === 'do_group') {
        doGroup = child
      } else if (
        child.type === 'for' ||
        child.type === 'in' ||
        child.type === 'select' ||
        child.type === ';'
      ) {
        continue 
      } else if (child.type === 'command_substitution') {
        // `for i in $(seq 1 3)` — inner cmd IS extracted and rule-checked.
        const err = collectCommandSubstitution(child, commands, varScope)
        if (err) return err
      } else {
        // Iteration values — validated via walkArgument. Value discarded:
        // body argv gets VAR_PLACEHOLDER regardless of the iteration words,
        // and bare `$i` in body → too-complex (see SECURITY comment above).
        
        
        const arg = walkArgument(child, commands, varScope)
        if (typeof arg !== 'string') return arg
      }
    }
    if (loopVar === null || doGroup === null) return tooComplex(node)
    
    
    
    if (loopVar === 'PS4' || loopVar === 'IFS') {
      return {
        kind: 'too-complex',
        reason: `${loopVar} as loop variable bypasses assignment validation`,
        nodeType: 'for_statement',
      }
    }
    // SECURITY: Body uses a scope COPY — vars assigned inside the loop
    
    
    
    varScope.set(loopVar, VAR_PLACEHOLDER)
    const bodyScope = new Map(varScope)
    for (const c of doGroup.children) {
      if (!c) continue
      if (c.type === 'do' || c.type === 'done' || c.type === ';') continue
      const err = collectCommands(c, commands, bodyScope)
      if (err) return err
    }
    return null
  }

  if (node.type === 'if_statement' || node.type === 'while_statement') {
    // `if COND; then BODY; [elif...; else...;] fi`
    
    
    
    
    
    
    
    
    
    
    
    
    
    // [elif_clause...], [else_clause], fi. We distinguish condition from
    
    let seenThen = false
    for (const child of node.children) {
      if (!child) continue
      if (
        child.type === 'if' ||
        child.type === 'fi' ||
        child.type === 'else' ||
        child.type === 'elif' ||
        child.type === 'while' ||
        child.type === 'until' ||
        child.type === ';'
      ) {
        continue
      }
      if (child.type === 'then') {
        seenThen = true
        continue
      }
      if (child.type === 'do_group') {
        // while body: recurse with scope COPY (body assignments don't leak
        // past done). The COPY contains any `read VAR` tracking from the
        // condition (already in real varScope at this point).
        const bodyScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (c.type === 'do' || c.type === 'done' || c.type === ';') continue
          const err = collectCommands(c, commands, bodyScope)
          if (err) return err
        }
        continue
      }
      if (child.type === 'elif_clause' || child.type === 'else_clause') {
        // elif_clause: elif, cond, ;, then, body... / else_clause: else, body...
        // Scope COPY — elif/else branch assignments don't leak past fi.
        const branchScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (
            c.type === 'elif' ||
            c.type === 'else' ||
            c.type === 'then' ||
            c.type === ';'
          ) {
            continue
          }
          const err = collectCommands(c, commands, branchScope)
          if (err) return err
        }
        continue
      }
      // Condition (seenThen=false) or then-body (seenThen=true).
      
      
      
      const targetScope = seenThen ? new Map(varScope) : varScope
      const before = commands.length
      const err = collectCommands(child, commands, targetScope)
      if (err) return err
      
      
      
      if (!seenThen) {
        for (let i = before; i < commands.length; i++) {
          const c = commands[i]
          if (c?.argv[0] === 'read') {
            for (const a of c.argv.slice(1)) {
              // Skip flags (-r, -d, etc.); track bare identifier args as var names.
              if (!a.startsWith('-') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) {
                // SECURITY: commands[] is a flat accumulator. `true || read
                // VAR` in the condition: the list handler correctly uses a
                
                
                
                
                
                
                
                
                
                // (no prior value or already a placeholder) → proceed.
                const existing = varScope.get(a)
                if (
                  existing !== undefined &&
                  !containsAnyPlaceholder(existing)
                ) {
                  return {
                    kind: 'too-complex',
                    reason: `'read ${a}' in condition may not execute (||/pipeline/subshell); cannot prove it overwrites tracked literal '${existing}'`,
                    nodeType: 'if_statement',
                  }
                }
                varScope.set(a, VAR_PLACEHOLDER)
              }
            }
          }
        }
      }
    }
    return null
  }

  if (node.type === 'subshell') {
    // `(cmd1; cmd2)` — run commands in a subshell. Inner commands ARE
    
    
    
    const innerScope = new Map(varScope)
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '(' || child.type === ')') continue
      const err = collectCommands(child, commands, innerScope)
      if (err) return err
    }
    return null
  }

  if (node.type === 'test_command') {
    // `[[ EXPR ]]` or `[ EXPR ]` — conditional test. Evaluates to true/false
    
    
    
    
    
    
    const argv: string[] = ['[[']
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '[[' || child.type === ']]') continue
      if (child.type === '[' || child.type === ']') continue
      
      // binary_expression, parenthesized_expression, negated_expression.
      
      const err = walkTestExpr(child, argv, commands, varScope)
      if (err) return err
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  if (node.type === 'unset_command') {
    // `unset FOO BAR`, `unset -f func`. Safe: only removes shell
    
    
    
    // `variable_name` for each name, `word` for flags like `-f`/`-v`.
    const argv: string[] = []
    for (const child of node.children) {
      if (!child) continue
      switch (child.type) {
        case 'unset':
          argv.push(child.text)
          break
        case 'variable_name':
          argv.push(child.text)
          
          
          
          varScope.delete(child.text)
          break
        case 'word': {
          const arg = walkArgument(child, commands, varScope)
          if (typeof arg !== 'string') return arg
          argv.push(arg)
          break
        }
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  return tooComplex(node)
}

/**
 * Recursively walk a test_command expression tree (unary/binary/negated/
 * parenthesized expressions). Leaves are test_operator tokens and operands
 * (word/string/number/etc). Operands are validated via walkArgument.
 */
function walkTestExpr(
  node: Node,
  argv: string[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  switch (node.type) {
    case 'unary_expression':
    case 'binary_expression':
    case 'negated_expression':
    case 'parenthesized_expression': {
      for (const c of node.children) {
        if (!c) continue
        const err = walkTestExpr(c, argv, innerCommands, varScope)
        if (err) return err
      }
      return null
    }
    case 'test_operator':
    case '!':
    case '(':
    case ')':
    case '&&':
    case '||':
    case '==':
    case '=':
    case '!=':
    case '<':
    case '>':
    case '=~':
      argv.push(node.text)
      return null
    case 'regex':
    case 'extglob_pattern':
      // RHS of =~ or ==/!= in [[ ]]. Pattern text only — no code execution.
      // Parser emits these as leaf nodes with no children (any $(...) or ${...}
      // inside the pattern is a sibling, not a child, and is walked separately).
      argv.push(node.text)
      return null
    default: {
      // Operand — word, string, number, etc. Validate via walkArgument.
      const arg = walkArgument(node, innerCommands, varScope)
      if (typeof arg !== 'string') return arg
      argv.push(arg)
      return null
    }
  }
}

/**
 * A `redirected_statement` wraps a command (or pipeline) plus one or more
 * `file_redirect`/`heredoc_redirect` nodes. Extract redirects, walk the
 * inner command, attach redirects to the LAST command (the one whose output
 * is being redirected).
 */
function walkRedirectedStatement(
  node: Node,
  commands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  const redirects: Redirect[] = []
  let innerCommand: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'file_redirect') {
      // Thread `commands` so $() in redirect targets (e.g., `> $(mktemp)`)
      
      const r = walkFileRedirect(child, commands, varScope)
      if ('kind' in r) return r
      redirects.push(r)
    } else if (child.type === 'heredoc_redirect') {
      const r = walkHeredocRedirect(child)
      if (r) return r
    } else if (
      child.type === 'command' ||
      child.type === 'pipeline' ||
      child.type === 'list' ||
      child.type === 'negated_command' ||
      child.type === 'declaration_command' ||
      child.type === 'unset_command'
    ) {
      innerCommand = child
    } else {
      return tooComplex(child)
    }
  }

  if (!innerCommand) {
    // `> file` alone is valid bash (truncates file). Represent as a command
    
    commands.push({ argv: [], envVars: [], redirects, text: node.text })
    return null
  }

  const before = commands.length
  const err = collectCommands(innerCommand, commands, varScope)
  if (err) return err
  if (commands.length > before && redirects.length > 0) {
    const last = commands[commands.length - 1]
    if (last) last.redirects.push(...redirects)
  }
  return null
}

/**
 * Extract operator + target from a `file_redirect` node. The target must be
 * a static word or string.
 */
function walkFileRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): Redirect | ParseForSecurityResult {
  let op: Redirect['op'] | null = null
  let target: string | null = null
  let fd: number | undefined

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'file_descriptor') {
      fd = Number(child.text)
    } else if (child.type in REDIRECT_OPS) {
      op = REDIRECT_OPS[child.type] ?? null
    } else if (child.type === 'word' || child.type === 'number') {
      // SECURITY: `number` nodes can contain expansion children via the
      
      
      
      if (child.children.length > 0) return tooComplex(child)
      
      
      
      
      if (BRACE_EXPANSION_RE.test(child.text)) return tooComplex(child)
      
      
      
      // but bash reads /proc/self/environ.
      target = child.text.replace(/\\(.)/g, '$1')
    } else if (child.type === 'raw_string') {
      target = stripRawString(child.text)
    } else if (child.type === 'string') {
      const s = walkString(child, innerCommands, varScope)
      if (typeof s !== 'string') return s
      target = s
    } else if (child.type === 'concatenation') {
      // `echo > "foo"bar` — tree-sitter produces a concatenation of string +
      
      
      const s = walkArgument(child, innerCommands, varScope)
      if (typeof s !== 'string') return s
      target = s
    } else {
      return tooComplex(child)
    }
  }

  if (!op || target === null) {
    return {
      kind: 'too-complex',
      reason: 'Unrecognized redirect shape',
      nodeType: node.type,
    }
  }
  return { op, target, fd }
}

/**
 * Heredoc redirect. Only quoted-delimiter heredocs (<<'EOF') are safe —
 * their bodies are literal text. Unquoted-delimiter heredocs (<<EOF)
 * undergo full parameter/command/arithmetic expansion in the body.
 *
 * SECURITY: tree-sitter-bash has a grammar gap — backticks (`...`) inside
 * an unquoted heredoc body are NOT parsed as command_substitution nodes
 * (body.children is empty, backticks are in body.text). But bash DOES
 * execute them. We cannot safely relax the quoted-delimiter requirement
 * by checking body children for expansion nodes — we'd miss backtick
 * substitution. Keep rejecting all unquoted heredocs. Users should use
 * <<'EOF' to get a literal body, which the model already prefers.
 */
function walkHeredocRedirect(node: Node): ParseForSecurityResult | null {
  let startText: string | null = null
  let body: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'heredoc_start') startText = child.text
    else if (child.type === 'heredoc_body') body = child
    else if (
      child.type === '<<' ||
      child.type === '<<-' ||
      child.type === 'heredoc_end' ||
      child.type === 'file_descriptor'
    ) {
      // expected structural tokens — safe to skip. file_descriptor
      // covers fd-prefixed heredocs (`cat 3<<'EOF'`) — walkFileRedirect
      // already treats it as a benign structural token.
    } else {
      // SECURITY: tree-sitter places pipeline / command / file_redirect /
      // && / etc. as children of heredoc_redirect when they follow the
      // delimiter on the same line (e.g. `ls <<'EOF' | rm x`). Previously
      // these were silently skipped, hiding the piped command from
      // permission checks. Fail closed like every other walker.
      return tooComplex(child)
    }
  }

  const isQuoted =
    startText !== null &&
    ((startText.startsWith("'") && startText.endsWith("'")) ||
      (startText.startsWith('"') && startText.endsWith('"')) ||
      startText.startsWith('\\'))

  if (!isQuoted) {
    return {
      kind: 'too-complex',
      reason: 'Heredoc with unquoted delimiter undergoes shell expansion',
      nodeType: 'heredoc_redirect',
    }
  }

  if (body) {
    for (const child of body.children) {
      if (!child) continue
      if (child.type !== 'heredoc_content') {
        return tooComplex(child)
      }
    }
  }
  return null
}

/**
 * Here-string redirect (`<<< content`). The content becomes stdin — not
 * argv, not a path. Safe when content is a literal word, raw_string, or
 * string with no expansions. Reject when content contains $()/${}/$VAR —
 * those execute arbitrary code or inject runtime values.
 *
 * Reuses walkArgument for content validation: it already rejects
 * command_substitution, expansion, and (for strings) simple_expansion
 * unless the var is tracked/safe. The result string is discarded — we only
 * care that it's statically resolvable.
 *
 * NOTE: `VAR=$(cmd) && cat <<< "$VAR"` would be safe in principle (inner
 * cmd is extracted separately, herestring content is stdin) but is
 * currently rejected conservatively — walkString's solo-placeholder guard
 * fires because it has no awareness of herestring vs argv context.
 */
function walkHerestringRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  for (const child of node.children) {
    if (!child) continue
    if (child.type === '<<<') continue
    // Content node: reuse walkArgument. It returns a string on success
    // (which we discard — content is stdin, irrelevant to permissions) or
    // a too-complex result on failure (expansion found, unresolvable var).
    const content = walkArgument(child, innerCommands, varScope)
    if (typeof content !== 'string') return content
    // Herestring content is discarded (not in argv/envVars/redirects) but
    // remains in .text via raw node.text. Scan it here so checkSemantics's
    
    if (NEWLINE_HASH_RE.test(content)) return tooComplex(child)
  }
  return null
}

/**
 * Walk a `command` node and extract argv. Children appear in order:
 * [variable_assignment...] command_name [argument...] [file_redirect...]
 * Any child type not explicitly handled triggers too-complex.
 */
function walkCommand(
  node: Node,
  extraRedirects: Redirect[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult {
  const argv: string[] = []
  const envVars: { name: string; value: string }[] = []
  const redirects: Redirect[] = [...extraRedirects]

  for (const child of node.children) {
    if (!child) continue

    switch (child.type) {
      case 'variable_assignment': {
        const ev = walkVariableAssignment(child, innerCommands, varScope)
        if ('kind' in ev) return ev
        
        // bash — VAR is only visible to `cmd` as an env var, NOT to
        
        
        envVars.push({ name: ev.name, value: ev.value })
        break
      }
      case 'command_name': {
        const arg = walkArgument(
          child.children[0] ?? child,
          innerCommands,
          varScope,
        )
        if (typeof arg !== 'string') return arg
        argv.push(arg)
        break
      }
      case 'word':
      case 'number':
      case 'raw_string':
      case 'string':
      case 'concatenation':
      case 'arithmetic_expansion': {
        const arg = walkArgument(child, innerCommands, varScope)
        if (typeof arg !== 'string') return arg
        argv.push(arg)
        break
      }
      // NOTE: command_substitution as a BARE argument (not inside a string)
      
      // and for path-sensitive commands (cd, rm, chmod) the placeholder would
      
      
      
      
      case 'simple_expansion': {
        // Bare `$VAR` as an argument. Tracked static vars return the ACTUAL
        
        
        const v = resolveSimpleExpansion(child, varScope, false)
        if (typeof v !== 'string') return v
        argv.push(v)
        break
      }
      case 'file_redirect': {
        const r = walkFileRedirect(child, innerCommands, varScope)
        if ('kind' in r) return r
        redirects.push(r)
        break
      }
      case 'herestring_redirect': {
        // `cmd <<< "content"` — content is stdin, not argv. Validate it's
        // literal (no expansion); discard the content string.
        const err = walkHerestringRedirect(child, innerCommands, varScope)
        if (err) return err
        break
      }
      default:
        return tooComplex(child)
    }
  }

  // .text is the raw source span. Downstream (bashToolCheckPermission →
  // splitCommand_DEPRECATED) re-tokenizes it via shell-quote. Normally .text
  // is used unchanged — but if we resolved a $VAR into argv, .text diverges
  // (has raw `$VAR`) and downstream RULE MATCHING would miss deny rules.
  //
  // SECURITY: `SUB=push && git $SUB --force` with `Bash(git push:*)` deny:
  //   argv = ['git', 'push', '--force']  ← correct, path validation sees 'push'
  //   .text = 'git $SUB --force'         ← deny rule 'git push:*' doesn't match
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  const text =
    /\$[A-Za-z_]/.test(node.text) || node.text.includes('\n')
      ? argv
          .map(a =>
            a === '' || /["'\\ \t\n$`;|&<>(){}*?[\]~#]/.test(a)
              ? `'${a.replace(/'/g, "'\\''")}'`
              : a,
          )
          .join(' ')
      : node.text
  return {
    kind: 'simple',
    commands: [{ argv, envVars, redirects, text }],
  }
}

/**
 * Recurse into a command_substitution node's inner command(s). If the inner
 * command(s) parse cleanly (simple), add them to the innerCommands
 * accumulator and return null (success). If the inner command is itself
 * too-complex (e.g., nested arith expansion, process sub), return the error.
 * This enables recursive permission checking: `echo $(git rev-parse HEAD)`
 * extracts BOTH `echo $(git rev-parse HEAD)` (outer) AND `git rev-parse HEAD`
 * (inner) — permission rules must match BOTH for the whole command to allow.
 */
function collectCommandSubstitution(
  csNode: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  // Vars set BEFORE the $() are visible inside (bash subshell semantics),
  // but vars set INSIDE don't leak out. Pass a COPY of the outer scope so
  // inner assignments don't mutate the outer map.
  const innerScope = new Map(varScope)
  
  for (const child of csNode.children) {
    if (!child) continue
    if (child.type === '$(' || child.type === '`' || child.type === ')') {
      continue
    }
    const err = collectCommands(child, innerCommands, innerScope)
    if (err) return err
  }
  return null
}

/**
 * Convert an argument node to its literal string value. Quotes are resolved.
 * This function implements the argument-position allowlist.
 */
function walkArgument(
  node: Node | null,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): string | ParseForSecurityResult {
  if (!node) {
    return { kind: 'too-complex', reason: 'Null argument node' }
  }

  switch (node.type) {
    case 'word': {
      // Unescape backslash sequences. In unquoted context, bash's quote
      // removal turns `\X` → `X` for any character X. tree-sitter preserves
      // the raw text. Required for checkSemantics: `\eval` must match
      // EVAL_LIKE_BUILTINS, `\zmodload` must match ZSH_DANGEROUS_BUILTINS.
      // Also makes argv accurate: `find -exec {} \;` → argv has `;` not
      // `\;`. (Deny-rule matching on .text already worked via downstream
      // splitCommand_DEPRECATED unescaping — see walkCommand comment.) `\<whitespace>`
      // is already rejected by BACKSLASH_WHITESPACE_RE.
      if (BRACE_EXPANSION_RE.test(node.text)) {
        return {
          kind: 'too-complex',
          reason: 'Word contains brace expansion syntax',
          nodeType: 'word',
        }
      }
      return node.text.replace(/\\(.)/g, '$1')
    }

    case 'number':
      // SECURITY: tree-sitter-bash parses `NN#<expansion>` (arithmetic base
      // syntax) as a `number` node with the expansion as a CHILD. `10#$(cmd)`
      // is a number node whose .text is the full literal but whose child is a
      // command_substitution — bash runs the substitution. .text on a node
      // with children would smuggle the expansion past permission checks.
      // Plain numbers (`10`, `16#ff`) have zero children.
      if (node.children.length > 0) {
        return {
          kind: 'too-complex',
          reason: 'Number node contains expansion (NN# arithmetic base syntax)',
          nodeType: node.children[0]?.type,
        }
      }
      return node.text

    case 'raw_string':
      return stripRawString(node.text)

    case 'string':
      return walkString(node, innerCommands, varScope)

    case 'concatenation': {
      if (BRACE_EXPANSION_RE.test(node.text)) {
        return {
          kind: 'too-complex',
          reason: 'Brace expansion',
          nodeType: 'concatenation',
        }
      }
      let result = ''
      for (const child of node.children) {
        if (!child) continue
        const part = walkArgument(child, innerCommands, varScope)
        if (typeof part !== 'string') return part
        result += part
      }
      return result
    }

    case 'arithmetic_expansion': {
      const err = walkArithmetic(node)
      if (err) return err
      return node.text
    }

    case 'simple_expansion': {
      // `$VAR` inside a concatenation (e.g., `prefix$VAR`). Same rules
      // as the bare case in walkCommand: must be tracked or SAFE_ENV_VARS.
      // inside-concatenation counts as bare arg (the whole concat IS the arg)
      return resolveSimpleExpansion(node, varScope, false)
    }

    // NOTE: command_substitution at arg position (bare or inside concatenation)
    // is intentionally NOT handled — the output is/becomes-part-of a positional
    // argument which might be a path or flag. `rm $(foo)` or `rm $(foo)bar`
    // would hide the real path behind the placeholder. Only $() inside a
    // `string` node (walkString) is extracted, since the output is embedded
    // in a longer string rather than BEING the argument.

    default:
      return tooComplex(node)
  }
}

/**
 * Extract literal content from a double-quoted string node. A `string` node's
 * children are `"` delimiters, `string_content` literals, and possibly
 * expansion nodes.
 *
 * tree-sitter quirk: literal newlines inside double quotes are NOT included
 * in `string_content` node text. bash preserves them. For `"a\nb"`,
 * tree-sitter produces two `string_content` children (`"a"`, `"b"`) with the
 * newline in neither. For `"\n#"`, it produces ONE child (`"#"`) with the
 * leading newline eaten. Concatenating children therefore loses newlines.
 *
 * Fix: track child `startIndex` and insert one `\n` per index gap. The gap
 * between children IS the dropped newline(s). This makes the argv value
 * match what bash actually sees.
 */
function walkString(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): string | ParseForSecurityResult {
  let result = ''
  let cursor = -1
  
  
  
  
  
  
  
  
  
  let sawDynamicPlaceholder = false
  let sawLiteralContent = false
  for (const child of node.children) {
    if (!child) continue
    
    
    
    
    
    
    if (cursor !== -1 && child.startIndex > cursor && child.type !== '"') {
      result += '\n'.repeat(child.startIndex - cursor)
      sawLiteralContent = true
    }
    cursor = child.endIndex
    switch (child.type) {
      case '"':
        // Reset cursor after opening quote so the gap between `"` and the
        
        cursor = child.endIndex
        break
      case 'string_content':
        // Bash double-quote escape rules (NOT the generic /\\(.)/g used for
        
        
        
        
        
        result += child.text.replace(/\\([$`"\\])/g, '$1')
        sawLiteralContent = true
        break
      case DOLLAR:
        // A bare dollar sign before closing quote or a non-name char is
        
        result += DOLLAR
        sawLiteralContent = true
        break
      case 'command_substitution': {
        // Carve-out: `$(cat <<'EOF' ... EOF)` is safe. The quoted-delimiter
        
        
        
        
        
        
        const heredocBody = extractSafeCatHeredoc(child)
        if (heredocBody === 'DANGEROUS') return tooComplex(child)
        if (heredocBody !== null) {
          // SECURITY: the body IS the substitution result. Previously we
          
          
          
          
          
          
          
          
          
          
          
          const trimmed = heredocBody.replace(/\n+$/, '')
          if (trimmed.includes('\n')) {
            sawLiteralContent = true
            break
          }
          result += trimmed
          sawLiteralContent = true
          break
        }
        // General $() inside "...": recurse into inner command(s). If they
        
        
        
        
        
        
        const err = collectCommandSubstitution(child, innerCommands, varScope)
        if (err) return err
        result += CMDSUB_PLACEHOLDER
        sawDynamicPlaceholder = true
        break
      }
      case 'simple_expansion': {
        // `$VAR` inside "...". Tracked/safe vars resolve; untracked reject.
        const v = resolveSimpleExpansion(child, varScope, true)
        if (typeof v !== 'string') return v
        
        // SAFE_ENV_VARS, special vars). Any other string = actual literal
        
        if (v === VAR_PLACEHOLDER) sawDynamicPlaceholder = true
        else sawLiteralContent = true
        result += v
        break
      }
      case 'arithmetic_expansion': {
        const err = walkArithmetic(child)
        if (err) return err
        result += child.text
        
        sawLiteralContent = true
        break
      }
      default:
        // expansion (${...}) inside "..."
        return tooComplex(child)
    }
  }
  // SECURITY: Reject solo-placeholder strings. `"$(cmd)"` or `"$VAR"` (where
  
  
  
  
  if (sawDynamicPlaceholder && !sawLiteralContent) {
    return tooComplex(node)
  }
  // SECURITY: tree-sitter-bash quirk — a double-quoted string containing
  
  // the whitespace is attributed to the closing `"` node's text. Our loop
  // only adds to `result` from string_content/expansion children, so we'd
  
  
  
  
  
  if (!sawLiteralContent && !sawDynamicPlaceholder && node.text.length > 2) {
    return tooComplex(node)
  }
  return result
}

/**
 * Safe leaf nodes inside arithmetic expansion: integer literals (decimal,
 * hex, octal, bash base#digits) and operator/paren tokens. Anything else at
 * leaf position (notably variable_name that isn't a numeric literal) rejects.
 */
const ARITH_LEAF_RE =
  /^(?:[0-9]+|0[xX][0-9a-fA-F]+|[0-9]+#[0-9a-zA-Z]+|[-+*/%^&|~!<>=?:(),]+|<<|>>|\*\*|&&|\|\||[<>=!]=|\$\(\(|\)\))$/

/**
 * Recursively validate an arithmetic_expansion node. Allows only literal
 * numeric expressions — no variables, no substitutions. Returns null if
 * safe, or a too-complex result if not.
 *
 * Variables are rejected because bash arithmetic recursively evaluates
 * variable values: if x='a[$(cmd)]' then $((x)) executes cmd. See
 * https://www.vidarholen.net/contents/blog/?p=716 (arithmetic injection).
 *
 * When safe, the caller puts the full `$((…))` span into argv as a literal
 * string. bash will expand it to an integer at runtime; the static string
 * won't match any sensitive path/deny patterns.
 */
function walkArithmetic(node: Node): ParseForSecurityResult | null {
  for (const child of node.children) {
    if (!child) continue
    if (child.children.length === 0) {
      if (!ARITH_LEAF_RE.test(child.text)) {
        return {
          kind: 'too-complex',
          reason: `Arithmetic expansion references variable or non-literal: ${child.text}`,
          nodeType: 'arithmetic_expansion',
        }
      }
      continue
    }
    switch (child.type) {
      case 'binary_expression':
      case 'unary_expression':
      case 'ternary_expression':
      case 'parenthesized_expression': {
        const err = walkArithmetic(child)
        if (err) return err
        break
      }
      default:
        return tooComplex(child)
    }
  }
  return null
}

/**
 * Check if a command_substitution node is exactly `$(cat <<'DELIM'...DELIM)`
 * and return the heredoc body if so. Any deviation (extra args to cat,
 * unquoted delimiter, additional commands) returns null.
 *
 * tree-sitter structure:
 *   command_substitution
 *     $(
 *     redirected_statement
 *       command → command_name → word "cat"    (exactly one child)
 *       heredoc_redirect
 *         <<
 *         heredoc_start 'DELIM'                (quoted)
 *         heredoc_body                         (pure heredoc_content)
 *         heredoc_end
 *     )
 */
function extractSafeCatHeredoc(subNode: Node): string | 'DANGEROUS' | null {
  // Expect exactly: $( + one redirected_statement + )
  let stmt: Node | null = null
  for (const child of subNode.children) {
    if (!child) continue
    if (child.type === '$(' || child.type === ')') continue
    if (child.type === 'redirected_statement' && stmt === null) {
      stmt = child
    } else {
      return null
    }
  }
  if (!stmt) return null

  
  let sawCat = false
  let body: string | null = null
  for (const child of stmt.children) {
    if (!child) continue
    if (child.type === 'command') {
      // Must be bare `cat` — no args, no env vars
      const cmdChildren = child.children.filter(c => c)
      if (cmdChildren.length !== 1) return null
      const nameNode = cmdChildren[0]
      if (nameNode?.type !== 'command_name' || nameNode.text !== 'cat') {
        return null
      }
      sawCat = true
    } else if (child.type === 'heredoc_redirect') {
      // Reuse the existing validator: quoted delimiter, body is pure text.
      
      if (walkHeredocRedirect(child) !== null) return null
      for (const hc of child.children) {
        if (hc?.type === 'heredoc_body') body = hc.text
      }
    } else {
      return null
    }
  }

  if (!sawCat || body === null) return null
  
  
  
  
  
  // which would extract the inner `cat` via walkHeredocRedirect (body text
  
  
  if (PROC_ENVIRON_RE.test(body)) return 'DANGEROUS'
  
  
  if (/\bsystem\s*\(/.test(body)) return 'DANGEROUS'
  return body
}

function walkVariableAssignment(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): { name: string; value: string; isAppend: boolean } | ParseForSecurityResult {
  let name: string | null = null
  let value = ''
  let isAppend = false

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'variable_name') {
      name = child.text
    } else if (child.type === '=' || child.type === '+=') {
      // `PATH+=":/new"` — tree-sitter emits `+=` as a distinct operator
      
      
      isAppend = child.type === '+='
      continue
    } else if (child.type === 'command_substitution') {
      // $() as the variable's value. The output becomes a STRING stored in
      // the variable — it's NOT a positional argument (no path/flag concern).
      
      
      
      const err = collectCommandSubstitution(child, innerCommands, varScope)
      if (err) return err
      value = CMDSUB_PLACEHOLDER
    } else if (child.type === 'simple_expansion') {
      // `VAR=$OTHER` — assignment RHS does NOT word-split or glob-expand
      
      
      
      
      
      const v = resolveSimpleExpansion(child, varScope, true)
      if (typeof v !== 'string') return v
      
      
      value = v
    } else {
      const v = walkArgument(child, innerCommands, varScope)
      if (typeof v !== 'string') return v
      value = v
    }
  }

  if (name === null) {
    return {
      kind: 'too-complex',
      reason: 'Variable assignment without name',
      nodeType: 'variable_assignment',
    }
  }
  // SECURITY: tree-sitter-bash accepts invalid var names (e.g. `1VAR=value`)
  
  
  
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return {
      kind: 'too-complex',
      reason: `Invalid variable name (bash treats as command): ${name}`,
      nodeType: 'variable_assignment',
    }
  }
  // SECURITY: Setting IFS changes word-splitting behavior for subsequent
  
  
  
  if (name === 'IFS') {
    return {
      kind: 'too-complex',
      reason: 'IFS assignment changes word-splitting — cannot model statically',
      nodeType: 'variable_assignment',
    }
  }
  // SECURITY: PS4 is expanded via promptvars (default on) on every command
  
  
  
  
  // non-interactive shells (BashTool).
  
  
  
  //   - `+=` effective-value computation diverges from bash in multiple
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  if (name === 'PS4') {
    if (isAppend) {
      return {
        kind: 'too-complex',
        reason:
          'PS4 += cannot be statically verified — combine into a single PS4= assignment',
        nodeType: 'variable_assignment',
      }
    }
    if (containsAnyPlaceholder(value)) {
      return {
        kind: 'too-complex',
        reason: 'PS4 value derived from cmdsub/variable — runtime unknowable',
        nodeType: 'variable_assignment',
      }
    }
    if (
      !/^[A-Za-z0-9 _+:./=[\]-]*$/.test(
        value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''),
      )
    ) {
      return {
        kind: 'too-complex',
        reason:
          'PS4 value outside safe charset — only ${VAR} refs and [A-Za-z0-9 _+:.=/[]-] allowed',
        nodeType: 'variable_assignment',
      }
    }
  }
  // SECURITY: Tilde expansion in assignment RHS. `VAR=~/x` (unquoted) →
  
  
  
  // assignment values (e.g. PATH=~/bin:~/sbin). We can't model it — reject
  // any value containing `~` that isn't already quoted-literal (where bash
  
  if (value.includes('~')) {
    return {
      kind: 'too-complex',
      reason: 'Tilde in assignment value — bash may expand at assignment time',
      nodeType: 'variable_assignment',
    }
  }
  return { name, value, isAppend }
}

/**
 * Resolve a `simple_expansion` ($VAR) node. Returns VAR_PLACEHOLDER if
 * resolvable, too-complex otherwise.
 *
 * @param insideString true when $VAR is inside a `string` node ("...$VAR...")
 *   rather than a bare/concatenation argument. SAFE_ENV_VARS and unknown-value
 *   tracked vars are only allowed inside strings — as bare args their runtime
 *   value IS the argument and we don't know it statically.
 *   `cd $HOME/../x` would hide the real path behind the placeholder;
 *   `echo "Home: $HOME"` just embeds text in a string. Tracked vars holding
 *   STATIC strings (VAR=literal) are allowed in both positions since their
 *   value IS known.
 */
function resolveSimpleExpansion(
  node: Node,
  varScope: Map<string, string>,
  insideString: boolean,
): string | ParseForSecurityResult {
  let varName: string | null = null
  let isSpecial = false
  for (const c of node.children) {
    if (c?.type === 'variable_name') {
      varName = c.text
      break
    }
    if (c?.type === 'special_variable_name') {
      varName = c.text
      isSpecial = true
      break
    }
  }
  if (varName === null) return tooComplex(node)
  // Tracked vars: check stored value. Literal strings (VAR=/tmp) are
  // returned DIRECTLY so downstream path validation sees the real path.
  // Non-literal values (containing any placeholder — loop vars, $() output,
  // read vars, composites like `VAR="prefix$(cmd)"`) are ONLY safe inside
  // strings; as bare args they'd hide the runtime path/flag from validation.
  
  
  
  
  
  const trackedValue = varScope.get(varName)
  if (trackedValue !== undefined) {
    if (containsAnyPlaceholder(trackedValue)) {
      // Non-literal: bare → reject, inside string → VAR_PLACEHOLDER
      
      if (!insideString) return tooComplex(node)
      return VAR_PLACEHOLDER
    }
    // Pure literal (e.g. '/tmp', 'foo') — return it directly. Downstream
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    if (!insideString) {
      if (trackedValue === '') return tooComplex(node)
      if (BARE_VAR_UNSAFE_RE.test(trackedValue)) return tooComplex(node)
    }
    return trackedValue
  }
  // SAFE_ENV_VARS + special vars ($?, $$, $@, $1, etc.): value unknown
  
  
  if (insideString) {
    if (SAFE_ENV_VARS.has(varName)) return VAR_PLACEHOLDER
    if (
      isSpecial &&
      (SPECIAL_VAR_NAMES.has(varName) || /^[0-9]+$/.test(varName))
    ) {
      return VAR_PLACEHOLDER
    }
  }
  return tooComplex(node)
}

/**
 * Apply a variable assignment to the scope, handling `+=` append semantics.
 * SECURITY: If EITHER side (existing value or appended value) contains a
 * placeholder, the result is non-literal — store VAR_PLACEHOLDER so later
 * $VAR correctly rejects as bare arg.
 * `VAR=/etc && VAR+=$(cmd)` must not leave VAR looking static.
 */
function applyVarToScope(
  varScope: Map<string, string>,
  ev: { name: string; value: string; isAppend: boolean },
): void {
  const existing = varScope.get(ev.name) ?? ''
  const combined = ev.isAppend ? existing + ev.value : ev.value
  varScope.set(
    ev.name,
    containsAnyPlaceholder(combined) ? VAR_PLACEHOLDER : combined,
  )
}

function stripRawString(text: string): string {
  return text.slice(1, -1)
}

function tooComplex(node: Node): ParseForSecurityResult {
  const reason =
    node.type === 'ERROR'
      ? 'Parse error'
      : DANGEROUS_TYPES.has(node.type)
        ? `Contains ${node.type}`
        : `Unhandled node type: ${node.type}`
  return { kind: 'too-complex', reason, nodeType: node.type }
}

// ────────────────────────────────────────────────────────────────────────────
// Post-argv semantic checks
//
// Everything above answers "can we tokenize?". Everything below answers
// "is the resulting argv dangerous in ways that don't involve parsing?".
// These are checks on argv[0] or argv content that the old bashSecurity.ts
// validators performed but which have nothing to do with parser
// differentials. They're here (not in bashSecurity.ts) because they operate
// on SimpleCommand and need to run for every extracted command.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Zsh module builtins. These are not binaries on PATH — they're zsh
 * internals loaded via zmodload. Since BashTool runs via the user's default
 * shell (often zsh), and these parse as plain `command` nodes with no
 * distinguishing syntax, we can only catch them by name.
 */
const ZSH_DANGEROUS_BUILTINS = new Set([
  'zmodload',
  'emulate',
  'sysopen',
  'sysread',
  'syswrite',
  'sysseek',
  'zpty',
  'ztcp',
  'zsocket',
  'zf_rm',
  'zf_mv',
  'zf_ln',
  'zf_chmod',
  'zf_chown',
  'zf_mkdir',
  'zf_rmdir',
  'zf_chgrp',
])

/**
 * Shell builtins that evaluate their arguments as code or otherwise escape
 * the argv abstraction. A command like `eval "rm -rf /"` has argv
 * ['eval', 'rm -rf /'] which looks inert to flag validation but executes
 * the string. Treat these the same as command substitution.
 */
const EVAL_LIKE_BUILTINS = new Set([
  'eval',
  'source',
  '.',
  'exec',
  'command',
  'builtin',
  'fc',
  // `coproc rm -rf /` spawns rm as a coprocess. tree-sitter parses it as
  // a plain command with argv[0]='coproc', so permission rules and path
  // validation would check 'coproc' not 'rm'.
  'coproc',
  // Zsh precommand modifiers: `noglob cmd args` runs cmd with globbing off.
  // They parse as ordinary commands (noglob is argv[0], the real command is
  // argv[1]) so permission matching against argv[0] would see 'noglob', not
  // the wrapped command.
  'noglob',
  'nocorrect',
  // `trap 'cmd' SIGNAL` — cmd runs as shell code on signal/exit. EXIT fires
  // at end of every BashTool invocation, so this is guaranteed execution.
  'trap',
  // `enable -f /path/lib.so name` — dlopen arbitrary .so as a builtin.
  // Native code execution.
  'enable',
  // `mapfile -C callback -c N` / `readarray -C callback` — callback runs as
  // shell code every N input lines.
  'mapfile',
  'readarray',
  // `hash -p /path cmd` — poisons bash's command-lookup cache. Subsequent
  // `cmd` in the same command resolves to /path instead of PATH lookup.
  'hash',
  // `bind -x '"key":cmd'` / `complete -C cmd` — interactive-only callbacks
  // but still code-string arguments. Low impact in non-interactive BashTool
  // shells, blocked for consistency. `compgen -C cmd` is NOT interactive-only:
  // it immediately executes the -C argument to generate completions.
  'bind',
  'complete',
  'compgen',
  // `alias name='cmd'` — aliases not expanded in non-interactive bash by
  // default, but `shopt -s expand_aliases` enables them. Also blocked as
  // defense-in-depth (alias followed by name use in same command).
  'alias',
  // `let EXPR` arithmetically evaluates EXPR — identical to $(( EXPR )).
  // Array subscripts in the expression expand $(cmd) at eval time even when
  // the argument arrived single-quoted: `let 'x=a[$(id)]'` executes id.
  // tree-sitter sees the raw_string as an opaque leaf. Same primitive
  // walkArithmetic guards, but `let` is a plain command node.
  'let',
])

/**
 * Builtins that re-parse a NAME operand internally and arithmetically
 * evaluate `arr[EXPR]` subscripts — including $(cmd) in the subscript —
 * even when the argv element arrived from a single-quoted raw_string.
 * `test -v 'a[$(id)]'` → tree-sitter sees an opaque leaf, bash runs id.
 * Maps: builtin name → set of flags whose next argument is a NAME.
 */
const SUBSCRIPT_EVAL_FLAGS: Record<string, Set<string>> = {
  test: new Set(['-v', '-R']),
  '[': new Set(['-v', '-R']),
  '[[': new Set(['-v', '-R']),
  printf: new Set(['-v']),
  read: new Set(['-a']),
  unset: new Set(['-v']),
  // bash 5.1+: `wait -p VAR [id...]` stores the waited PID into VAR. When VAR
  // is `arr[EXPR]`, bash arithmetically evaluates the subscript — running
  // $(cmd) even from a single-quoted raw_string. Verified bash 5.3.9:
  // `: & wait -p 'a[$(id)]' %1` executes id.
  wait: new Set(['-p']),
}

/**
 * `[[ ARG1 OP ARG2 ]]` where OP is an arithmetic comparison. bash manual:
 * "When used with [[, Arg1 and Arg2 are evaluated as arithmetic
 * expressions." Arithmetic evaluation recursively expands array subscripts,
 * so `[[ 'a[$(id)]' -eq 0 ]]` executes `id` even though tree-sitter sees
 * the operand as an opaque raw_string leaf. Unlike -v/-R (unary, NAME after
 * flag), these are binary — the subscript can appear on EITHER side, so
 * SUBSCRIPT_EVAL_FLAGS's "next arg" logic is insufficient.
 * `[` / `test` are not vulnerable (bash errors with "integer expression
 * expected"), but the test_command handler normalizes argv[0]='[[' for
 * both forms, so they get this check too — mild over-blocking, safe side.
 */
const TEST_ARITH_CMP_OPS = new Set(['-eq', '-ne', '-lt', '-le', '-gt', '-ge'])

/**
 * Builtins where EVERY non-flag positional argument is a NAME that bash
 * re-parses and arithmetically evaluates subscripts on — no flag required.
 * `read 'a[$(id)]'` executes id: each positional is a variable name to
 * assign into, and `arr[EXPR]` is valid syntax there. `unset NAME...` is
 * the same (though tree-sitter's unset_command handler currently rejects
 * raw_string children before reaching here — this is defense-in-depth).
 * NOT printf (positional args are FORMAT/data), NOT test/[ (operands are
 * values, only -v/-R take a NAME). declare/typeset/local handled in
 * declaration_command since they never reach here as plain commands.
 */
const BARE_SUBSCRIPT_NAME_BUILTINS = new Set(['read', 'unset'])

/**
 * `read` flags whose NEXT argument is data (prompt/delimiter/count/fd),
 * not a NAME. `read -p '[foo] ' var` must not trip on the `[` in the
 * prompt string. `-a` is intentionally absent — its operand IS a NAME.
 */
const READ_DATA_FLAGS = new Set(['-p', '-d', '-n', '-N', '-t', '-u', '-i'])

// SHELL_KEYWORDS imported from bashParser.ts — shell reserved words can never
// be legitimate argv[0]; if they appear, the parser mis-parsed a compound
// command. Reject to avoid nonsense argv reaching downstream.

// Use `.*` not `[^/]*` — Linux resolves `..` in procfs, so
// `/proc/self/../self/environ` works and must be caught.
const PROC_ENVIRON_RE = /\/proc\/.*\/environ/

const NEWLINE_HASH_RE = /\n[ \t]*#/

export type SemanticCheckResult = { ok: true } | { ok: false; reason: string }

/**
 * Post-argv semantic checks. Run after parseForSecurity returns 'simple' to
 * catch commands that tokenize fine but are dangerous by name or argument
 * content. Returns the first failure or {ok: true}.
 */
export function checkSemantics(commands: SimpleCommand[]): SemanticCheckResult {
  for (const cmd of commands) {
    // Strip safe wrapper commands (nohup, time, timeout N, nice -n N) so
    
    
    
    let a = cmd.argv
    for (;;) {
      if (a[0] === 'time' || a[0] === 'nohup') {
        a = a.slice(1)
      } else if (a[0] === 'timeout') {
        // `timeout 5`, `timeout 5s`, `timeout 5.5`, plus optional GNU flags
        
        // --signal=SIG, --preserve-status. Short: -k DUR, -s SIG, -v (also
        
        
        
        
        
        
        
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (
            arg === '--foreground' ||
            arg === '--preserve-status' ||
            arg === '--verbose'
          ) {
            i++ 
          } else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) {
            i++ 
          } else if (
            (arg === '--kill-after' || arg === '--signal') &&
            a[i + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(a[i + 1]!)
          ) {
            i += 2 
          } else if (arg.startsWith('--')) {
            // Unknown long flag, OR --kill-after/--signal with non-allowlisted
            
            return {
              ok: false,
              reason: `timeout with ${arg} flag cannot be statically analyzed`,
            }
          } else if (arg === '-v') {
            i++ 
          } else if (
            (arg === '-k' || arg === '-s') &&
            a[i + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(a[i + 1]!)
          ) {
            i += 2 
          } else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) {
            i++ 
          } else if (arg.startsWith('-')) {
            // Unknown flag OR -k/-s with non-allowlisted value — can't locate
            // wrapped cmd. Reject, don't fall through to name='timeout'.
            return {
              ok: false,
              reason: `timeout with ${arg} flag cannot be statically analyzed`,
            }
          } else {
            break 
          }
        }
        if (a[i] && /^\d+(?:\.\d+)?[smhd]?$/.test(a[i]!)) {
          a = a.slice(i + 1)
        } else if (a[i]) {
          // SECURITY (PR #21503 round 3): a[i] exists but doesn't match our
          // duration regex. GNU timeout parses via xstrtod() (libc strtod) and
          // accepts `.5`, `+5`, `5e-1`, `inf`, `infinity`, hex floats — none
          // of which match `/^\d+(\.\d+)?[smhd]?$/`. Empirically verified:
          // `timeout .5 echo ok` works. Previously this branch `break`ed
          // (fail-OPEN) so `timeout .5 eval "id"` with `Bash(timeout:*)` left
          // name='timeout' and eval was never checked. Now fail CLOSED —
          // consistent with the unknown-FLAG handling above (lines ~1895,1912).
          return {
            ok: false,
            reason: `timeout duration '${a[i]}' cannot be statically analyzed`,
          }
        } else {
          break // no more args — `timeout` alone, inert
        }
      } else if (a[0] === 'nice') {
        // `nice cmd`, `nice -n N cmd`, `nice -N cmd` (legacy). All run cmd
        // at a lower priority. argv[0] check must see the wrapped cmd.
        if (a[1] === '-n' && a[2] && /^-?\d+$/.test(a[2])) {
          a = a.slice(3)
        } else if (a[1] && /^-\d+$/.test(a[1])) {
          a = a.slice(2) // `nice -10 cmd`
        } else if (a[1] && /[$(`]/.test(a[1])) {
          // SECURITY: walkArgument returns node.text for arithmetic_expansion,
          // so `nice $((0-5)) jq ...` has a[1]='$((0-5))'. Bash expands it to
          // '-5' (legacy nice syntax) and execs jq; we'd slice(1) here and
          
          
          return {
            ok: false,
            reason: `nice argument '${a[1]}' contains expansion — cannot statically determine wrapped command`,
          }
        } else {
          a = a.slice(1) 
        }
      } else if (a[0] === 'env') {
        // `env [VAR=val...] [-i] [-0] [-v] [-u NAME...] cmd args` runs cmd.
        
        
        
        
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (arg.includes('=') && !arg.startsWith('-')) {
            i++ 
          } else if (arg === '-i' || arg === '-0' || arg === '-v') {
            i++ 
          } else if (arg === '-u' && a[i + 1]) {
            i += 2 
          } else if (arg.startsWith('-')) {
            // -S (argv splitter), -C (altwd), -P (altpath), --anything,
            // or unknown flag. Can't model — reject the whole command.
            return {
              ok: false,
              reason: `env with ${arg} flag cannot be statically analyzed`,
            }
          } else {
            break // the wrapped command
          }
        }
        if (i < a.length) {
          a = a.slice(i)
        } else {
          break // `env` alone (no wrapped cmd) — inert, name='env'
        }
      } else if (a[0] === 'stdbuf') {
        // `stdbuf -o0 cmd` (fused), `stdbuf -o 0 cmd` (space-separated),
        // multiple flags (`stdbuf -o0 -eL cmd`), long forms (`--output=0`).
        // SECURITY: previous handling only stripped ONE flag and fell through
        // to slice(2) for anything unrecognized, so `stdbuf --output 0 eval`
        // → ['0','eval',...] → name='0' hid eval. Now iterate all known flag
        // forms and fail closed on any unknown flag.
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (STDBUF_SHORT_SEP_RE.test(arg) && a[i + 1]) {
            i += 2 // -o MODE (space-separated)
          } else if (STDBUF_SHORT_FUSED_RE.test(arg)) {
            i++ // -o0 (fused)
          } else if (STDBUF_LONG_RE.test(arg)) {
            i++ // --output=MODE (fused long)
          } else if (arg.startsWith('-')) {
            // --output MODE (space-separated long) or unknown flag. GNU
            // stdbuf long options use `=` syntax, but getopt_long also
            // accepts space-separated — we can't enumerate safely, reject.
            return {
              ok: false,
              reason: `stdbuf with ${arg} flag cannot be statically analyzed`,
            }
          } else {
            break 
          }
        }
        if (i > 1 && i < a.length) {
          a = a.slice(i)
        } else {
          break 
        }
      } else {
        break
      }
    }
    const name = a[0]
    if (name === undefined) continue

    
    
    
    
    
    
    
    if (name === '') {
      return {
        ok: false,
        reason: 'Empty command name — argv[0] may not reflect what bash runs',
      }
    }

    // Defense-in-depth: argv[0] should never be a placeholder after the
    
    
    
    if (name.includes(CMDSUB_PLACEHOLDER) || name.includes(VAR_PLACEHOLDER)) {
      return {
        ok: false,
        reason: 'Command name is runtime-determined (placeholder argv[0])',
      }
    }

    // argv[0] starts with an operator/flag: this is a fragment, not a
    
    if (name.startsWith('-') || name.startsWith('|') || name.startsWith('&')) {
      return {
        ok: false,
        reason: 'Command appears to be an incomplete fragment',
      }
    }

    // SECURITY: builtins that re-parse a NAME operand internally. bash
    
    
    
    // separate (`printf -v NAME`) and fused (`printf -vNAME`, getopt-style).
    
    const dangerFlags = SUBSCRIPT_EVAL_FLAGS[name]
    if (dangerFlags !== undefined) {
      for (let i = 1; i < a.length; i++) {
        const arg = a[i]!
        // Separate form: `-v` then NAME in next arg.
        if (dangerFlags.has(arg) && a[i + 1]?.includes('[')) {
          return {
            ok: false,
            reason: `'${name} ${arg}' operand contains array subscript — bash evaluates $(cmd) in subscripts`,
          }
        }
        // Combined short flags: `-ra` is bash shorthand for `-r -a`.
        
        
        if (
          arg.length > 2 &&
          arg[0] === '-' &&
          arg[1] !== '-' &&
          !arg.includes('[')
        ) {
          for (const flag of dangerFlags) {
            if (flag.length === 2 && arg.includes(flag[1]!)) {
              if (a[i + 1]?.includes('[')) {
                return {
                  ok: false,
                  reason: `'${name} ${flag}' (combined in '${arg}') operand contains array subscript — bash evaluates $(cmd) in subscripts`,
                }
              }
            }
          }
        }
        // Fused form: `-vNAME` in one arg. Only short-option flags fuse
        
        for (const flag of dangerFlags) {
          if (
            flag.length === 2 &&
            arg.startsWith(flag) &&
            arg.length > 2 &&
            arg.includes('[')
          ) {
            return {
              ok: false,
              reason: `'${name} ${flag}' (fused) operand contains array subscript — bash evaluates $(cmd) in subscripts`,
            }
          }
        }
      }
    }

    // SECURITY: `[[ ARG OP ARG ]]` arithmetic comparison. bash evaluates
    
    
    
    
    
    
    if (name === '[[') {
      // i starts at 2: a[0]='[[' (contains '['), a[1] is the first real
      
      for (let i = 2; i < a.length; i++) {
        if (!TEST_ARITH_CMP_OPS.has(a[i]!)) continue
        if (a[i - 1]?.includes('[') || a[i + 1]?.includes('[')) {
          return {
            ok: false,
            reason: `'[[ ... ${a[i]} ... ]]' operand contains array subscript — bash arithmetically evaluates $(cmd) in subscripts`,
          }
        }
      }
    }

    // SECURITY: `read`/`unset` treat EVERY bare positional as a NAME —
    
    
    
    
    
    if (BARE_SUBSCRIPT_NAME_BUILTINS.has(name)) {
      let skipNext = false
      for (let i = 1; i < a.length; i++) {
        const arg = a[i]!
        if (skipNext) {
          skipNext = false
          continue
        }
        if (arg[0] === '-') {
          if (name === 'read') {
            if (READ_DATA_FLAGS.has(arg)) {
              skipNext = true
            } else if (arg.length > 2 && arg[1] !== '-') {
              // Combined short flag like `-rp`. Getopt-style: first
              
              
              
              
              
              for (let j = 1; j < arg.length; j++) {
                if (READ_DATA_FLAGS.has('-' + arg[j])) {
                  if (j === arg.length - 1) skipNext = true
                  break
                }
              }
            }
          }
          continue
        }
        if (arg.includes('[')) {
          return {
            ok: false,
            reason: `'${name}' positional NAME '${arg}' contains array subscript — bash evaluates $(cmd) in subscripts`,
          }
        }
      }
    }

    // SECURITY: Shell reserved keywords as argv[0] indicate a tree-sitter
    
    
    
    
    if (SHELL_KEYWORDS.has(name)) {
      return {
        ok: false,
        reason: `Shell keyword '${name}' as command name — tree-sitter mis-parse`,
      }
    }

    // Check argv (not .text) to catch both single-quote (`'\n#'`) and
    
    
    
    
    
    for (const arg of cmd.argv) {
      if (arg.includes('\n') && NEWLINE_HASH_RE.test(arg)) {
        return {
          ok: false,
          reason:
            'Newline followed by # inside a quoted argument can hide arguments from path validation',
        }
      }
    }
    for (const ev of cmd.envVars) {
      if (ev.value.includes('\n') && NEWLINE_HASH_RE.test(ev.value)) {
        return {
          ok: false,
          reason:
            'Newline followed by # inside an env var value can hide arguments from path validation',
        }
      }
    }
    for (const r of cmd.redirects) {
      if (r.target.includes('\n') && NEWLINE_HASH_RE.test(r.target)) {
        return {
          ok: false,
          reason:
            'Newline followed by # inside a redirect target can hide arguments from path validation',
        }
      }
    }

    // jq's system() built-in executes arbitrary shell commands, and flags
    // like --from-file can read arbitrary files into jq variables. On the
    // legacy path these are caught by validateJqCommand in bashSecurity.ts,
    // but that validator is gated behind `astSubcommands === null` and
    // never runs when the AST parse succeeds. Mirror the checks here so
    // the AST path has the same defence.
    if (name === 'jq') {
      for (const arg of a) {
        if (/\bsystem\s*\(/.test(arg)) {
          return {
            ok: false,
            reason:
              'jq command contains system() function which executes arbitrary commands',
          }
        }
      }
      if (
        a.some(arg =>
          /^(?:-[fL](?:$|[^A-Za-z])|--(?:from-file|rawfile|slurpfile|library-path)(?:$|=))/.test(
            arg,
          ),
        )
      ) {
        return {
          ok: false,
          reason:
            'jq command contains dangerous flags that could execute code or read arbitrary files',
        }
      }
    }

    if (ZSH_DANGEROUS_BUILTINS.has(name)) {
      return {
        ok: false,
        reason: `Zsh builtin '${name}' can bypass security checks`,
      }
    }

    if (EVAL_LIKE_BUILTINS.has(name)) {
      // `command -v foo` / `command -V foo` are POSIX existence checks that
      // only print paths — they never execute argv[1]. Bare `command foo`
      // does bypass function/alias lookup (the concern), so keep blocking it.
      if (name === 'command' && (a[1] === '-v' || a[1] === '-V')) {
        // fall through to remaining checks
      } else if (
        name === 'fc' &&
        !a.slice(1).some(arg => /^-[^-]*[es]/.test(arg))
      ) {
        // `fc -l`, `fc -ln` list history — safe. `fc -e ed` invokes an
        // editor then executes. `fc -s [pat=rep]` RE-EXECUTES the last
        // matching command (optionally with substitution) — as dangerous
        // as eval. Block any short-opt containing `e` or `s`.
        // to avoid introducing FPs for `fc -l` (list history).
      } else if (
        name === 'compgen' &&
        !a.slice(1).some(arg => /^-[^-]*[CFW]/.test(arg))
      ) {
        // `compgen -c/-f/-v` only list completions — safe. `compgen -C cmd`
        // immediately executes cmd; `-F func` calls a shell function; `-W list`
        // word-expands its argument (including $(cmd) even from single-quoted
        // raw_string). Block any short-opt containing C/F/W (case-sensitive:
        // -c/-f are safe).
      } else {
        return {
          ok: false,
          reason: `'${name}' evaluates arguments as shell code`,
        }
      }
    }

    // /proc/*/environ exposes env vars (including secrets) of other processes.
    // Check argv and redirect targets — `cat /proc/self/environ` and
    // `cat < /proc/self/environ` both read it.
    for (const arg of cmd.argv) {
      if (arg.includes('/proc/') && PROC_ENVIRON_RE.test(arg)) {
        return {
          ok: false,
          reason: 'Accesses /proc

environ which may expose secrets',
        }
      }
    }
  }
  return { ok: true }
}
