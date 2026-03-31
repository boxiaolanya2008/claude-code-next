import { queryHaiku } from '../../services/api/claude.js'
import { logError } from '../log.js'
import { extractTextContent } from '../messages.js'
import { asSystemPrompt } from '../systemPromptType.js'

export type DateTimeParseResult =
  | { success: true; value: string }
  | { success: false; error: string }

export async function parseNaturalLanguageDateTime(
  input: string,
  format: 'date' | 'date-time',
  signal: AbortSignal,
): Promise<DateTimeParseResult> {
  
  const now = new Date()
  const currentDateTime = now.toISOString()
  const timezoneOffset = -now.getTimezoneOffset() 
  const tzHours = Math.floor(Math.abs(timezoneOffset) / 60)
  const tzMinutes = Math.abs(timezoneOffset) % 60
  const tzSign = timezoneOffset >= 0 ? '+' : '-'
  const timezone = `${tzSign}${String(tzHours).padStart(2, '0')}:${String(tzMinutes).padStart(2, '0')}`
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' })

  
  const systemPrompt = asSystemPrompt([
    'You are a date/time parser that converts natural language into ISO 8601 format.',
    'You MUST respond with ONLY the ISO 8601 formatted string, with no explanation or additional text.',
    'If the input is ambiguous, prefer future dates over past dates.',
    "For times without dates, use today's date.",
    'For dates without times, do not include a time component.',
    'If the input is incomplete or you cannot confidently parse it into a valid date, respond with exactly "INVALID" (nothing else).',
    'Examples of INVALID input: partial dates like "2025-01-", lone numbers like "13", gibberish.',
    'Examples of valid natural language: "tomorrow", "next Monday", "jan 1st 2025", "in 2 hours", "yesterday".',
  ])

  
  const formatDescription =
    format === 'date'
      ? 'YYYY-MM-DD (date only, no time)'
      : `YYYY-MM-DDTHH:MM:SS${timezone} (full date-time with timezone)`

  const userPrompt = `Current context:
- Current date and time: ${currentDateTime} (UTC)
- Local timezone: ${timezone}
- Day of week: ${dayOfWeek}

User input: "${input}"

Output format: ${formatDescription}

Parse the user's input into ISO 8601 format. Return ONLY the formatted string, or "INVALID" if the input is incomplete or unparseable.`

  try {
    const result = await queryHaiku({
      systemPrompt,
      userPrompt,
      signal,
      options: {
        querySource: 'mcp_datetime_parse',
        agents: [],
        isNonInteractiveSession: false,
        hasAppendSystemPrompt: false,
        mcpTools: [],
        enablePromptCaching: false,
      },
    })

    
    const parsedText = extractTextContent(result.message.content).trim()

    
    if (!parsedText || parsedText === 'INVALID') {
      return {
        success: false,
        error: 'Unable to parse date/time from input',
      }
    }

    
    if (!/^\d{4}/.test(parsedText)) {
      return {
        success: false,
        error: 'Unable to parse date/time from input',
      }
    }

    return { success: true, value: parsedText }
  } catch (error) {
    
    logError(error)
    return {
      success: false,
      error:
        'Unable to parse date/time. Please enter in ISO 8601 format manually.',
    }
  }
}

export function looksLikeISO8601(input: string): boolean {
  
  
  return /^\d{4}-\d{2}-\d{2}(T|$)/.test(input.trim())
}
