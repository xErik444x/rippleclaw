# RippleClaw

Fast, autonomous AI agent infrastructure for low-power devices.
Built with TypeScript + Node.js. Designed for Orange Pi, Raspberry Pi, and similar SBCs.

## Features

- Persistent memory via SQLite (better-sqlite3, FTS5 for full-text search)
- Tool use: shell execution, file read/write, persistent notes (remember), model switch
- Multi-provider: OpenAI, Gemini, Groq, OpenRouter, any OpenAI-compatible API
- Channels: Telegram, Discord, CLI
- Cron scheduler for autonomous recurring tasks
- systemd service for 24/7 daemon mode
- Lightweight runtime footprint
- Interactive setup TUI (providers, models, workspace, sandbox)

## Requirements

- Node.js >= 18
- API key for at least one provider

## Setup

```bash
# Clone and install dependencies
git clone <your-repo> rippleclaw
cd rippleclaw
npm install

# Edit config with your API keys
nano config.json

# Build
npm run build

# Test in CLI mode
npm run cli
```

## Config (config.json)

Config load order:

- ./config.json (local)
- $RIPPLECLAW_CONFIG
- ~/.rippleclaw/config.json

Example:

```json
{
  "name": "RippleClaw",
  "version": "0.1.0",
  "workspace": "~/.rippleclaw/workspace",
  "default_provider": "openai",
  "default_model": "gpt-4o",
  "context": {
    "max_tokens": 16000,
    "compress_threshold": 0.85
  },
  "autonomy": "full",
  "providers": [
    {
      "name": "openai",
      "api_base": "https://api.openai.com/v1",
      "api_key": "sk-...",
      "models": ["gpt-4o"]
    }
  ],
  "channels": {
    "telegram": { "enabled": false, "token": "", "allowed_users": [] },
    "discord": { "enabled": false, "token": "", "allowed_users": [] },
    "cli": { "enabled": true }
  },
  "memory": {
    "backend": "sqlite",
    "path": "~/.rippleclaw/memory.db",
    "auto_save": true
  },
  "tools": {
    "shell": {
      "enabled": true,
      "allowed_commands": ["git", "npm", "node"],
      "workspace_only": true
    },
    "file": { "enabled": true, "workspace_only": true }
  },
  "runtime": { "max_tool_concurrency": 1 },
  "cron": {
    "enabled": true,
    "jobs": []
  }
}
```

Notes:

- Telegram/Discord allowlist supports user ID, username, or "\*" to allow all.
- Tools are injected into the LLM only when shell or file tools are enabled (model tool is always available).
- allowed_commands is enforced when non-empty.

## Run

```bash
# Fast build (default)
npm run build

# Typecheck only
npm run typecheck

# Typecheck build (slower, full tsc)
npm run build:tsc

# Start configured channels (daemon)
npm start

# Startup menu (logs / CLI / daemon)
npm start -- --menu

# Interactive CLI
npm run cli

# Dev mode with auto-reload
npm run dev
```

## CLI setup (TUI)

From the CLI, run `/setup` to open the interactive menu. It supports:

- Configure API keys
- List models with search + pagination
- Select multiple models for a provider
- Set default provider/model
- Set workspace path
- Configure OS access (disable workspace-only sandbox)

## Quality

```bash
# Lint
npm run lint

# Format
npm run format

# Tests
npm run test
```

## Debug smoke (tools + prompts)

Ejecuta un script de prompts que fuerza llamadas a tools y valida flujo end-to-end:

```bash
npm run debug:chat -- --input scripts/debug-smoke.txt
```

## Add cron jobs

In config.json:

```json
"cron": {
  "enabled": true,
  "jobs": [
    {
      "id": "daily-summary",
      "schedule": "0 9 * * *",
      "prompt": "Give me a summary of what we worked on yesterday and suggest tasks for today"
    }
  ]
}
```

## Install as systemd service

```bash
# Install (patches WorkingDirectory/ExecStart)
npm run service:install

# Check logs
sudo journalctl -u rippleclaw -f

# Uninstall
npm run service:uninstall
```

Notes:
- The installer detects Node version managers (Volta, NVM via `.nvmrc`, asdf via `.tool-versions`) and
  configures `ExecStart` to use the correct Node version.

## Project structure

```
src/
├── core/
│   ├── agent.ts      # Agentic loop with tool calling
│   ├── memory.ts     # SQLite persistent memory + notes
│   ├── scheduler.ts  # Cron jobs
│   └── config.ts     # Config loader
├── providers/
│   └── base.ts       # LLM provider abstraction
├── channels/
│   ├── cli.ts        # Interactive terminal
│   ├── cli-setup.ts  # TUI setup (providers/models/workspace)
│   ├── telegram.ts   # Telegram bot
│   └── discord.ts    # Discord bot
├── tools/
│   └── index.ts      # shell, file, remember, model
└── daemon.ts         # Entry point
```

## Model switching (tool)

The agent can switch the default model at runtime via the `model` tool:

```json
{ "provider": "openai", "model": "gpt-4o" }
```

This is session-only. Persist via `/setup`.
