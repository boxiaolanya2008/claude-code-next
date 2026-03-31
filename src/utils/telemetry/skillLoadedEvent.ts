import { getSkillToolCommands } from '../../commands.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import { getCharBudget } from '../../tools/SkillTool/prompt.js'

export async function logSkillsLoaded(
  cwd: string,
  contextWindowTokens: number,
): Promise<void> {
  const skills = await getSkillToolCommands(cwd)
  const skillBudget = getCharBudget(contextWindowTokens)

  for (const skill of skills) {
    if (skill.type !== 'prompt') continue

    logEvent('tengu_skill_loaded', {
      
      
      _PROTO_skill_name:
        skill.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      skill_source:
        skill.source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skill_loaded_from:
        skill.loadedFrom as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skill_budget: skillBudget,
      ...(skill.kind && {
        skill_kind:
          skill.kind as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    })
  }
}
