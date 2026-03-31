

export function parseYaml(input: string): unknown {
  if (typeof Bun !== 'undefined') {
    return Bun.YAML.parse(input)
  }
  
  return (require('yaml') as typeof import('yaml')).parse(input)
}
