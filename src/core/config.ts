import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type EmailProvider = "smtp" | "api";

export interface SmtpEmailConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
  timeout_ms: number;
}

export interface ApiEmailConfig {
  base_url: string;
  api_key: string;
}

export interface EmailConfig {
  enabled: boolean;
  provider: EmailProvider;
  default_from: string;
  smtp: SmtpEmailConfig;
  api: ApiEmailConfig;
}

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
    backend: "sqlite" | "json" | "none";
    path: string;
    auto_save: boolean;
  };
  tools: {
    shell: { enabled: boolean; allowed_commands: string[]; workspace_only: boolean };
    file: { enabled: boolean; workspace_only: boolean };
    web: {
      enabled: boolean;
      provider?: "duckduckgo" | "brave" | "tavily" | "perplexity" | "searxng" | "glm";
      api_key?: string;
      safe_search?: "off" | "moderate" | "strict";
      max_results?: number;
      proxy?: string;
      providers?: {
        brave?: { enabled?: boolean; api_keys?: string[] };
        tavily?: { enabled?: boolean; api_keys?: string[]; base_url?: string };
        duckduckgo?: { enabled?: boolean };
        perplexity?: { enabled?: boolean; api_keys?: string[] };
        searxng?: { enabled?: boolean; base_url?: string };
        glm?: { enabled?: boolean; api_key?: string; base_url?: string; search_engine?: string };
      };
    };
    weather: {
      enabled: boolean;
    };
    summarize: {
      enabled: boolean;
      default_model?: string;
      default_length?: "short" | "medium" | "long" | "xl" | "xxl";
      auto_install?: boolean;
      install_command?: string;
    };
  };
  runtime?: {
    max_tool_concurrency: number;
  };
  cron: {
    enabled: boolean;
    jobs: { id: string; schedule: string; prompt: string }[];
  };
  email: EmailConfig;
}

interface ConfigWithMetadata extends Config {
  _path?: string;
}

let _config: ConfigWithMetadata | null = null;

export function resolveConfigPath(): string {
  if (process.env.RIPPLECLAW_CONFIG) return process.env.RIPPLECLAW_CONFIG;
  return join(homedir(), ".rippleclaw", "config.json");
}

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
      backend: "json",
      path: join(homedir(), ".rippleclaw", "memory.json"),
      auto_save: true
    },
    tools: {
      shell: {
        enabled: true,
        allowed_commands: ["git", "npm", "node", "ls", "cat", "grep", "find", "echo", "pwd"],
        workspace_only: true
      },
      file: { enabled: true, workspace_only: true },
      web: { enabled: true, provider: "duckduckgo", safe_search: "moderate" },
      weather: { enabled: true },
      summarize: {
        enabled: false,
        auto_install: true,
        install_command: "npm i -g @steipete/summarize"
      }
    },
    runtime: { max_tool_concurrency: 1 },
    cron: { enabled: true, jobs: [] },
    email: createDefaultEmailConfig()
  };
}

export function loadConfig(configPath?: string): Config {
  if (_config) return _config;

  const home = process.env.HOME || homedir();
  const resolvedPath = configPath || resolveConfigPath();
  const pathCandidates = Array.from(
    new Set<string>([
      ...(configPath ? [configPath] : []),
      ...(process.env.RIPPLECLAW_CONFIG && process.env.RIPPLECLAW_CONFIG !== configPath
        ? [process.env.RIPPLECLAW_CONFIG]
        : []),
      "config.json",
      resolvedPath
    ])
  );

  let raw: string | null = null;
  let lastError: unknown;
  let finalPath = resolvedPath;

  for (const candidate of pathCandidates) {
    try {
      raw = readFileSync(candidate, "utf-8");
      finalPath = candidate;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (raw === null) {
    throw lastError ?? new Error(`Unable to read config from ${resolvedPath}`);
  }

  _config = JSON.parse(raw) as ConfigWithMetadata;
  _config._path = finalPath; // Store path for saving later

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

  if (!_config.tools.web) {
    _config.tools.web = { enabled: true, provider: "duckduckgo", safe_search: "moderate" };
  } else {
    if (_config.tools.web.enabled === undefined) _config.tools.web.enabled = true;
    if (!_config.tools.web.provider) _config.tools.web.provider = "duckduckgo";
    if (!_config.tools.web.safe_search) _config.tools.web.safe_search = "moderate";
  }
  if (!_config.tools.web.providers) {
    _config.tools.web.providers = { duckduckgo: { enabled: true } };
  } else if (_config.tools.web.providers.duckduckgo === undefined) {
    _config.tools.web.providers.duckduckgo = { enabled: true };
  }
  if (!_config.tools.weather) {
    _config.tools.weather = { enabled: true };
  }
  if (!_config.tools.summarize) {
    _config.tools.summarize = {
      enabled: false,
      auto_install: true,
      install_command: "npm i -g @steipete/summarize"
    };
  } else {
    if (_config.tools.summarize.auto_install === undefined) {
      _config.tools.summarize.auto_install = true;
    }
    if (!_config.tools.summarize.install_command) {
      _config.tools.summarize.install_command = "npm i -g @steipete/summarize";
    }
  }

  const emailDefaults = createDefaultEmailConfig();
  _config.email = mergeEmailConfig(emailDefaults, _config.email);
  validateEmailConfig(_config.email);

  return _config;
}

import { writeFileSync } from "fs";

export function saveConfig(config: Config): void {
  const metadata = config as ConfigWithMetadata;
  const path = metadata._path || resolveConfigPath();
  const toSave = { ...config } as ConfigWithMetadata;
  delete toSave._path;
  writeFileSync(path, JSON.stringify(toSave, null, 2), "utf-8");
}

export function updateConfig(config: Config, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = config as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (key.includes("[") && key.includes("]")) {
      const baseKey = key.split("[")[0];
      const index = parseInt(key.split("[")[1].split("]")[0]);
      if (!current[baseKey]) current[baseKey] = [];
      const arr = current[baseKey] as Record<string, unknown>[];
      if (!arr[index]) arr[index] = {};
      current = arr[index];
    } else {
      if (!current[key]) current[key] = {};
      current = current[key] as Record<string, unknown>;
    }
  }

  const lastKey = keys[keys.length - 1];
  let finalValue = value;

  // Smart type conversion based on existing value
  let target: Record<string, unknown> | unknown[];
  let targetKey: string | number;

  if (lastKey.includes("[") && lastKey.includes("]")) {
    const baseKey = lastKey.split("[")[0];
    const index = parseInt(lastKey.split("[")[1].split("]")[0]);
    if (!current[baseKey]) current[baseKey] = [];
    target = current[baseKey] as unknown[];
    targetKey = index;
  } else {
    target = current;
    targetKey = lastKey;
  }

  const existingValue = (target as Record<string, unknown>)[targetKey as string];
  if (typeof existingValue === "boolean" && typeof value === "string") {
    finalValue = value.toLowerCase() === "true" || value === "1" || value === "on";
  } else if (typeof existingValue === "number" && typeof value === "string") {
    finalValue = Number(value);
  } else if (typeof existingValue === "object" && existingValue !== null && typeof value === "string") {
    try {
      finalValue = JSON.parse(value);
    } catch {
      // Keep as string if not valid JSON
    }
  }

  if (Array.isArray(target)) {
    target[targetKey as number] = finalValue;
  } else {
    target[targetKey as string] = finalValue;
  }

  saveConfig(config);
}

const EMAIL_FROM_REGEX = /^(?:[^<>]+ <[^<>@]+@[^<>@]+\.[^<>@]+>|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)$/i;
const VALID_EMAIL_PROVIDERS: EmailProvider[] = ["smtp", "api"];

export function createDefaultEmailConfig(): EmailConfig {
  return {
    enabled: false,
    provider: "smtp",
    default_from: "Ripple <no-reply@rippleclaw.dev>",
    smtp: {
      host: "",
      port: 587,
      username: "",
      password: "",
      secure: true,
      timeout_ms: 15000
    },
    api: {
      base_url: "",
      api_key: ""
    }
  };
}

export function mergeEmailConfig(
  defaults: EmailConfig,
  override?: Partial<EmailConfig>
): EmailConfig {
  if (!override) return defaults;
  return {
    ...defaults,
    ...override,
    smtp: { ...defaults.smtp, ...(override.smtp ?? {}) },
    api: { ...defaults.api, ...(override.api ?? {}) }
  };
}

function validateEmailConfig(config: EmailConfig) {
  if (!config.default_from || !config.default_from.trim()) {
    config.default_from = createDefaultEmailConfig().default_from;
  } else {
    config.default_from = config.default_from.trim();
  }

  if (config.enabled) {
    if (!VALID_EMAIL_PROVIDERS.includes(config.provider)) {
      throw new Error(
        `Invalid email.provider "${config.provider}". Must be one of: ${VALID_EMAIL_PROVIDERS.join(", ")}`
      );
    }
    if (!EMAIL_FROM_REGEX.test(config.default_from)) {
      throw new Error(
        `email.default_from "${config.default_from}" must be in format "Name <email@domain>" or "email@domain"`
      );
    }
  }
}

export function getProvider(config: Config, name?: string): ProviderConfig {
  const providerName = name || config.default_provider;
  const provider = config.providers.find((p) => p.name === providerName);
  if (!provider) throw new Error(`Provider "${providerName}" not found in config`);
  return provider;
}
