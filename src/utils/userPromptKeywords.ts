

export function matchesNegativeKeyword(input: string): boolean {
  const lowerInput = input.toLowerCase()

  const negativePattern =
    /\b(wtf|wth|ffs|omfg|shit(ty|tiest)?|dumbass|horrible|awful|piss(ed|ing)? off|piece of (shit|crap|junk)|what the (fuck|hell)|fucking? (broken|useless|terrible|awful|horrible)|fuck you|screw (this|you)|so frustrating|this sucks|damn it)\b/

  return negativePattern.test(lowerInput)
}

export function matchesKeepGoingKeyword(input: string): boolean {
  const lowerInput = input.toLowerCase().trim()

  
  if (lowerInput === 'continue') {
    return true
  }

  
  const keepGoingPattern = /\b(keep going|go on)\b/
  return keepGoingPattern.test(lowerInput)
}
