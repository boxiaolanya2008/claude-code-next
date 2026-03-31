

export function cliError(msg?: string): never {
  
  if (msg) console.error(msg)
  process.exit(1)
  return undefined as never
}

export function cliOk(msg?: string): never {
  if (msg) process.stdout.write(msg + '\n')
  process.exit(0)
  return undefined as never
}
