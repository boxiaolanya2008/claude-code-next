import { feature } from "../../utils/bundle-mock.ts"
import { shouldAutoEnableClaudeInChrome } from 'src/utils/claudeInChrome/setup.js'
import { registerBatchSkill } from './batch.js'
import { registerClaudeInChromeSkill } from './claudeInChrome.js'
import { registerDebugSkill } from './debug.js'
import { registerKeybindingsSkill } from './keybindings.js'
import { registerLoremIpsumSkill } from './loremIpsum.js'
import { registerRememberSkill } from './remember.js'
import { registerSimplifySkill } from './simplify.js'
import { registerSkillifySkill } from './skillify.js'
import { registerStuckSkill } from './stuck.js'
import { registerUpdateConfigSkill } from './updateConfig.js'
import { registerVerifySkill } from './verify.js'

export function initBundledSkills(): void {
  registerUpdateConfigSkill()
  registerKeybindingsSkill()
  registerVerifySkill()
  registerDebugSkill()
  registerLoremIpsumSkill()
  registerSkillifySkill()
  registerRememberSkill()
  registerSimplifySkill()
  registerBatchSkill()
  registerStuckSkill()
  if (feature('KAIROS') || feature('KAIROS_DREAM')) {
    
    const { registerDreamSkill } = require('./dream.js')
    
    registerDreamSkill()
  }
  if (feature('REVIEW_ARTIFACT')) {
    
    const { registerHunterSkill } = require('./hunter.js')
    
    registerHunterSkill()
  }
  if (feature('AGENT_TRIGGERS')) {
    
    const { registerLoopSkill } = require('./loop.js')
    
    
    
    
    registerLoopSkill()
  }
  if (feature('AGENT_TRIGGERS_REMOTE')) {
    
    const {
      registerScheduleRemoteAgentsSkill,
    } = require('./scheduleRemoteAgents.js')
    
    registerScheduleRemoteAgentsSkill()
  }
  if (feature('BUILDING_CLAUDE_APPS')) {
    
    const { registerClaudeApiSkill } = require('./claudeApi.js')
    
    registerClaudeApiSkill()
  }
  if (shouldAutoEnableClaudeInChrome()) {
    registerClaudeInChromeSkill()
  }
  if (feature('RUN_SKILL_GENERATOR')) {
    
    const { registerRunSkillGeneratorSkill } = require('./runSkillGenerator.js')
    
    registerRunSkillGeneratorSkill()
  }
}
