#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Get the project directory (parent of bin directory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.resolve(__dirname, '..');

// Build paths
const envFile = path.join(projectDir, '.env');
const cliFile = path.join(projectDir, 'src', 'entrypoints', 'cli.tsx');
const preloadFile = path.join(projectDir, 'preload.ts');

// Build args
const args = ['--preload', preloadFile];

// Add .env if exists
if (fs.existsSync(envFile)) {
  args.push('--env-file', envFile);
}

args.push(cliFile, ...process.argv.slice(2));

// Find bun executable
let bunCmd = 'bun';
const possiblePaths = [
  path.join(process.env.USERPROFILE || '', '.bun', 'bin', 'bun.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'bun', 'bin', 'bun.exe'),
];

if (process.platform === 'win32') {
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      bunCmd = p;
      break;
    }
  }
}

// Spawn bun process
const proc = spawn(bunCmd, args, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CLAUDE_CODE_ORIGINAL_CWD: process.cwd() }
});

proc.on('exit', (code) => process.exit(code ?? 0));
