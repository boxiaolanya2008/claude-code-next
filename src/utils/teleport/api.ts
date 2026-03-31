import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { randomUUID } from 'crypto'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getOrganizationUUID } from 'src/services/oauth/client.js'
import z from 'zod/v4'
import { getClaudeAIOAuthTokens } from '../auth.js'
import { logForDebugging } from '../debug.js'
import { parseGitHubRepository } from '../detectRepository.js'
import { errorMessage, toError } from '../errors.js'
import { lazySchema } from '../lazySchema.js'
import { logError } from '../log.js'
import { sleep } from '../sleep.js'
import { jsonStringify } from '../slowOperations.js'

const TELEPORT_RETRY_DELAYS = [2000, 4000, 8000, 16000] 
const MAX_TELEPORT_RETRIES = TELEPORT_RETRY_DELAYS.length

export const CCR_BYOC_BETA = 'ccr-byoc-2025-07-29'

export function isTransientNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false
  }

  
  if (!error.response) {
    return true
  }

  
  if (error.response.status >= 500) {
    return true
  }

  
  return false
}

export async function axiosGetWithRetry<T>(
  url: string,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> {
  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_TELEPORT_RETRIES; attempt++) {
    try {
      return await axios.get<T>(url, config)
    } catch (error) {
      lastError = error

      
      if (!isTransientNetworkError(error)) {
        throw error
      }

      
      if (attempt >= MAX_TELEPORT_RETRIES) {
        logForDebugging(
          `Teleport request failed after ${attempt + 1} attempts: ${errorMessage(error)}`,
        )
        throw error
      }

      const delay = TELEPORT_RETRY_DELAYS[attempt] ?? 2000
      logForDebugging(
        `Teleport request failed (attempt ${attempt + 1}/${MAX_TELEPORT_RETRIES + 1}), retrying in ${delay}ms: ${errorMessage(error)}`,
      )
      await sleep(delay)
    }
  }

  throw lastError
}

export type SessionStatus = 'requires_action' | 'running' | 'idle' | 'archived'

export type GitSource = {
  type: 'git_repository'
  url: string
  revision?: string | null
  allow_unrestricted_git_push?: boolean
}

export type KnowledgeBaseSource = {
  type: 'knowledge_base'
  knowledge_base_id: string
}

export type SessionContextSource = GitSource | KnowledgeBaseSource

export type OutcomeGitInfo = {
  type: 'github'
  repo: string
  branches: string[]
}

export type GitRepositoryOutcome = {
  type: 'git_repository'
  git_info: OutcomeGitInfo
}

export type Outcome = GitRepositoryOutcome

export type SessionContext = {
  sources: SessionContextSource[]
  cwd: string
  outcomes: Outcome[] | null
  custom_system_prompt: string | null
  append_system_prompt: string | null
  model: string | null
  
  seed_bundle_file_id?: string
  github_pr?: { owner: string; repo: string; number: number }
  reuse_outcome_branches?: boolean
}

export type SessionResource = {
  type: 'session'
  id: string
  title: string | null
  session_status: SessionStatus
  environment_id: string
  created_at: string
  updated_at: string
  session_context: SessionContext
}

export type ListSessionsResponse = {
  data: SessionResource[]
  has_more: boolean
  first_id: string | null
  last_id: string | null
}

export const CodeSessionSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    status: z.enum([
      'idle',
      'working',
      'waiting',
      'completed',
      'archived',
      'cancelled',
      'rejected',
    ]),
    repo: z
      .object({
        name: z.string(),
        owner: z.object({
          login: z.string(),
        }),
        default_branch: z.string().optional(),
      })
      .nullable(),
    turns: z.array(z.string()),
    created_at: z.string(),
    updated_at: z.string(),
  }),
)

export type CodeSession = z.infer<ReturnType<typeof CodeSessionSchema>>

export async function prepareApiRequest(): Promise<{
  accessToken: string
  orgUUID: string
}> {
  const accessToken = getClaudeAIOAuthTokens()?.accessToken
  if (accessToken === undefined) {
    throw new Error(
      'Claude Code Next web sessions require authentication with a Claude.ai account. API key authentication is not sufficient. Please run /login to authenticate, or check your authentication status with /status.',
    )
  }

  const orgUUID = await getOrganizationUUID()
  if (!orgUUID) {
    throw new Error('Unable to get organization UUID')
  }

  return { accessToken, orgUUID }
}

export async function fetchCodeSessionsFromSessionsAPI(): Promise<
  CodeSession[]
> {
  const { accessToken, orgUUID } = await prepareApiRequest()

  const url = `${getOauthConfig().BASE_API_URL}/v1/sessions`

  try {
    const headers = {
      ...getOAuthHeaders(accessToken),
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'x-organization-uuid': orgUUID,
    }

    const response = await axiosGetWithRetry<ListSessionsResponse>(url, {
      headers,
    })

    if (response.status !== 200) {
      throw new Error(`Failed to fetch code sessions: ${response.statusText}`)
    }

    
    const sessions: CodeSession[] = response.data.data.map(session => {
      
      const gitSource = session.session_context.sources.find(
        (source): source is GitSource => source.type === 'git_repository',
      )

      let repo: CodeSession['repo'] = null
      if (gitSource?.url) {
        
        const repoPath = parseGitHubRepository(gitSource.url)
        if (repoPath) {
          const [owner, name] = repoPath.split('/')
          if (owner && name) {
            repo = {
              name,
              owner: {
                login: owner,
              },
              default_branch: gitSource.revision || undefined,
            }
          }
        }
      }

      return {
        id: session.id,
        title: session.title || 'Untitled',
        description: '', 
        status: session.session_status as CodeSession['status'], 
        repo,
        turns: [], 
        created_at: session.created_at,
        updated_at: session.updated_at,
      }
    })

    return sessions
  } catch (error) {
    const err = toError(error)
    logError(err)
    throw error
  }
}

export function getOAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
}

export async function fetchSession(
  sessionId: string,
): Promise<SessionResource> {
  const { accessToken, orgUUID } = await prepareApiRequest()

  const url = `${getOauthConfig().BASE_API_URL}/v1/sessions/${sessionId}`
  const headers = {
    ...getOAuthHeaders(accessToken),
    'anthropic-beta': 'ccr-byoc-2025-07-29',
    'x-organization-uuid': orgUUID,
  }

  const response = await axios.get<SessionResource>(url, {
    headers,
    timeout: 15000,
    validateStatus: status => status < 500,
  })

  if (response.status !== 200) {
    
    const errorData = response.data as { error?: { message?: string } }
    const apiMessage = errorData?.error?.message

    if (response.status === 404) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (response.status === 401) {
      throw new Error('Session expired. Please run /login to sign in again.')
    }

    throw new Error(
      apiMessage ||
        `Failed to fetch session: ${response.status} ${response.statusText}`,
    )
  }

  return response.data
}

export function getBranchFromSession(
  session: SessionResource,
): string | undefined {
  const gitOutcome = session.session_context.outcomes?.find(
    (outcome): outcome is GitRepositoryOutcome =>
      outcome.type === 'git_repository',
  )
  return gitOutcome?.git_info?.branches[0]
}

export type RemoteMessageContent =
  | string
  | Array<{ type: string; [key: string]: unknown }>

export async function sendEventToRemoteSession(
  sessionId: string,
  messageContent: RemoteMessageContent,
  opts?: { uuid?: string },
): Promise<boolean> {
  try {
    const { accessToken, orgUUID } = await prepareApiRequest()

    const url = `${getOauthConfig().BASE_API_URL}/v1/sessions/${sessionId}/events`
    const headers = {
      ...getOAuthHeaders(accessToken),
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'x-organization-uuid': orgUUID,
    }

    const userEvent = {
      uuid: opts?.uuid ?? randomUUID(),
      session_id: sessionId,
      type: 'user',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: messageContent,
      },
    }

    const requestBody = {
      events: [userEvent],
    }

    logForDebugging(
      `[sendEventToRemoteSession] Sending event to session ${sessionId}`,
    )
    
    
    const response = await axios.post(url, requestBody, {
      headers,
      validateStatus: status => status < 500,
      timeout: 30000,
    })

    if (response.status === 200 || response.status === 201) {
      logForDebugging(
        `[sendEventToRemoteSession] Successfully sent event to session ${sessionId}`,
      )
      return true
    }

    logForDebugging(
      `[sendEventToRemoteSession] Failed with status ${response.status}: ${jsonStringify(response.data)}`,
    )
    return false
  } catch (error) {
    logForDebugging(`[sendEventToRemoteSession] Error: ${errorMessage(error)}`)
    return false
  }
}

export async function updateSessionTitle(
  sessionId: string,
  title: string,
): Promise<boolean> {
  try {
    const { accessToken, orgUUID } = await prepareApiRequest()

    const url = `${getOauthConfig().BASE_API_URL}/v1/sessions/${sessionId}`
    const headers = {
      ...getOAuthHeaders(accessToken),
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'x-organization-uuid': orgUUID,
    }

    logForDebugging(
      `[updateSessionTitle] Updating title for session ${sessionId}: "${title}"`,
    )
    const response = await axios.patch(
      url,
      { title },
      {
        headers,
        validateStatus: status => status < 500,
      },
    )

    if (response.status === 200) {
      logForDebugging(
        `[updateSessionTitle] Successfully updated title for session ${sessionId}`,
      )
      return true
    }

    logForDebugging(
      `[updateSessionTitle] Failed with status ${response.status}: ${jsonStringify(response.data)}`,
    )
    return false
  } catch (error) {
    logForDebugging(`[updateSessionTitle] Error: ${errorMessage(error)}`)
    return false
  }
}
