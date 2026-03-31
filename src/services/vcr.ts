import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { createHash, randomUUID, type UUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import isPlainObject from 'lodash-es/isPlainObject.js'
import mapValues from 'lodash-es/mapValues.js'
import { dirname, join } from 'path'
import { addToTotalSessionCost } from 'src/cost-tracker.js'
import { calculateUSDCost } from 'src/utils/modelCost.js'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from '../types/message.js'
import { getCwd } from '../utils/cwd.js'
import { env } from '../utils/env.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../utils/envUtils.js'
import { getErrnoCode } from '../utils/errors.js'
import { normalizeMessagesForAPI } from '../utils/messages.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'

function shouldUseVCR(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return true
  }

  if (process.env.USER_TYPE === 'ant' && isEnvTruthy(process.env.FORCE_VCR)) {
    return true
  }

  return false
}

async function withFixture<T>(
  input: unknown,
  fixtureName: string,
  f: () => Promise<T>,
): Promise<T> {
  if (!shouldUseVCR()) {
    return await f()
  }

  
  const hash = createHash('sha1')
    .update(jsonStringify(input))
    .digest('hex')
    .slice(0, 12)
  const filename = join(
    process.env.CLAUDE_CODE_NEXT_TEST_FIXTURES_ROOT ?? getCwd(),
    `fixtures/${fixtureName}-${hash}.json`,
  )

  
  try {
    const cached = jsonParse(
      await readFile(filename, { encoding: 'utf8' }),
    ) as T
    return cached
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
  }

  if ((env.isCI || process.env.CI) && !isEnvTruthy(process.env.VCR_RECORD)) {
    throw new Error(
      `Fixture missing: ${filename}. Re-run tests with VCR_RECORD=1, then commit the result.`,
    )
  }

  
  const result = await f()

  await mkdir(dirname(filename), { recursive: true })
  await writeFile(filename, jsonStringify(result, null, 2), {
    encoding: 'utf8',
  })

  return result
}

export async function withVCR(
  messages: Message[],
  f: () => Promise<(AssistantMessage | StreamEvent | SystemAPIErrorMessage)[]>,
): Promise<(AssistantMessage | StreamEvent | SystemAPIErrorMessage)[]> {
  if (!shouldUseVCR()) {
    return await f()
  }

  const messagesForAPI = normalizeMessagesForAPI(
    messages.filter(_ => {
      if (_.type !== 'user') {
        return true
      }
      if (_.isMeta) {
        return false
      }
      return true
    }),
  )

  const dehydratedInput = mapMessages(
    messagesForAPI.map(_ => _.message.content),
    dehydrateValue,
  )
  const filename = join(
    process.env.CLAUDE_CODE_NEXT_TEST_FIXTURES_ROOT ?? getCwd(),
    `fixtures/${dehydratedInput.map(_ => createHash('sha1').update(jsonStringify(_)).digest('hex').slice(0, 6)).join('-')}.json`,
  )

  
  try {
    const cached = jsonParse(
      await readFile(filename, { encoding: 'utf8' }),
    ) as { output: (AssistantMessage | StreamEvent)[] }
    cached.output.forEach(addCachedCostToTotalSessionCost)
    return cached.output.map((message, index) =>
      mapMessage(message, hydrateValue, index, randomUUID()),
    )
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
  }

  if (env.isCI && !isEnvTruthy(process.env.VCR_RECORD)) {
    throw new Error(
      `Anthropic API fixture missing: ${filename}. Re-run tests with VCR_RECORD=1, then commit the result. Input messages:\n${jsonStringify(dehydratedInput, null, 2)}`,
    )
  }

  
  const results = await f()
  if (env.isCI && !isEnvTruthy(process.env.VCR_RECORD)) {
    return results
  }

  await mkdir(dirname(filename), { recursive: true })
  await writeFile(
    filename,
    jsonStringify(
      {
        input: dehydratedInput,
        output: results.map((message, index) =>
          mapMessage(message, dehydrateValue, index),
        ),
      },
      null,
      2,
    ),
    { encoding: 'utf8' },
  )
  return results
}

function addCachedCostToTotalSessionCost(
  message: AssistantMessage | StreamEvent,
): void {
  if (message.type === 'stream_event') {
    return
  }
  const model = message.message.model
  const usage = message.message.usage
  const costUSD = calculateUSDCost(model, usage)
  addToTotalSessionCost(costUSD, usage, model)
}

function mapMessages(
  messages: (UserMessage | AssistantMessage)['message']['content'][],
  f: (s: unknown) => unknown,
): (UserMessage | AssistantMessage)['message']['content'][] {
  return messages.map(_ => {
    if (typeof _ === 'string') {
      return f(_)
    }
    return _.map(_ => {
      switch (_.type) {
        case 'tool_result':
          if (typeof _.content === 'string') {
            return { ..._, content: f(_.content) }
          }
          if (Array.isArray(_.content)) {
            return {
              ..._,
              content: _.content.map(_ => {
                switch (_.type) {
                  case 'text':
                    return { ..._, text: f(_.text) }
                  case 'image':
                    return _
                  default:
                    return undefined
                }
              }),
            }
          }
          return _
        case 'text':
          return { ..._, text: f(_.text) }
        case 'tool_use':
          return {
            ..._,
            input: mapValuesDeep(_.input as Record<string, unknown>, f),
          }
        case 'image':
          return _
        default:
          return undefined
      }
    })
  }) as (UserMessage | AssistantMessage)['message']['content'][]
}

function mapValuesDeep(
  obj: {
    [x: string]: unknown
  },
  f: (val: unknown, key: string, obj: Record<string, unknown>) => unknown,
): Record<string, unknown> {
  return mapValues(obj, (val, key) => {
    if (Array.isArray(val)) {
      return val.map(_ => mapValuesDeep(_, f))
    }
    if (isPlainObject(val)) {
      return mapValuesDeep(val as Record<string, unknown>, f)
    }
    return f(val, key, obj)
  })
}

function mapAssistantMessage(
  message: AssistantMessage,
  f: (s: unknown) => unknown,
  index: number,
  uuid?: UUID,
): AssistantMessage {
  return {
    
    
    
    
    uuid: uuid ?? (`UUID-${index}` as unknown as UUID),
    requestId: 'REQUEST_ID',
    timestamp: message.timestamp,
    message: {
      ...message.message,
      content: message.message.content
        .map(_ => {
          switch (_.type) {
            case 'text':
              return {
                ..._,
                text: f(_.text) as string,
                citations: _.citations || [],
              } 
            case 'tool_use':
              return {
                ..._,
                input: mapValuesDeep(_.input as Record<string, unknown>, f),
              }
            default:
              return _ 
          }
        })
        .filter(Boolean) as BetaContentBlock[],
    },
    type: 'assistant',
  }
}

function mapMessage(
  message: AssistantMessage | SystemAPIErrorMessage | StreamEvent,
  f: (s: unknown) => unknown,
  index: number,
  uuid?: UUID,
): AssistantMessage | SystemAPIErrorMessage | StreamEvent {
  if (message.type === 'assistant') {
    return mapAssistantMessage(message, f, index, uuid)
  } else {
    return message
  }
}

function dehydrateValue(s: unknown): unknown {
  if (typeof s !== 'string') {
    return s
  }
  const cwd = getCwd()
  const configHome = getClaudeConfigHomeDir()
  let s1 = s
    .replace(/num_files="\d+"/g, 'num_files="[NUM]"')
    .replace(/duration_ms="\d+"/g, 'duration_ms="[DURATION]"')
    .replace(/cost_usd="\d+"/g, 'cost_usd="[COST]"')
    
    
    
    .replaceAll(configHome, '[CONFIG_HOME]')
    .replaceAll(cwd, '[CWD]')
    .replace(/Available commands:.+/, 'Available commands: [COMMANDS]')
  
  
  
  if (process.platform === 'win32') {
    const cwdFwd = cwd.replaceAll('\\', '/')
    const configHomeFwd = configHome.replaceAll('\\', '/')
    
    const cwdJsonEscaped = jsonStringify(cwd).slice(1, -1)
    const configHomeJsonEscaped = jsonStringify(configHome).slice(1, -1)
    s1 = s1
      .replaceAll(cwdJsonEscaped, '[CWD]')
      .replaceAll(configHomeJsonEscaped, '[CONFIG_HOME]')
      .replaceAll(cwdFwd, '[CWD]')
      .replaceAll(configHomeFwd, '[CONFIG_HOME]')
  }
  
  
  
  s1 = s1
    .replace(/\[CWD\][^\s"'<>]*/g, match =>
      match.replaceAll('\\\\', '/').replaceAll('\\', '/'),
    )
    .replace(/\[CONFIG_HOME\][^\s"'<>]*/g, match =>
      match.replaceAll('\\\\', '/').replaceAll('\\', '/'),
    )
  if (s1.includes('Files modified by user:')) {
    return 'Files modified by user: [FILES]'
  }
  return s1
}

function hydrateValue(s: unknown): unknown {
  if (typeof s !== 'string') {
    return s
  }
  return s
    .replaceAll('[NUM]', '1')
    .replaceAll('[DURATION]', '100')
    .replaceAll('[CONFIG_HOME]', getClaudeConfigHomeDir())
    .replaceAll('[CWD]', getCwd())
}

export async function* withStreamingVCR(
  messages: Message[],
  f: () => AsyncGenerator<
    StreamEvent | AssistantMessage | SystemAPIErrorMessage,
    void
  >,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  if (!shouldUseVCR()) {
    return yield* f()
  }

  
  const buffer: (StreamEvent | AssistantMessage | SystemAPIErrorMessage)[] = []

  
  const cachedBuffer = await withVCR(messages, async () => {
    for await (const message of f()) {
      buffer.push(message)
    }
    return buffer
  })

  if (cachedBuffer.length > 0) {
    yield* cachedBuffer
    return
  }

  yield* buffer
}

export async function withTokenCountVCR(
  messages: unknown[],
  tools: unknown[],
  f: () => Promise<number | null>,
): Promise<number | null> {
  
  
  
  
  
  const cwdSlug = getCwd().replace(/[^a-zA-Z0-9]/g, '-')
  const dehydrated = (
    dehydrateValue(jsonStringify({ messages, tools })) as string
  )
    .replaceAll(cwdSlug, '[CWD_SLUG]')
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '[UUID]',
    )
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '[TIMESTAMP]')
  const result = await withFixture(dehydrated, 'token-count', async () => ({
    tokenCount: await f(),
  }))
  return result.tokenCount
}
