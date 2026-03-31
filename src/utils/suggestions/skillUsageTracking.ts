import { getGlobalConfig, saveGlobalConfig } from '../config.js'

const SKILL_USAGE_DEBOUNCE_MS = 60_000

const lastWriteBySkill = new Map<string, number>()

export function recordSkillUsage(skillName: string): void {
  const now = Date.now()
  const lastWrite = lastWriteBySkill.get(skillName)
  
  
  if (lastWrite !== undefined && now - lastWrite < SKILL_USAGE_DEBOUNCE_MS) {
    return
  }
  lastWriteBySkill.set(skillName, now)
  saveGlobalConfig(current => {
    const existing = current.skillUsage?.[skillName]
    return {
      ...current,
      skillUsage: {
        ...current.skillUsage,
        [skillName]: {
          usageCount: (existing?.usageCount ?? 0) + 1,
          lastUsedAt: now,
        },
      },
    }
  })
}

export function getSkillUsageScore(skillName: string): number {
  const config = getGlobalConfig()
  const usage = config.skillUsage?.[skillName]
  if (!usage) return 0

  
  const daysSinceUse = (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24)
  const recencyFactor = Math.pow(0.5, daysSinceUse / 7)

  
  return usage.usageCount * Math.max(recencyFactor, 0.1)
}
