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
  cron: {
    enabled: boolean;
    jobs: { id: string; schedule: string; prompt: string }[];
  };
}

let _config: Config | null = null;

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

  return _config;
}

export function getProvider(config: Config, name?: string): ProviderConfig {
  const providerName = name || config.default_provider;
  const provider = config.providers.find((p) => p.name === providerName);
  if (!provider) throw new Error(`Provider "${providerName}" not found in config`);
  return provider;
}
