import type { TextProps } from '../ink.js'
import {
  AGENT_COLOR_TO_THEME_COLOR,
  type AgentColorName,
} from '../tools/AgentTool/agentColorManager.js'

const DEFAULT_AGENT_THEME_COLOR = 'cyan_FOR_SUBAGENTS_ONLY'

export function toInkColor(color: string | undefined): TextProps['color'] {
  if (!color) {
    return DEFAULT_AGENT_THEME_COLOR
  }
  
  const themeColor = AGENT_COLOR_TO_THEME_COLOR[color as AgentColorName]
  if (themeColor) {
    return themeColor
  }
  
  return `ansi:${color}` as TextProps['color']
}
