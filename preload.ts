const version = process.env.CLAUDE_CODE_LOCAL_VERSION ?? '2026.04.01';
const packageUrl = process.env.CLAUDE_CODE_LOCAL_PACKAGE_URL ?? 'claude-code-local';
const buildTime = process.env.CLAUDE_CODE_LOCAL_BUILD_TIME ?? new Date().toISOString();

process.env.CLAUDE_CODE_LOCAL_SKIP_REMOTE_PREFETCH ??= '1';

// If CLAUDE_CODE_ORIGINAL_CWD is set (by global install script), use it for cwd
if (process.env.CLAUDE_CODE_ORIGINAL_CWD) {
  // biome-ignore lint/suspicious/noConsole:: debug output
  console.error(`[preload] CLAUDE_CODE_ORIGINAL_CWD=${process.env.CLAUDE_CODE_ORIGINAL_CWD}`);
  // Store it for use by state.ts
  process.env.CLAUDE_CODE_CWD_OVERRIDE = process.env.CLAUDE_CODE_ORIGINAL_CWD;
  // biome-ignore lint/suspicious/noConsole:: debug output
  console.error(`[preload] Set CLAUDE_CODE_CWD_OVERRIDE=${process.env.CLAUDE_CODE_CWD_OVERRIDE}`);
}

Object.assign(globalThis, {
  MACRO: {
    VERSION: version,
    PACKAGE_URL: packageUrl,
    NATIVE_PACKAGE_URL: packageUrl,
    BUILD_TIME: buildTime,
    FEEDBACK_CHANNEL: 'local',
    VERSION_CHANGELOG: '',
    ISSUES_EXPLAINER: '',
  },
});
