import { logForDebugging } from './debug.js'

export type AwsCredentials = {
  AccessKeyId: string
  SecretAccessKey: string
  SessionToken: string
  Expiration?: string
}

export type AwsStsOutput = {
  Credentials: AwsCredentials
}

type AwsError = {
  name: string
}

export function isAwsCredentialsProviderError(err: unknown) {
  return (err as AwsError | undefined)?.name === 'CredentialsProviderError'
}

export function isValidAwsStsOutput(obj: unknown): obj is AwsStsOutput {
  if (!obj || typeof obj !== 'object') {
    return false
  }

  const output = obj as Record<string, unknown>

  
  if (!output.Credentials || typeof output.Credentials !== 'object') {
    return false
  }

  const credentials = output.Credentials as Record<string, unknown>

  return (
    typeof credentials.AccessKeyId === 'string' &&
    typeof credentials.SecretAccessKey === 'string' &&
    typeof credentials.SessionToken === 'string' &&
    credentials.AccessKeyId.length > 0 &&
    credentials.SecretAccessKey.length > 0 &&
    credentials.SessionToken.length > 0
  )
}

export async function checkStsCallerIdentity(): Promise<void> {
  const { STSClient, GetCallerIdentityCommand } = await import(
    '@aws-sdk/client-sts'
  )
  await new STSClient().send(new GetCallerIdentityCommand({}))
}

export async function clearAwsIniCache(): Promise<void> {
  try {
    logForDebugging('Clearing AWS credential provider cache')
    const { fromIni } = await import('@aws-sdk/credential-providers')
    const iniProvider = fromIni({ ignoreCache: true })
    await iniProvider() 
    logForDebugging('AWS credential provider cache refreshed')
  } catch (_error) {
    
    logForDebugging(
      'Failed to clear AWS credential cache (this is expected if no credentials are configured)',
    )
  }
}
