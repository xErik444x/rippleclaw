import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface ProviderConfig {
  name: string;
  api_base: string;
  api_key: string;
  models: string[];
}

export interface Config {
  name: string;
  version: string;
  workspace: string;
  default_provider: string;
  default_model: string;
  autonomy: "readonly" | "supervised" | "full";
  context?: {
    max_tokens: number;
    compress_threshold?: number;
  };
  providers: ProviderConfig[];
  channels: {
    telegram: { enabled: boolean; token: string; allowed_users: string[] };
    discord: { enabled: boolean; token: string; allowed_users: string[] };
    cli: { enabled: boolean };
  };
  memory: {
    backend: "sqlite" | "none";
    path: string;
    auto_save: boolean;
  };
  tools: {
    shell: { enabled: boolean; allowed_commands: string[]; workspace_only: boolean };
    file: { enabled: boolean; workspace_only: boolean };
  };
  runtime?: {
    max_tool_concurrency: number;
  };
  cron: {
    enabled: boolean;
    jobs: { id: string; schedule: string; prompt: string }[];
  };
}

let _config: Config | null = null;

export function createDefaultConfig(): Config {
  return {
    name: "RippleClaw",
    version: "0.1.0",
    workspace: "./",
    default_provider: "openai",
    default_model: "gpt-4o-mini",
    autonomy: "full",
    context: { max_tokens: 16000, compress_threshold: 0.85 },
    providers: [
      {
        name: "openai",
        api_base: "https://api.openai.com/v1",
        api_key: "",
        models: ["gpt-4o", "gpt-4o-mini"]
      },
      {
        name: "gemini",
        api_base: "https://generativelanguage.googleapis.com/v1beta",
        api_key: "",
        models: ["gemini-2.0-flash"]
      },
      {
        name: "groq",
        api_base: "https://api.groq.com/openai/v1",
        api_key: "",
        models: ["llama-3.3-70b-versatile"]
      },
      {
        name: "openrouter",
        api_base: "https://openrouter.ai/api/v1",
        api_key: "",
        models: ["openrouter/auto"]
      }
    ],
    channels: {
      telegram: { enabled: false, token: "", allowed_users: [] },
      discord: { enabled: false, token: "", allowed_users: [] },
      cli: { enabled: true }
    },
    memory: {
      backend: "sqlite",
      path: join(homedir(), ".rippleclaw", "memory.db"),
      auto_save: true
    },
    tools: {
      shell: { enabled: true, allowed_commands: ["git", "npm", "node", "ls", "cat", "grep", "find", "echo", "pwd"], workspace_only: true },
      file: { enabled: true, workspace_only: true }
    },
    runtime: { max_tool_concurrency: 1 },
    cron: { enabled: true, jobs: [] }
  };
}

export function loadConfig(configPath?: string): Config {
  if (_config) return _config;

  const home = process.env.HOME || homedir();
  const path = configPath || process.env.RIPPLECLAW_CONFIG || join(home, ".rippleclaw", "config.json");

  // Try local config.json first (dev mode)
  let raw: string;
  try {
    raw = readFileSync("config.json", "utf-8");
  } catch {
    raw = readFileSync(path, "utf-8");
  }

  _config = JSON.parse(raw) as Config;

  // Expand ~ in paths
  if (_config.memory.path.startsWith("~")) {
    _config.memory.path = _config.memory.path.replace("~", home);
  }
  if (_config.workspace.startsWith("~")) {
    _config.workspace = _config.workspace.replace("~", home);
  }

  if (!_config.context) {
    _config.context = { max_tokens: 16000, compress_threshold: 0.85 };
  } else {
    if (!_config.context.max_tokens) _config.context.max_tokens = 16000;
    if (!_config.context.compress_threshold) _config.context.compress_threshold = 0.85;
  }
  if (!_config.runtime) {
    _config.runtime = { max_tool_concurrency: 1 };
  } else {
    if (!_config.runtime.max_tool_concurrency) _config.runtime.max_tool_concurrency = 1;
  }

  return _config;
}

export function getProvider(config: Config, name?: string): ProviderConfig {
  const providerName = name || config.default_provider;
  const provider = config.providers.find((p) => p.name === providerName);
  if (!provider) throw new Error(`Provider "${providerName}" not found in config`);
  return provider;
}
