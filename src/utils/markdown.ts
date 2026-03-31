import chalk from 'chalk'
import { marked, type Token, type Tokens } from 'marked'
import stripAnsi from 'strip-ansi'
import { color } from '../components/design-system/color.js'
import { BLOCKQUOTE_BAR } from '../constants/figures.js'
import { stringWidth } from '../ink/stringWidth.js'
import { supportsHyperlinks } from '../ink/supports-hyperlinks.js'
import type { CliHighlight } from './cliHighlight.js'
import { logForDebugging } from './debug.js'
import { createHyperlink } from './hyperlink.js'
import { stripPromptXMLTags } from './messages.js'
import type { ThemeName } from './theme.js'

const EOL = '\n'

let markedConfigured = false

export function configureMarked(): void {
  if (markedConfigured) return
  markedConfigured = true

  
  
  marked.use({
    tokenizer: {
      del() {
        return undefined
      },
    },
  })
}

export function applyMarkdown(
  content: string,
  theme: ThemeName,
  highlight: CliHighlight | null = null,
): string {
  configureMarked()
  return marked
    .lexer(stripPromptXMLTags(content))
    .map(_ => formatToken(_, theme, 0, null, null, highlight))
    .join('')
    .trim()
}

export function formatToken(
  token: Token,
  theme: ThemeName,
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
  highlight: CliHighlight | null = null,
): string {
  switch (token.type) {
    case 'blockquote': {
      const inner = (token.tokens ?? [])
        .map(_ => formatToken(_, theme, 0, null, null, highlight))
        .join('')
      
      
      const bar = chalk.dim(BLOCKQUOTE_BAR)
      return inner
        .split(EOL)
        .map(line =>
          stripAnsi(line).trim() ? `${bar} ${chalk.italic(line)}` : line,
        )
        .join(EOL)
    }
    case 'code': {
      if (!highlight) {
        return token.text + EOL
      }
      let language = 'plaintext'
      if (token.lang) {
        if (highlight.supportsLanguage(token.lang)) {
          language = token.lang
        } else {
          logForDebugging(
            `Language not supported while highlighting code, falling back to plaintext: ${token.lang}`,
          )
        }
      }
      return highlight.highlight(token.text, { language }) + EOL
    }
    case 'codespan': {
      
      return color('permission', theme)(token.text)
    }
    case 'em':
      return chalk.italic(
        (token.tokens ?? [])
          .map(_ => formatToken(_, theme, 0, null, parent, highlight))
          .join(''),
      )
    case 'strong':
      return chalk.bold(
        (token.tokens ?? [])
          .map(_ => formatToken(_, theme, 0, null, parent, highlight))
          .join(''),
      )
    case 'heading':
      switch (token.depth) {
        case 1: 
          return (
            chalk.bold.italic.underline(
              (token.tokens ?? [])
                .map(_ => formatToken(_, theme, 0, null, null, highlight))
                .join(''),
            ) +
            EOL +
            EOL
          )
        case 2: 
          return (
            chalk.bold(
              (token.tokens ?? [])
                .map(_ => formatToken(_, theme, 0, null, null, highlight))
                .join(''),
            ) +
            EOL +
            EOL
          )
        default: 
          return (
            chalk.bold(
              (token.tokens ?? [])
                .map(_ => formatToken(_, theme, 0, null, null, highlight))
                .join(''),
            ) +
            EOL +
            EOL
          )
      }
    case 'hr':
      return '---'
    case 'image':
      return token.href
    case 'link': {
      
      if (token.href.startsWith('mailto:')) {
        
        const email = token.href.replace(/^mailto:/, '')
        return email
      }
      
      const linkText = (token.tokens ?? [])
        .map(_ => formatToken(_, theme, 0, null, token, highlight))
        .join('')
      const plainLinkText = stripAnsi(linkText)
      
      
      
      if (plainLinkText && plainLinkText !== token.href) {
        return createHyperlink(token.href, linkText)
      }
      
      return createHyperlink(token.href)
    }
    case 'list': {
      return token.items
        .map((_: Token, index: number) =>
          formatToken(
            _,
            theme,
            listDepth,
            token.ordered ? token.start + index : null,
            token,
            highlight,
          ),
        )
        .join('')
    }
    case 'list_item':
      return (token.tokens ?? [])
        .map(
          _ =>
            `${'  '.repeat(listDepth)}${formatToken(_, theme, listDepth + 1, orderedListNumber, token, highlight)}`,
        )
        .join('')
    case 'paragraph':
      return (
        (token.tokens ?? [])
          .map(_ => formatToken(_, theme, 0, null, null, highlight))
          .join('') + EOL
      )
    case 'space':
      return EOL
    case 'br':
      return EOL
    case 'text':
      if (parent?.type === 'link') {
        
        
        
        
        return token.text
      }
      if (parent?.type === 'list_item') {
        return `${orderedListNumber === null ? '-' : getListNumber(listDepth, orderedListNumber) + '.'} ${token.tokens ? token.tokens.map(_ => formatToken(_, theme, listDepth, orderedListNumber, token, highlight)).join('') : linkifyIssueReferences(token.text)}${EOL}`
      }
      return linkifyIssueReferences(token.text)
    case 'table': {
      const tableToken = token as Tokens.Table

      
      function getDisplayText(tokens: Token[] | undefined): string {
        return stripAnsi(
          tokens
            ?.map(_ => formatToken(_, theme, 0, null, null, highlight))
            .join('') ?? '',
        )
      }

      
      const columnWidths = tableToken.header.map((header, index) => {
        let maxWidth = stringWidth(getDisplayText(header.tokens))
        for (const row of tableToken.rows) {
          const cellLength = stringWidth(getDisplayText(row[index]?.tokens))
          maxWidth = Math.max(maxWidth, cellLength)
        }
        return Math.max(maxWidth, 3) 
      })

      
      let tableOutput = '| '
      tableToken.header.forEach((header, index) => {
        const content =
          header.tokens
            ?.map(_ => formatToken(_, theme, 0, null, null, highlight))
            .join('') ?? ''
        const displayText = getDisplayText(header.tokens)
        const width = columnWidths[index]!
        const align = tableToken.align?.[index]
        tableOutput +=
          padAligned(content, stringWidth(displayText), width, align) + ' | '
      })
      tableOutput = tableOutput.trimEnd() + EOL

      
      tableOutput += '|'
      columnWidths.forEach(width => {
        
        const separator = '-'.repeat(width + 2) 
        tableOutput += separator + '|'
      })
      tableOutput += EOL

      
      tableToken.rows.forEach(row => {
        tableOutput += '| '
        row.forEach((cell, index) => {
          const content =
            cell.tokens
              ?.map(_ => formatToken(_, theme, 0, null, null, highlight))
              .join('') ?? ''
          const displayText = getDisplayText(cell.tokens)
          const width = columnWidths[index]!
          const align = tableToken.align?.[index]
          tableOutput +=
            padAligned(content, stringWidth(displayText), width, align) + ' | '
        })
        tableOutput = tableOutput.trimEnd() + EOL
      })

      return tableOutput + EOL
    }
    case 'escape':
      
      return token.text
    case 'def':
    case 'del':
    case 'html':
      
      return ''
  }
  return ''
}

const ISSUE_REF_PATTERN =
  /(^|[^\w./-])([A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g

function linkifyIssueReferences(text: string): string {
  if (!supportsHyperlinks()) {
    return text
  }
  return text.replace(
    ISSUE_REF_PATTERN,
    (_match, prefix, repo, num) =>
      prefix +
      createHyperlink(
        `https://github.com/${repo}/issues/${num}`,
        `${repo}#${num}`,
      ),
  )
}

function numberToLetter(n: number): string {
  let result = ''
  while (n > 0) {
    n--
    result = String.fromCharCode(97 + (n % 26)) + result
    n = Math.floor(n / 26)
  }
  return result
}

const ROMAN_VALUES: ReadonlyArray<[number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
]

function numberToRoman(n: number): string {
  let result = ''
  for (const [value, numeral] of ROMAN_VALUES) {
    while (n >= value) {
      result += numeral
      n -= value
    }
  }
  return result
}

function getListNumber(listDepth: number, orderedListNumber: number): string {
  switch (listDepth) {
    case 0:
    case 1:
      return orderedListNumber.toString()
    case 2:
      return numberToLetter(orderedListNumber)
    case 3:
      return numberToRoman(orderedListNumber)
    default:
      return orderedListNumber.toString()
  }
}

export function padAligned(
  content: string,
  displayWidth: number,
  targetWidth: number,
  align: 'left' | 'center' | 'right' | null | undefined,
): string {
  const padding = Math.max(0, targetWidth - displayWidth)
  if (align === 'center') {
    const leftPad = Math.floor(padding / 2)
    return ' '.repeat(leftPad) + content + ' '.repeat(padding - leftPad)
  }
  if (align === 'right') {
    return ' '.repeat(padding) + content
  }
  return content + ' '.repeat(padding)
}
