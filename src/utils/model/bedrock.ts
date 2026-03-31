import memoize from 'lodash-es/memoize.js'
import { refreshAndGetAwsCredentials } from '../auth.js'
import { getAWSRegion, isEnvTruthy } from '../envUtils.js'
import { logError } from '../log.js'
import { getAWSClientProxyConfig } from '../proxy.js'

export const getBedrockInferenceProfiles = memoize(async function (): Promise<
  string[]
> {
  const [client, { ListInferenceProfilesCommand }] = await Promise.all([
    createBedrockClient(),
    import('@aws-sdk/client-bedrock'),
  ])
  const allProfiles = []
  let nextToken: string | undefined

  try {
    do {
      const command = new ListInferenceProfilesCommand({
        ...(nextToken && { nextToken }),
        typeEquals: 'SYSTEM_DEFINED',
      })
      const response = await client.send(command)

      if (response.inferenceProfileSummaries) {
        allProfiles.push(...response.inferenceProfileSummaries)
      }

      nextToken = response.nextToken
    } while (nextToken)

    
    return allProfiles
      .filter(profile => profile.inferenceProfileId?.includes('anthropic'))
      .map(profile => profile.inferenceProfileId)
      .filter(Boolean) as string[]
  } catch (error) {
    logError(error as Error)
    throw error
  }
})

export function findFirstMatch(
  profiles: string[],
  substring: string,
): string | null {
  return profiles.find(p => p.includes(substring)) ?? null
}

async function createBedrockClient() {
  const { BedrockClient } = await import('@aws-sdk/client-bedrock')
  
  
  
  
  const region = getAWSRegion()

  const skipAuth = isEnvTruthy(process.env.CLAUDE_CODE_NEXT_SKIP_BEDROCK_AUTH)

  const clientConfig: ConstructorParameters<typeof BedrockClient>[0] = {
    region,
    ...(process.env.ANTHROPIC_BEDROCK_BASE_URL && {
      endpoint: process.env.ANTHROPIC_BEDROCK_BASE_URL,
    }),
    ...(await getAWSClientProxyConfig()),
    ...(skipAuth && {
      requestHandler: new (
        await import('@smithy/node-http-handler')
      ).NodeHttpHandler(),
      httpAuthSchemes: [
        {
          schemeId: 'smithy.api#noAuth',
          identityProvider: () => async () => ({}),
          signer: new (await import('@smithy/core')).NoAuthSigner(),
        },
      ],
      httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#noAuth' }],
    }),
  }

  if (!skipAuth && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    
    const cachedCredentials = await refreshAndGetAwsCredentials()
    if (cachedCredentials) {
      clientConfig.credentials = {
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken,
      }
    }
  }

  return new BedrockClient(clientConfig)
}

export async function createBedrockRuntimeClient() {
  const { BedrockRuntimeClient } = await import(
    '@aws-sdk/client-bedrock-runtime'
  )
  const region = getAWSRegion()
  const skipAuth = isEnvTruthy(process.env.CLAUDE_CODE_NEXT_SKIP_BEDROCK_AUTH)

  const clientConfig: ConstructorParameters<typeof BedrockRuntimeClient>[0] = {
    region,
    ...(process.env.ANTHROPIC_BEDROCK_BASE_URL && {
      endpoint: process.env.ANTHROPIC_BEDROCK_BASE_URL,
    }),
    ...(await getAWSClientProxyConfig()),
    ...(skipAuth && {
      
      
      requestHandler: new (
        await import('@smithy/node-http-handler')
      ).NodeHttpHandler(),
      httpAuthSchemes: [
        {
          schemeId: 'smithy.api#noAuth',
          identityProvider: () => async () => ({}),
          signer: new (await import('@smithy/core')).NoAuthSigner(),
        },
      ],
      httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#noAuth' }],
    }),
  }

  if (!skipAuth && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    
    const cachedCredentials = await refreshAndGetAwsCredentials()
    if (cachedCredentials) {
      clientConfig.credentials = {
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken,
      }
    }
  }

  return new BedrockRuntimeClient(clientConfig)
}

export const getInferenceProfileBackingModel = memoize(async function (
  profileId: string,
): Promise<string | null> {
  try {
    const [client, { GetInferenceProfileCommand }] = await Promise.all([
      createBedrockClient(),
      import('@aws-sdk/client-bedrock'),
    ])
    const command = new GetInferenceProfileCommand({
      inferenceProfileIdentifier: profileId,
    })
    const response = await client.send(command)

    if (!response.models || response.models.length === 0) {
      return null
    }

    
    
    
    const primaryModel = response.models[0]
    if (!primaryModel?.modelArn) {
      return null
    }

    
    
    const lastSlashIndex = primaryModel.modelArn.lastIndexOf('/')
    return lastSlashIndex >= 0
      ? primaryModel.modelArn.substring(lastSlashIndex + 1)
      : primaryModel.modelArn
  } catch (error) {
    logError(error as Error)
    return null
  }
})

export function isFoundationModel(modelId: string): boolean {
  return modelId.startsWith('anthropic.')
}

const BEDROCK_REGION_PREFIXES = ['us', 'eu', 'apac', 'global'] as const

export function extractModelIdFromArn(modelId: string): string {
  if (!modelId.startsWith('arn:')) {
    return modelId
  }
  const lastSlashIndex = modelId.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return modelId
  }
  return modelId.substring(lastSlashIndex + 1)
}

export type BedrockRegionPrefix = (typeof BEDROCK_REGION_PREFIXES)[number]

export function getBedrockRegionPrefix(
  modelId: string,
): BedrockRegionPrefix | undefined {
  
  
  const effectiveModelId = extractModelIdFromArn(modelId)

  for (const prefix of BEDROCK_REGION_PREFIXES) {
    if (effectiveModelId.startsWith(`${prefix}.anthropic.`)) {
      return prefix
    }
  }
  return undefined
}

export function applyBedrockRegionPrefix(
  modelId: string,
  prefix: BedrockRegionPrefix,
): string {
  
  const existingPrefix = getBedrockRegionPrefix(modelId)
  if (existingPrefix) {
    return modelId.replace(`${existingPrefix}.`, `${prefix}.`)
  }

  
  if (isFoundationModel(modelId)) {
    return `${prefix}.${modelId}`
  }

  
  return modelId
}
