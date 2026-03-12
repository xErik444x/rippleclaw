# RippleClaw

Fast, autonomous AI agent infrastructure optimized for low‑power devices.
Built with TypeScript + Node.js and designed for Orange Pi, Raspberry Pi, and other SBCs.

**Why RippleClaw**
- Lightweight runtime footprint
- Persistent memory with SQLite + FTS5
- Tooling system for file, shell, model switch, and memory notes
- Multi‑provider LLM support (OpenAI, Gemini, Groq, OpenRouter, any OpenAI‑compatible API)
- Telegram, Discord, and CLI channels
- Cron scheduler for autonomous tasks
- Systemd‑ready for 24/7 operation
- Interactive TUI setup for configuration and model selection

**Highlights**
- Deterministic tool sandboxing with workspace isolation
- Runtime context compression for long sessions
- Tool concurrency limits for low‑CPU/RAM devices
- Service installer with Node version manager detection (Volta, NVM, asdf)

---

**Quick Start**
```bash
git clone <your-repo> rippleclaw
cd rippleclaw
npm install
npm run build
npm start
```

---

**Configuration**
Config load order:
- `./config.json`
- `$RIPPLECLAW_CONFIG`
- `~/.rippleclaw/config.json`

Example `config.json`:
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
  "cron": { "enabled": true, "jobs": [] }
}
```

Notes:
- Allowlists support user ID, username, or `"*"` to allow all.
- Tools are injected into the LLM only when shell or file tools are enabled.
- `allowed_commands` is enforced if non‑empty.

---

**Usage**
```bash
# Start configured channels (daemon)
npm start

# Startup menu (logs / CLI / daemon)
npm start -- --menu

# Interactive CLI
npm run cli

# Dev mode with auto‑reload
npm run dev
```

---

**Build & Quality**
```bash
# Fast build (default)
npm run build

# Typecheck only
npm run typecheck

# Typecheck build (full tsc output)
npm run build:tsc

# Lint
npm run lint

# Tests
npm run test
```

**Debug smoke (tools + prompts)**
```bash
npm run debug:chat -- --input scripts/debug-smoke.txt
```

---

**Systemd Service (Linux)**
```bash
# Install (patches WorkingDirectory/ExecStart)
npm run service:install

# Follow logs
sudo journalctl -u rippleclaw -f

# Uninstall
npm run service:uninstall
```

Wrapper installed at `/usr/local/bin/rippleclaw`:
```bash
rippleclaw cli
rippleclaw logs
rippleclaw status
rippleclaw restart
```

Notes:
- Installer detects Node version managers (Volta, NVM via `.nvmrc`, asdf via `.tool-versions`)
  and configures `ExecStart` accordingly.

---

**CLI Setup (TUI)**
From the CLI, run `/setup` to configure:
- API keys
- Provider models (search + pagination)
- Default provider/model
- Workspace path
- OS access (workspace‑only sandbox)

---

**Cron Jobs**
In `config.json`:
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

---

**Project Structure**
```
src/
├── core/          # Agent loop, memory, scheduler, config, logging
├── providers/     # LLM provider adapters
├── channels/      # CLI, Telegram, Discord
├── tools/         # shell, file, remember, model, env
└── daemon.ts      # Entry point
```

---

**Security & Safety**
- Workspace sandbox for file and shell tools
- Allowed commands list for shell execution
- Secrets stored in `config.json` (do not commit)

Recommended `.gitignore` entries:
```
config.json
.rippleclaw/
node_modules/
dist/
```
