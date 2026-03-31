import {
  STATUS_TAG,
  SUMMARY_TAG,
  TASK_NOTIFICATION_TAG,
} from '../constants/xml.js'
import { BACKGROUND_BASH_SUMMARY_PREFIX } from '../tasks/LocalShellTask/LocalShellTask.js'
import type {
  NormalizedUserMessage,
  RenderableMessage,
} from '../types/message.js'
import { isFullscreenEnvEnabled } from './fullscreen.js'
import { extractTag } from './messages.js'

function isCompletedBackgroundBash(
  msg: RenderableMessage,
): msg is NormalizedUserMessage {
  if (msg.type !== 'user') return false
  const content = msg.message.content[0]
  if (content?.type !== 'text') return false
  if (!content.text.includes(`<${TASK_NOTIFICATION_TAG}`)) return false
  
  if (extractTag(content.text, STATUS_TAG) !== 'completed') return false
  
  
  
  return (
    extractTag(content.text, SUMMARY_TAG)?.startsWith(
      BACKGROUND_BASH_SUMMARY_PREFIX,
    ) ?? false
  )
}

export function collapseBackgroundBashNotifications(
  messages: RenderableMessage[],
  verbose: boolean,
): RenderableMessage[] {
  if (!isFullscreenEnvEnabled()) return messages
  if (verbose) return messages

  const result: RenderableMessage[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]!
    if (isCompletedBackgroundBash(msg)) {
      let count = 0
      while (i < messages.length && isCompletedBackgroundBash(messages[i]!)) {
        count++
        i++
      }
      if (count === 1) {
        result.push(msg)
      } else {
        
        
        result.push({
          ...msg,
          message: {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `<${TASK_NOTIFICATION_TAG}><${STATUS_TAG}>completed</${STATUS_TAG}><${SUMMARY_TAG}>${count} background commands completed</${SUMMARY_TAG}></${TASK_NOTIFICATION_TAG}>`,
              },
            ],
          },
        })
      }
    } else {
      result.push(msg)
      i++
    }
  }

  return result
}
