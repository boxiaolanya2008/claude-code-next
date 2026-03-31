

import { feature } from "../utils/bundle-mock.ts"
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

export const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
] as const

export type ExternalPermissionMode = (typeof EXTERNAL_PERMISSION_MODES)[number]

export type InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble'
export type PermissionMode = InternalPermissionMode

export const INTERNAL_PERMISSION_MODES = [
  ...EXTERNAL_PERMISSION_MODES,
  ...(feature('TRANSCRIPT_CLASSIFIER') ? (['auto'] as const) : ([] as const)),
] as const satisfies readonly PermissionMode[]

export const PERMISSION_MODES = INTERNAL_PERMISSION_MODES

export type PermissionBehavior = 'allow' | 'deny' | 'ask'

export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'
  | 'cliArg'
  | 'command'
  | 'session'

export type PermissionRuleValue = {
  toolName: string
  ruleContent?: string
}

export type PermissionRule = {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: PermissionRuleValue
}

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg'

export type PermissionUpdate =
  | {
      type: 'addRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'replaceRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'removeRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'setMode'
      destination: PermissionUpdateDestination
      mode: ExternalPermissionMode
    }
  | {
      type: 'addDirectories'
      destination: PermissionUpdateDestination
      directories: string[]
    }
  | {
      type: 'removeDirectories'
      destination: PermissionUpdateDestination
      directories: string[]
    }

export type WorkingDirectorySource = PermissionRuleSource

export type AdditionalWorkingDirectory = {
  path: string
  source: WorkingDirectorySource
}

export type PermissionCommandMetadata = {
  name: string
  description?: string
  
  [key: string]: unknown
}

export type PermissionMetadata =
  | { command: PermissionCommandMetadata }
  | undefined

export type PermissionAllowDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> = {
  behavior: 'allow'
  updatedInput?: Input
  userModified?: boolean
  decisionReason?: PermissionDecisionReason
  toolUseID?: string
  acceptFeedback?: string
  contentBlocks?: ContentBlockParam[]
}

export type PendingClassifierCheck = {
  command: string
  cwd: string
  descriptions: string[]
}

export type PermissionAskDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> = {
  behavior: 'ask'
  message: string
  updatedInput?: Input
  decisionReason?: PermissionDecisionReason
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  metadata?: PermissionMetadata
  

  isBashSecurityCheckForMisparsing?: boolean
  

  pendingClassifierCheck?: PendingClassifierCheck
  

  contentBlocks?: ContentBlockParam[]
}

export type PermissionDenyDecision = {
  behavior: 'deny'
  message: string
  decisionReason: PermissionDecisionReason
  toolUseID?: string
}

export type PermissionDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> =
  | PermissionAllowDecision<Input>
  | PermissionAskDecision<Input>
  | PermissionDenyDecision

export type PermissionResult<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> =
  | PermissionDecision<Input>
  | {
      behavior: 'passthrough'
      message: string
      decisionReason?: PermissionDecision<Input>['decisionReason']
      suggestions?: PermissionUpdate[]
      blockedPath?: string
      

      pendingClassifierCheck?: PendingClassifierCheck
    }

export type PermissionDecisionReason =
  | {
      type: 'rule'
      rule: PermissionRule
    }
  | {
      type: 'mode'
      mode: PermissionMode
    }
  | {
      type: 'subcommandResults'
      reasons: Map<string, PermissionResult>
    }
  | {
      type: 'permissionPromptTool'
      permissionPromptToolName: string
      toolResult: unknown
    }
  | {
      type: 'hook'
      hookName: string
      hookSource?: string
      reason?: string
    }
  | {
      type: 'asyncAgent'
      reason: string
    }
  | {
      type: 'sandboxOverride'
      reason: 'excludedCommand' | 'dangerouslyDisableSandbox'
    }
  | {
      type: 'classifier'
      classifier: string
      reason: string
    }
  | {
      type: 'workingDir'
      reason: string
    }
  | {
      type: 'safetyCheck'
      reason: string
      
      
      
      
      classifierApprovable: boolean
    }
  | {
      type: 'other'
      reason: string
    }

export type ClassifierResult = {
  matches: boolean
  matchedDescription?: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export type ClassifierBehavior = 'deny' | 'ask' | 'allow'

export type ClassifierUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

export type YoloClassifierResult = {
  thinking?: string
  shouldBlock: boolean
  reason: string
  unavailable?: boolean
  

  transcriptTooLong?: boolean
  
  model: string
  
  usage?: ClassifierUsage
  
  durationMs?: number
  
  promptLengths?: {
    systemPrompt: number
    toolCalls: number
    userPrompts: number
  }
  
  errorDumpPath?: string
  
  stage?: 'fast' | 'thinking'
  
  stage1Usage?: ClassifierUsage
  
  stage1DurationMs?: number
  

  stage1RequestId?: string
  

  stage1MsgId?: string
  
  stage2Usage?: ClassifierUsage
  
  stage2DurationMs?: number
  
  stage2RequestId?: string
  
  stage2MsgId?: string
}

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export type PermissionExplanation = {
  riskLevel: RiskLevel
  explanation: string
  reasoning: string
  risk: string
}

export type ToolPermissionRulesBySource = {
  [T in PermissionRuleSource]?: string[]
}

export type ToolPermissionContext = {
  readonly mode: PermissionMode
  readonly additionalWorkingDirectories: ReadonlyMap<
    string,
    AdditionalWorkingDirectory
  >
  readonly alwaysAllowRules: ToolPermissionRulesBySource
  readonly alwaysDenyRules: ToolPermissionRulesBySource
  readonly alwaysAskRules: ToolPermissionRulesBySource
  readonly isBypassPermissionsModeAvailable: boolean
  readonly strippedDangerousRules?: ToolPermissionRulesBySource
  readonly shouldAvoidPermissionPrompts?: boolean
  readonly awaitAutomatedChecksBeforeDialog?: boolean
  readonly prePlanMode?: PermissionMode
}
