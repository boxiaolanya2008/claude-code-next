import { basename, extname, posix, sep } from 'path'

const EXCLUDED_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'composer.lock',
  'gemfile.lock',
  'cargo.lock',
  'poetry.lock',
  'pipfile.lock',
  'shrinkwrap.json',
  'npm-shrinkwrap.json',
])

const EXCLUDED_EXTENSIONS = new Set([
  '.lock',
  '.min.js',
  '.min.css',
  '.min.html',
  '.bundle.js',
  '.bundle.css',
  '.generated.ts',
  '.generated.js',
  '.d.ts', 
])

const EXCLUDED_DIRECTORIES = [
  '/dist/',
  '/build/',
  '/out/',
  '/output/',
  '/node_modules/',
  '/vendor/',
  '/vendored/',
  '/third_party/',
  '/third-party/',
  '/external/',
  '/.next/',
  '/.nuxt/',
  '/.svelte-kit/',
  '/coverage/',
  '/__pycache__/',
  '/.tox/',
  '/venv/',
  '/.venv/',
  '/target/release/',
  '/target/debug/',
]

const EXCLUDED_FILENAME_PATTERNS = [
  /^.*\.min\.[a-z]+$/i, 
  /^.*-min\.[a-z]+$/i, 
  /^.*\.bundle\.[a-z]+$/i, 
  /^.*\.generated\.[a-z]+$/i, 
  /^.*\.gen\.[a-z]+$/i, 
  /^.*\.auto\.[a-z]+$/i, 
  /^.*_generated\.[a-z]+$/i, 
  /^.*_gen\.[a-z]+$/i, 
  /^.*\.pb\.(go|js|ts|py|rb)$/i, 
  /^.*_pb2?\.py$/i, 
  /^.*\.pb\.h$/i, 
  /^.*\.grpc\.[a-z]+$/i, 
  /^.*\.swagger\.[a-z]+$/i, 
  /^.*\.openapi\.[a-z]+$/i, 
]

export function isGeneratedFile(filePath: string): boolean {
  
  const normalizedPath =
    posix.sep + filePath.split(sep).join(posix.sep).replace(/^\/+/, '')
  const fileName = basename(filePath).toLowerCase()
  const ext = extname(filePath).toLowerCase()

  
  if (EXCLUDED_FILENAMES.has(fileName)) {
    return true
  }

  
  if (EXCLUDED_EXTENSIONS.has(ext)) {
    return true
  }

  
  const parts = fileName.split('.')
  if (parts.length > 2) {
    const compoundExt = '.' + parts.slice(-2).join('.')
    if (EXCLUDED_EXTENSIONS.has(compoundExt)) {
      return true
    }
  }

  
  for (const dir of EXCLUDED_DIRECTORIES) {
    if (normalizedPath.includes(dir)) {
      return true
    }
  }

  
  for (const pattern of EXCLUDED_FILENAME_PATTERNS) {
    if (pattern.test(fileName)) {
      return true
    }
  }

  return false
}

export function filterGeneratedFiles(files: string[]): string[] {
  return files.filter(file => !isGeneratedFile(file))
}
