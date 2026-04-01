import { Box, Text } from 'ink'
import React from 'react'
import { setMockSubscriptionType } from '../../services/mockRateLimits.js'

export function StartMaxCommand(): React.ReactElement {
  // Set subscription to max
  setMockSubscriptionType('max')

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color="green" bold>
        ✓ Claude Max subscription activated
      </Text>
      <Text dimColor>
        All features unlocked: Opus model, 1M context, web search, and more.
      </Text>
      <Text dimColor>
        This sets the subscription type to 'max' for the current session.
      </Text>
    </Box>
  )
}

export default StartMaxCommand
