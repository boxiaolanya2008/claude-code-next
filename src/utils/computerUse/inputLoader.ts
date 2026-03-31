import type {
  ComputerUseInput,
  ComputerUseInputAPI,
} from '@ant/computer-use-input'

let cached: ComputerUseInputAPI | undefined

export function requireComputerUseInput(): ComputerUseInputAPI {
  if (cached) return cached
  
  const input = require('@ant/computer-use-input') as ComputerUseInput
  if (!input.isSupported) {
    throw new Error('@ant/computer-use-input is not supported on this platform')
  }
  return (cached = input)
}
