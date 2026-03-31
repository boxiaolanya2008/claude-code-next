import { SETTING_SOURCES, type SettingSource } from '../settings/constants.js'
import {
  getSettings_DEPRECATED,
  getSettingsForSource,
} from '../settings/settings.js'
import { type EnvironmentResource, fetchEnvironments } from './environments.js'

export type EnvironmentSelectionInfo = {
  availableEnvironments: EnvironmentResource[]
  selectedEnvironment: EnvironmentResource | null
  selectedEnvironmentSource: SettingSource | null
}

export async function getEnvironmentSelectionInfo(): Promise<EnvironmentSelectionInfo> {
  
  const environments = await fetchEnvironments()

  if (environments.length === 0) {
    return {
      availableEnvironments: [],
      selectedEnvironment: null,
      selectedEnvironmentSource: null,
    }
  }

  
  const mergedSettings = getSettings_DEPRECATED()
  const defaultEnvironmentId = mergedSettings?.remote?.defaultEnvironmentId

  
  let selectedEnvironment: EnvironmentResource =
    environments.find(env => env.kind !== 'bridge') ?? environments[0]!
  let selectedEnvironmentSource: SettingSource | null = null

  if (defaultEnvironmentId) {
    const matchingEnvironment = environments.find(
      env => env.environment_id === defaultEnvironmentId,
    )

    if (matchingEnvironment) {
      selectedEnvironment = matchingEnvironment

      
      
      for (let i = SETTING_SOURCES.length - 1; i >= 0; i--) {
        const source = SETTING_SOURCES[i]
        if (!source || source === 'flagSettings') {
          
          continue
        }
        const sourceSettings = getSettingsForSource(source)
        if (
          sourceSettings?.remote?.defaultEnvironmentId === defaultEnvironmentId
        ) {
          selectedEnvironmentSource = source
          break
        }
      }
    }
  }

  return {
    availableEnvironments: environments,
    selectedEnvironment,
    selectedEnvironmentSource,
  }
}
