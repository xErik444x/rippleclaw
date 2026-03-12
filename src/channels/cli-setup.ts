import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { Config, ProviderConfig } from "../core/config";
import { resolveConfigPath } from "../core/config";

type ModelInfo = {
  id: string;
  name?: string;
  contextLength?: number;
};

async function getInquirer() {
  const mod = await import("inquirer");
  return mod.default;
}

function normalizeOpenAIModels(data: { data?: { id: string }[] }): ModelInfo[] {
  return (data.data || []).map((m) => ({ id: m.id }));
}

function normalizeOpenRouterModels(data: { data?: { id: string; name?: string; context_length?: number }[] }): ModelInfo[] {
  return (data.data || []).map((m) => ({
    id: m.id,
    name: m.name,
    contextLength: m.context_length
  }));
}

function normalizeGeminiModels(data: { models?: { name: string }[] }): ModelInfo[] {
  return (data.models || []).map((m) => ({
    id: m.name.replace(/^models\//, "")
  }));
}

async function fetchModels(provider: ProviderConfig): Promise<ModelInfo[]> {
  const base = provider.api_base.replace(/\/+$/, "");
  const name = provider.name.toLowerCase();

  if (name === "gemini") {
    if (!provider.api_key) throw new Error("Gemini API key required");
    const models: ModelInfo[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${base}/models`);
      url.searchParams.set("key", provider.api_key);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Gemini models error ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { models?: { name: string }[]; nextPageToken?: string };
      models.push(...normalizeGeminiModels(data));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return models;
  }

  const url = `${base}/models`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.api_key) headers.Authorization = `Bearer ${provider.api_key}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${provider.name} models error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { data?: { id: string }[] };

  if (name === "openrouter") {
    return normalizeOpenRouterModels(data as { data?: { id: string; name?: string; context_length?: number }[] });
  }

  return normalizeOpenAIModels(data);
}

function formatModels(models: ModelInfo[], filter: string, limit: number): string[] {
  const trimmed = filter.trim().toLowerCase();
  const filtered = trimmed
    ? models.filter((m) => m.id.toLowerCase().includes(trimmed) || m.name?.toLowerCase().includes(trimmed))
    : models;
  const slice = filtered.slice(0, limit);
  return slice.map((m) => {
    const label = m.name ? `${m.id} (${m.name})` : m.id;
    return m.contextLength ? `${label}  [ctx ${m.contextLength}]` : label;
  });
}

function filterModels(models: ModelInfo[], filter: string): ModelInfo[] {
  const trimmed = filter.trim().toLowerCase();
  return trimmed
    ? models.filter((m) => m.id.toLowerCase().includes(trimmed) || m.name?.toLowerCase().includes(trimmed))
    : models;
}

async function listModelsPaginated(models: ModelInfo[]): Promise<void> {
  const inquirer = await getInquirer();
  let currentFilter = "";
  const askFilter = async () => {
    const { filter } = await inquirer.prompt([
      { type: "input", name: "filter", message: "Search (e.g. codex, free, auto)" }
    ]);
    currentFilter = filter || "";
  };

  await askFilter();
  let filtered = filterModels(models, currentFilter);
  const pageSize = 15;
  let page = 0;

  while (true) {
    const start = page * pageSize;
    const pageModels = filtered.slice(start, start + pageSize);
    const header = `Models ${start + 1}-${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`;
    const choices = [
      ...pageModels.map((m) => {
        const label = m.name ? `${m.id} (${m.name})` : m.id;
        return m.contextLength ? `${label}  [ctx ${m.contextLength}]` : label;
      }),
      new inquirer.Separator(),
      { name: "Search", value: "__search" },
      { name: "Next page", value: "__next" },
      { name: "Previous page", value: "__prev" },
      { name: "Exit", value: "__exit" }
    ];

    const { pick } = await inquirer.prompt([
      { type: "list", name: "pick", message: header, choices, pageSize: 20 }
    ]);

    if (pick === "__search") {
      await askFilter();
      filtered = filterModels(models, currentFilter);
      page = 0;
      continue;
    }
    if (pick === "__next") {
      if ((page + 1) * pageSize < filtered.length) page++;
      continue;
    }
    if (pick === "__prev") {
      if (page > 0) page--;
      continue;
    }
    if (pick === "__exit") break;
  }
}

async function selectModelsPaginated(models: ModelInfo[], initial: string[] = []): Promise<string[]> {
  const inquirer = await getInquirer();
  let currentFilter = "";
  const askFilter = async () => {
    const { filter } = await inquirer.prompt([
      { type: "input", name: "filter", message: "Search (e.g. codex, free, auto)" }
    ]);
    currentFilter = filter || "";
  };

  await askFilter();
  let filtered = filterModels(models, currentFilter);
  const pageSize = 12;
  let page = 0;
  const selected = new Set(initial);

  while (true) {
    const start = page * pageSize;
    const pageModels = filtered.slice(start, start + pageSize);
    const header = `Select models ${start + 1}-${Math.min(start + pageSize, filtered.length)} of ${filtered.length}`;
    const choices = [
      ...pageModels.map((m) => {
        const label = m.name ? `${m.id} (${m.name})` : m.id;
        const text = m.contextLength ? `${label}  [ctx ${m.contextLength}]` : label;
        const mark = selected.has(m.id) ? "[x]" : "[ ]";
        return { name: `${mark} ${text}`, value: m.id };
      }),
      new inquirer.Separator(),
      { name: "Search", value: "__search" },
      { name: "Next page", value: "__next" },
      { name: "Previous page", value: "__prev" },
      { name: "Done", value: "__done" }
    ];

    const { pick } = await inquirer.prompt([
      { type: "list", name: "pick", message: header, choices, pageSize: 18 }
    ]);

    if (pick === "__search") {
      await askFilter();
      filtered = filterModels(models, currentFilter);
      page = 0;
      continue;
    }
    if (pick === "__next") {
      if ((page + 1) * pageSize < filtered.length) page++;
      continue;
    }
    if (pick === "__prev") {
      if (page > 0) page--;
      continue;
    }
    if (pick === "__done") break;

    if (selected.has(pick)) selected.delete(pick);
    else selected.add(pick);
  }

  return Array.from(selected);
}

async function chooseProvider(config: Config): Promise<ProviderConfig> {
  const inquirer = await getInquirer();
  const choices = config.providers.map((p) => ({
    name: `${p.name}${p.api_key ? " ✅" : ""}`,
    value: p.name
  }));
  const { providerName } = await inquirer.prompt([
    { type: "list", name: "providerName", message: "Select provider", choices, pageSize: 10 }
  ]);
  const provider = config.providers.find((p) => p.name === providerName);
  if (!provider) throw new Error("Provider not found");
  return provider;
}

async function chooseModelFromList(provider: ProviderConfig, models: ModelInfo[]): Promise<string> {
  const inquirer = await getInquirer();
  const filtered = await inquirer.prompt([
    { type: "input", name: "filter", message: "Filter models (optional)" }
  ]);
  const list = formatModels(models, filtered.filter || "", 300);
  const choices = list.length ? list : ["<no matches>"];
  const { modelChoice } = await inquirer.prompt([
    { type: "list", name: "modelChoice", message: "Select model", choices, pageSize: 15 }
  ]);
  return modelChoice.split(" ")[0];
}

async function configureProviderKey(config: Config): Promise<void> {
  const inquirer = await getInquirer();
  const provider = await chooseProvider(config);
  const { apiKey } = await inquirer.prompt([
    { type: "password", name: "apiKey", message: `API key for ${provider.name}`, mask: "*" }
  ]);
  provider.api_key = apiKey;
}

async function pickDefaultProviderModel(config: Config): Promise<void> {
  const provider = await chooseProvider(config);
  let models: ModelInfo[] = [];
  try {
    models = await fetchModels(provider);
  } catch {
    // fallback to config list
    models = (provider.models || []).map((id) => ({ id }));
  }
  const model = models.length ? await chooseModelFromList(provider, models) : "";
  config.default_provider = provider.name;
  if (model) config.default_model = model;
}

async function listModelsFlow(config: Config): Promise<void> {
  const provider = await chooseProvider(config);
  const models = await fetchModels(provider);
  await listModelsPaginated(models);
}

async function selectModelsFlow(config: Config): Promise<void> {
  const provider = await chooseProvider(config);
  const models = await fetchModels(provider);
  const selected = await selectModelsPaginated(models, provider.models || []);
  provider.models = selected;
  console.log(`\nSelected ${selected.length} models for ${provider.name}\n`);
}

async function showUsageFlow(config: Config): Promise<void> {
  const provider = await chooseProvider(config);
  const base = provider.api_base.replace(/\/+$/, "");
  const name = provider.name.toLowerCase();
  console.log(`\nUsage for ${provider.name}:\n`);
  if (name === "openai") {
    console.log(`List models: GET ${base}/models (Authorization: Bearer <API_KEY>)`);
    console.log(`Chat: POST ${base}/chat/completions`);
  } else if (name === "groq") {
    console.log(`List models: GET ${base}/models (Authorization: Bearer <API_KEY>)`);
    console.log(`Chat: POST ${base}/chat/completions`);
  } else if (name === "openrouter") {
    console.log(`List models: GET ${base}/models (Authorization: Bearer <API_KEY>)`);
    console.log(`Chat: POST ${base}/chat/completions (OpenAI-compatible)`);
  } else if (name === "gemini") {
    console.log(`List models: GET ${base}/models?key=<API_KEY>`);
    console.log(`Generate: POST ${base}/models/<model>:generateContent?key=<API_KEY>`);
  } else {
    console.log(`List models: GET ${base}/models`);
  }
  console.log("");
}

async function configureWorkspace(config: Config): Promise<void> {
  const inquirer = await getInquirer();
  const { workspace } = await inquirer.prompt([
    {
      type: "input",
      name: "workspace",
      message: "Workspace path (used for file/shell tools)",
      default: config.workspace
    }
  ]);
  if (workspace && typeof workspace === "string") {
    config.workspace = workspace;
  }
}

async function configureOsAccess(config: Config): Promise<void> {
  const inquirer = await getInquirer();
  const { fullAccess } = await inquirer.prompt([
    {
      type: "confirm",
      name: "fullAccess",
      message: "Allow tools to access the full OS (disable workspace-only sandbox)?",
      default: false
    }
  ]);
  const workspaceOnly = !fullAccess;
  config.tools.shell.workspace_only = workspaceOnly;
  config.tools.file.workspace_only = workspaceOnly;
}

function saveConfig(config: Config): string {
  const path = resolveConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
  return path;
}

export async function runSetupMenu(config: Config): Promise<void> {
  const inquirer = await getInquirer();
  let exit = false;
  while (!exit) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "RippleClaw Setup",
        choices: [
          { name: "Configure API key", value: "key" },
          { name: "List models", value: "models" },
          { name: "Select multiple models", value: "select" },
          { name: "Set default provider/model", value: "default" },
          { name: "Show API usage", value: "usage" },
          { name: "Set workspace path", value: "workspace" },
          { name: "Configure OS access (sandbox)", value: "osaccess" },
          { name: "Save & exit", value: "save" },
          { name: "Exit without saving", value: "exit" }
        ],
        pageSize: 10
      }
    ]);

    try {
      if (action === "key") await configureProviderKey(config);
      if (action === "models") await listModelsFlow(config);
      if (action === "select") await selectModelsFlow(config);
      if (action === "default") await pickDefaultProviderModel(config);
      if (action === "usage") await showUsageFlow(config);
      if (action === "workspace") await configureWorkspace(config);
      if (action === "osaccess") await configureOsAccess(config);
      if (action === "save") {
        const path = saveConfig(config);
        console.log(`\nSaved config to ${path}\n`);
        exit = true;
      }
      if (action === "exit") exit = true;
    } catch (err) {
      console.error(`\n❌ ${err}\n`);
    }
  }
}

export async function ensureApiKeys(config: Config): Promise<void> {
  const activeProviders = config.providers.filter((p) => p.api_key);
  if (activeProviders.length > 0) return;
  console.log("\nNo API keys configured. Opening setup...\n");
  await runSetupMenu(config);
  const savedProviders = config.providers.filter((p) => p.api_key);
  if (savedProviders.length === 0) {
    throw new Error("No API keys configured after setup.");
  }
}
