# RippleClaw

Fast, autonomous AI agent optimized for low-power devices (Orange Pi, Raspberry Pi, etc.)

## Why RippleClaw?

RippleClaw was born as a learning project. I wanted something lightweight and custom, inspired by **OpenClaw**, but that I could call my own and build from the ground up to understand exactly how every piece of the puzzle fits together.

The name "**Ripple**" has a special meaning for me: it's the name I assign to all my projects, and it's inspired by a character from the *Mahou Shoujo* anime series. This project is the culmination of that learning journey, designed to run on a spare Orange Pi lite with 1GB of RAM without breaking a sweat, while giving you full control over your AI assistants.

[![GitHub Release](https://img.shields.io/github/v/release/xErik444x/rippleclaw)](https://github.com/xErik444x/rippleclaw/releases)
[![Build](https://github.com/xErik444x/rippleclaw/actions/workflows/release.yml/badge.svg)](https://github.com/xErik444x/rippleclaw/actions)

---

## Table of Contents

- [RippleClaw](#rippleclaw)
  - [Why RippleClaw?](#why-rippleclaw)
  - [Features](#features)
  - [Quick Start](#quick-start)
    - [Option 1: Binary (fastest)](#option-1-binary-fastest)
    - [Option 2: From source code](#option-2-from-source-code)
  - [Installation](#installation)
    - [From source code](#from-source-code)
    - [Precompiled binary](#precompiled-binary)
  - [Configuration](#configuration)
    - [Full example](#full-example)
    - [Notes](#notes)
    - [Email](#email)
  - [Channels](#channels)
    - [Telegram](#telegram)
    - [Discord](#discord)
    - [CLI](#cli)
  - [Commands](#commands)
    - [Email CLI](#email-cli)
    - [emailSender Tool](#emailsender-tool)
  - [Memory and Context](#memory-and-context)
    - [Memory commands (from chat)](#memory-commands-from-chat)
    - [Automatic compression](#automatic-compression)
  - [Manual Build](#manual-build)
    - [Windows](#windows)
    - [Linux x64](#linux-x64)
    - [Linux ARM64 (Orange Pi, Raspberry Pi)](#linux-arm64-orange-pi-raspberry-pi)
    - [GitHub Actions](#github-actions)
  - [Cron Jobs](#cron-jobs)
    - [Commands from chat](#commands-from-chat)
    - [Schedule format (cron)](#schedule-format-cron)
    - [Static configuration (alternative)](#static-configuration-alternative)
  - [Linux Service](#linux-service)
  - [Development](#development)
    - [Project structure](#project-structure)
  - [Security](#security)
    - [Recommended .gitignore](#recommended-gitignore)
  - [📄 License](#-license)

---

## Features

- **Lightweight** - Optimized for low-consumption devices.
- **Persistent Memory** - JSON storage with search capabilities.
- **Tools** - Shell, files, memory, weather, web.
- **Multi-provider** - OpenAI, Gemini, Groq, OpenRouter.
- **Multi-channel** - Telegram, Discord, CLI.
- **Scheduler** - Autonomous tasks with cron.
- **Secure Sandbox** - Workspace isolation.
- **Lightweight Email** - New tool and CLI for SMTP/HTTP sending with minimal configuration.
- **Binaries** - Runs without Node.js installed.

---

## Quick Start

### Option 1: Binary (fastest)

```bash
# Download from Releases:
# https://github.com/xErik444x/rippleclaw/releases

# Windows
rippleclaw.exe

# Linux
chmod +x rippleclaw
./rippleclaw
```

### Option 2: From source code

```bash
git clone https://github.com/xErik444x/rippleclaw.git
cd rippleclaw
npm install
npm run build
npm start
```

---

## Installation

### From source code

```bash
# Clone the repo
git clone https://github.com/xErik444x/rippleclaw.git
cd rippleclaw

# Install dependencies
npm install

# Development build
npm run build

# Start (requires config.json)
npm start
```

### Precompiled binary

1. Go to [Releases](https://github.com/xErik444x/rippleclaw/releases)
2. Download the binary for your platform:
   - `rippleclaw-win-x64.exe` - Windows
   - `rippleclaw-linux-x64` - Linux x64
3. For ARM (Raspberry Pi / Orange Pi), see [Manual Build](#linux-arm64-orange-pi-raspberry-pi)
4. Copy `config.json` next to the binary.
5. Execute.

---

## Configuration

The `config.json` file is searched in:

1. `./config.json` (local)
2. `$RIPPLECLAW_CONFIG`
3. `~/.rippleclaw/config.json`

### Full example

```json
{
  "name": "RippleClaw",
  "version": "0.1.0",
  "workspace": "~/.rippleclaw/workspace",
  "default_provider": "openai",
  "default_model": "gpt-4o-mini",
  "context": {
    "max_tokens": 16000,
    "compress_threshold": 0.85
  },
  "autonomy": "full",
  "providers": [
    {
      "name": "openai",
      "api_base": "https://api.openai.com/v1",
      "api_key": "sk-your-api-key-here",
      "models": ["gpt-4o", "gpt-4o-mini"]
    },
    {
      "name": "openrouter",
      "api_base": "https://openrouter.ai/api/v1",
      "api_key": "your-key-here",
      "models": ["openrouter/auto"]
    }
  ],
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "allowed_users": ["your_user_id"]
    },
    "discord": {
      "enabled": false,
      "token": "",
      "allowed_users": []
    },
    "cli": {
      "enabled": true
    }
  },
  "memory": {
    "backend": "json",
    "path": "~/.rippleclaw/memory.json",
    "auto_save": true
  },
  "tools": {
    "shell": {
      "enabled": true,
      "allowed_commands": ["git", "npm", "node", "ls", "cat"],
      "workspace_only": true
    },
    "file": {
      "enabled": true,
      "workspace_only": true
    },
    "web": {
      "enabled": true,
      "provider": "duckduckgo"
    }
  },
  "runtime": {
    "max_tool_concurrency": 1
  },
  "cron": {
    "enabled": true,
    "jobs": []
  }
}
```

### Notes

- **`allowed_users`**: Supports user ID, username, or `"*"` to allow everyone.
- **`memory.backend`**: `"json"` (recommended) or `"none"`.
- **`workspace_only`**: Limits tools to the workspace directory.

### Email

The new `email` block enables lightweight sending without additional SDKs. You only need to activate `enabled`, choose `provider` (`"smtp"` or `"api"`) and define `default_from`; the rest will be completed with safe defaults (`smtp.port: 587`, `smtp.secure: true`, `smtp.timeout_ms: 15000`). The package uses `nodemailer` for SMTP and `undici` for HTTP, so those dependencies are included in the binary.

```json
"email": {
  "enabled": true,
  "provider": "smtp",
  "default_from": "Ripple <no-reply@rippleclaw.dev>",
  "smtp": {
    "host": "smtp.example.com",
    "port": 587,
    "username": "user",
    "password": "secret",
    "secure": true,
    "timeout_ms": 15000
  },
  "api": {
    "base_url": "https://email.api/endpoint",
    "api_key": ""
  }
}
```

---

## Channels

### Telegram

1. Create a bot with [@BotFather](https://t.me/BotFather).
2. Obtain the token.
3. Get your user ID (send `/start` to @userinfobot).
4. Configure in `config.json`:

```json
"telegram": {
  "enabled": true,
  "token": "YOUR_TOKEN",
  "allowed_users": ["YOUR_USER_ID"]
}
```

5. Available commands (autocomplete):
   - `/start` - Start the bot
   - `/help` - Show help
   - `/newsession` - Restart session
   - `/status` - View status
   - `/compress` - Compress context

### Discord

1. Create an app in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a bot and obtain the token.
3. Enable "Message Content Intent".
4. Invite the bot with permissions:
   - Send Messages
   - Read Message History
5. Configure:

```json
"discord": {
  "enabled": true,
  "token": "YOUR_TOKEN",
  "allowed_users": []
}
```

### CLI

```bash
npm run cli
# or with binary
./rippleclaw --channel cli
```

---

## Commands

| Command       | Description                                  |
| ------------- | -------------------------------------------- |
| `/start`      | Start bot (Telegram)                         |
| `/help`       | Show help                                    |
| `/newsession` | Restart session / forget context             |
| `/status`     | View current status (model, tokens, messages)|
| `/compress`   | Manually compress context                    |
| `/exit`       | Exit (CLI)                                   |
| `/clear`      | Clear screen (CLI)                           |

### Email CLI

The `rippleclaw email send` command uses the same layer as `tools.emailSender`. Example:

```bash
rippleclaw email send --to user@example.com --subject "Test" --body "Hello" --dry-run
```

Add `--dry-run` to validate without touching the network. The CLI prints `Email dry-run successful` or `Email sent` and normalizes error codes (`INVALID_CONFIG`, `AUTHENTICATION`, `NETWORK`, `RATE_LIMIT`).

### emailSender Tool

The agent has the `emailSender` tool (defined in `tools/email.ts`). You can call it with `to`, `subject`, `body`, `body_type` (`plain` or `html`), and `attachments` (name + content). It returns `{ success, messageId?, error? }` and respects the same error codes as the CLI.

---

## Memory and Context

RippleClaw handles memory at two levels:

1. **Session** - Message history (JSON files in `~/.rippleclaw/sessions/`).
2. **Notes** - Persistent data (saved keywords).

### Memory commands (from chat)

```bash
# Save something to memory
"Remember that my name is Erik"

# View value
"What is my name?"

# Change bot name
"I'm going to call you Clown"
```

### Automatic compression

When context exceeds 85% of the limit, it automatically:

1. Summarizes the conversation.
2. Saves the summary.
3. Removes old messages.

Force compression: `/compress`.

---

## Manual Build

### Windows

```bash
npm install
npm run build:bin:win
# Output: bin/rippleclaw.exe
```

### Linux x64

```bash
npm install
npm run build:bin:linux-x64
# Output: bin/rippleclaw
```

### Linux ARM64 (Orange Pi, Raspberry Pi)

```bash
npm install
npm run build:bin:linux-arm64
```

### GitHub Actions

The `.github/workflows/release.yml` workflow automatically builds:

- `rippleclaw-linux-x64`
- `rippleclaw-win-x64.exe`

For ARM, see the [Linux ARM64](#linux-arm64-orange-pi-raspberry-pi) section. It runs on push to `main` and creates a release with the binaries.

---

## Cron Jobs

Cron jobs are managed from chat using the `cron` tool. Jobs are saved in memory and persist between sessions.

### Commands from chat

```
# List all cron jobs
"List my cron jobs" or use tool cron action=list

# Create a cron job
"Add a cron job named daily-summary at 9am that says Give me a summary of what you worked on yesterday"

# Delete a cron job
"Delete the cron job daily-summary"

# Enable/disable
"Enable the cron job daily-summary"
"Disable the cron job daily-summary"

# View a specific job
"Show the cron job reminder"
```

### Schedule format (cron)

| Expression     | Description                |
| -------------- | -------------------------- |
| `0 9 * * *`    | Every day at 9:00          |
| `0 9 * * 1-5`  | Monday to Friday at 9:00   |
| `*/15 * * * *` | Every 15 minutes           |
| `0 * * * *`    | Every hour                 |

Formats: `minute hour day month day_of_week`

### Static configuration (alternative)

You can also define static jobs in `config.json`:

```json
"cron": {
  "enabled": true,
  "jobs": [
    {
      "id": "daily-summary",
      "schedule": "0 9 * * *",
      "prompt": "Give me a summary of what you worked on yesterday"
    }
  ]
}
```

---

## Linux Service

```bash
# Install systemd service
sudo npm run service:install

# View logs
sudo journalctl -u rippleclaw -f

# Restart
sudo systemctl restart rippleclaw

# Status
systemctl status rippleclaw

# Uninstall
sudo npm run service:uninstall
```

Wrapper commands:

```bash
rippleclaw cli      # Interactive mode
rippleclaw logs     # View logs
rippleclaw status   # Service status
rippleclaw restart  # Restart
```

---

## Development

```bash
# Dev mode with hot-reload
npm run dev

# TypeScript check
npm run typecheck

# Tests
npm run test

# Lint
npm run lint

# Build
npm run build
```

### Project structure

```
src/
├── core/           # Agent, memory, scheduler, config
├── providers/      # LLM adapters
├── channels/       # CLI, Telegram, Discord
├── tools/          # shell, file, remember, model, env
└── daemon.ts       # Entry point
```

---

## Security

- **Workspace sandbox** - Files/shell limited to workspace.
- **Allowed commands** - Whitelist of permitted commands.
- **Secrets** - Do not commit `config.json` with API keys.
- **Email** - The logger redirects `email:send` without showing credentials (masked password/token) and `nodemailer`/`undici` dependencies are included for SMTP and HTTP APIs.

---

## 📄 License

MIT
