<div align="center">

<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="56" height="56" rx="12" fill="#1a1a2e"/>
  <path d="M20 24h24M20 32h16M20 40h20" stroke="#64ffda" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="48" cy="40" r="6" fill="#64ffda" opacity="0.3"/>
  <path d="M46 40l2 2 3-3" stroke="#64ffda" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>

# Claude Code Next

A locally runnable, repaired version of the Claude Code CLI tool with full interactive TUI support.

<a href="#star-history">
  <svg xmlns="http://www.w3.org/2000/svg" width="120" height="28" viewBox="0 0 120 28">
    <rect width="120" height="28" rx="14" fill="#1a1a2e" stroke="#64ffda" stroke-width="1"/>
    <path d="M22 8l1.5 3.5L27 12l-3.5 1.5L22 17l-1.5-3.5L17 12l3.5-1.5z" fill="#64ffda"/>
    <text x="32" y="18" fill="#e6f1ff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12" font-weight="600">Star</text>
  </svg>
</a>

[Quick Start](#quick-start) -- [Features](#features) -- [Architecture](#architecture) -- [Dashboard](#dashboard)

</div>

---

## Overview

This is a **locally runnable, repaired version** of the Claude Code CLI tool, based on source code from the Anthropic npm registry. The original leaked source could not run directly -- this repository fixes multiple blocking issues in the startup pipeline so that the full interactive TUI works locally. It supports connecting to any Anthropic-compatible API endpoint, not just Anthropic's official API.

## Features

- **Full Interactive TUI** -- React 19 + Ink 6 terminal UI with rich text rendering
- **Multi-API Support** -- Works with Anthropic, MiniMax, OpenRouter, AWS Bedrock, and any compatible endpoint
- **45+ Agent Tools** -- Bash, file I/O, search, web fetch, MCP, LSP, and more
- **103 Slash Commands** -- Built-in commands for common workflows
- **Built-in Dashboard** -- Web UI on port 3456 for session and token monitoring
- **Skill System** -- Extensible skills for thinking, coding, and debugging architecture
- **MCP Protocol** -- Model Context Protocol SDK integration
- **SQLite Persistence** -- Session history and token usage tracking

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun |
| Language | TypeScript (ESNext) |
| TUI | React 19 + Ink v6 |
| API Client | @anthropic-ai/sdk v0.80.0 |
| Protocols | MCP SDK, LSP |
| Validation | Zod v4, AJV |
| Telemetry | OpenTelemetry, Datadog, GrowthBook |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- [Node.js](https://nodejs.org) (for npm global install)
- An API key for an Anthropic-compatible API

### Installation

**Option 1: Local development (quick start)**

```bash
# Clone the repository
git clone <repository-url>
cd claude-code-next

# Install dependencies
bun install

# Run interactive TUI
start.bat
```

Or directly with Bun:

```bash
bun src/entrypoints/cli.tsx
```

**Option 2: Global installation (local only)**

⚠️ **Note**: `npm install -g .` creates a symlink to the current directory. This only works on the current computer.

```bash
npm install -g .
```

This registers commands for use on this computer:
- `ccn` - short command  
- `claude-code-next` - full command

Run from any directory:

```bash
cd /path/to/your/project
ccn
```

**To uninstall:**

```bash
npm uninstall -g claude-code-next
```

**Option 3: Distributable package (for multiple computers)**

To install on different computers:

1. **Build package** (on development machine):

```bash
build.bat
```

This creates `claude-code-next-2026.04.01.tgz`

2. **Install on any computer**:

```bash
npm install -g claude-code-next-2026.04.01.tgz
```

This creates a true copy that works on any machine with Bun + Node.js installed.

```bash
bun src/entrypoints/cli.tsx
```

### Running

**Interactive TUI (full interface):**

```bash
ccn
# or if using local development
start.bat
```

**Headless mode (single prompt):**

```bash
ccn -p "explain this codebase"
# or
bun src/entrypoints/cli.tsx -p "explain this codebase"
```

**Pipe input:**

```bash
echo "explain this code" | ccn -p
```

**View all CLI options:**

```bash
ccn --help
```

## Dashboard

After starting the CLI in interactive mode, open a browser to:

```
http://127.0.0.1:3456
```

The dashboard displays:

- Current model name and API endpoint
- Session statistics (total sessions, tokens, cache efficiency)
- Daily token usage charts (last 30 days)
- Token distribution breakdown
- Recent sessions table with model, duration, and token counts

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | API key (x-api-key header) |
| `ANTHROPIC_AUTH_TOKEN` | Auth token (Bearer header) |
| `ANTHROPIC_BASE_URL` | Custom API endpoint |
| `ANTHROPIC_MODEL` | Default model name |
| `API_TIMEOUT_MS` | Request timeout (default 600000ms) |
| `DISABLE_TELEMETRY=1` | Disable telemetry |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | Disable non-essential network calls |

### Configuration Files

Global configuration is automatically loaded from:

- **Windows**: `%APPDATA%\.claude\settings.json`
- **Linux/Mac**: `~/.claude/settings.json`

To set your API key, create or edit `settings.json`:

```json
{
  "apiKeyHelper": "your-api-key-here"
}
```

Or create a `.env` file in the project directory:

```bash
ANTHROPIC_API_KEY=your_key_here
# or for custom endpoints
OPENAI_API_KEY=your_key_here
```

## Architecture

```
src/
  entrypoints/     # Entry points (CLI, MCP, SDK)
  main.tsx         # TUI main logic (~4697 lines)
  ink/             # Ink terminal rendering engine (48 files)
  components/      # React UI components (144 files)
  tools/           # Agent tools (45+ implementations)
  commands/        # Slash commands (103 implementations)
  skills/          # Skill system
  services/        # Service layer (API, MCP, OAuth, Dashboard)
  bootstrap/       # State management and initialization
  constants/       # System prompts and configuration
  utils/           # Utility functions (80+ files)
```

## Directory Structure

```
claude-code-next/
  bin/              # Launcher scripts (bash + bat)
  src/              # All source code
  stubs/            # Stub files for missing native modules
  docs/             # Architecture documentation
  .claude/          # Local configuration and skills
  start.bat         # Windows quick-start script
  bunfig.toml       # Bun configuration
  tsconfig.json     # TypeScript configuration
  package.json      # Dependencies
```

## Key Files

| File | Role |
|------|------|
| `bin/claude-code-next.bat` | Windows batch entry script |
| `start.bat` | Quick-start Windows batch file |
| `preload.ts` | Bun preload script (sets MACRO globals) |
| `src/entrypoints/cli.tsx` | Main CLI entry point |
| `src/main.tsx` | TUI main logic |
| `src/setup.ts` | Startup initialization |
| `src/query.ts` | API query engine and message loop |
| `src/services/dashboard/` | Built-in web dashboard |

## License

This repository is for local development and testing purposes.

---

## Star History

<a href="#star-history">
  <svg xmlns="http://www.w3.org/2000/svg" width="120" height="28" viewBox="0 0 120 28">
    <rect width="120" height="28" rx="14" fill="#1a1a2e" stroke="#64ffda" stroke-width="1"/>
    <path d="M22 8l1.5 3.5L27 12l-3.5 1.5L22 17l-1.5-3.5L17 12l3.5-1.5z" fill="#64ffda"/>
    <text x="32" y="18" fill="#e6f1ff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="12" font-weight="600">Star</text>
  </svg>
</a>

[![Star History Chart](https://api.star-history.com/svg?repos=boxiaolanya2008/claude-code-next&type=Date)](https://star-history.com/#boxiaolanya2008/claude-code-next&Date)
