import { createDefaultConfig, loadConfig, resolveConfigPath } from "./core/config";
import type { EmailProvider } from "./core/config";
import { createMemory } from "./core/memory";
import { Agent } from "./core/agent";
import { startTelegram } from "./channels/telegram";
import { startDiscord } from "./channels/discord";
import { startScheduler, onCronJobChanged } from "./core/scheduler";
import { setCronCallback } from "./tools/cron";
import { cleanupOldLogs, startLogTail } from "./core/log-tail";
import { EmailSender } from "./core/email";

let runSetupMenu: typeof import("./channels/cli-setup").runSetupMenu | null = null;
let startCLI: typeof import("./channels/cli").startCLI | null = null;
let promptStartupMenu: typeof import("./channels/startup-menu").promptStartupMenu | null = null;
let ensureApiKeys: typeof import("./channels/cli-setup").ensureApiKeys | null = null;

async function loadInteractiveDeps() {
  if (!runSetupMenu) {
    const mod = await import("./channels/cli-setup");
    runSetupMenu = mod.runSetupMenu;
    ensureApiKeys = mod.ensureApiKeys;
  }
  if (!startCLI) {
    startCLI = (await import("./channels/cli")).startCLI;
  }
  if (!promptStartupMenu) {
    promptStartupMenu = (await import("./channels/startup-menu")).promptStartupMenu;
  }
}

const VERSION = "0.1.0";

const args = process.argv.slice(2);
const isEmailCommand = args[0] === "email" && args[1] === "send";
const flags = {
  cli: args.includes("--channel") && args[args.indexOf("--channel") + 1] === "cli",
  help: args.includes("--help") || args.includes("-h"),
  version: args.includes("--version") || args.includes("-v"),
  menu: args.includes("--menu"),
  channel: args.includes("--channel") ? args[args.indexOf("--channel") + 1] : null
};

if (flags.help) {
  console.log(`
🌊 RippleClaw v${VERSION}
Fast, autonomous AI agent for low-power devices

Usage:
  node dist/daemon.js [options]

Options:
  --channel cli       Start in CLI mode only
  --channel telegram  Start Telegram channel only
  --channel discord   Start Discord channel only
  --menu              Show startup menu
  --version           Show version
  --help              Show this help

Without --channel, starts all enabled channels as daemon.

Config: config.json (local) or ~/.rippleclaw/config.json
  `);
  process.exit(0);
}

if (flags.version) {
  console.log(`RippleClaw v${VERSION}`);
  process.exit(0);
}

async function main() {
  console.log(`\n🌊 RippleClaw v${VERSION} starting...\n`);

  // Load config
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    const msg = String(err);
    if (msg.includes("ENOENT") && process.stdin.isTTY) {
      console.log("⚠️ No config found. Opening setup menu...\n");
      config = createDefaultConfig();
      await loadInteractiveDeps();
      await runSetupMenu!(config);
      try {
        config = loadConfig();
      } catch {
        console.error("❌ Setup finished without saving a config.");
        console.error(`Expected config at: ${resolveConfigPath()}`);
        process.exit(1);
      }
    } else {
      console.error("❌ Failed to load config:", err);
      console.error(`Expected config at: ${resolveConfigPath()}`);
      console.error("Make sure config.json exists or run setup.");
      process.exit(1);
    }
  }
  console.log(`✅ Config: ${resolveConfigPath()}`);

  // Validate at least one provider has an API key (CLI can bootstrap)
  const activeProviders = config.providers.filter((p) => p.api_key);
  const canBootstrap = flags.channel === "cli" || (!flags.channel && config.channels.cli.enabled);
  if (activeProviders.length === 0) {
    if (canBootstrap) {
      await loadInteractiveDeps();
      await ensureApiKeys!(config);
    } else {
      console.error(
        "❌ No providers configured with API keys. Edit config.json and add your keys."
      );
      process.exit(1);
    }
  }

  const activeProvidersAfter = config.providers.filter((p) => p.api_key);
  if (activeProvidersAfter.length === 0) {
    console.error("❌ No providers configured with API keys after setup.");
    process.exit(1);
  }
  console.log(`✅ Providers: ${activeProvidersAfter.map((p) => p.name).join(", ")}`);
  console.log(`✅ Default: ${config.default_provider} / ${config.default_model}`);

  // Init memory
  const memory = createMemory(config);
  console.log(`✅ Memory: ${config.memory.backend} at ${config.memory.path}`);

  // Cleanup old logs (>1d)
  await cleanupOldLogs(config);

  // Init agent
  const emailSender = new EmailSender(config);
  const agent = new Agent(config, memory, emailSender);

  // Decide startup mode
  let channelFilter = flags.channel;
  if (!channelFilter && flags.menu && process.stdin.isTTY) {
    await loadInteractiveDeps();
    const choice = await promptStartupMenu!();
    if (choice === "exit") process.exit(0);
    if (choice === "cli") channelFilter = "cli";
    if (choice === "telegram") channelFilter = "telegram";
    if (choice === "discord") channelFilter = "discord";
    if (choice === "daemon") channelFilter = null;
  }

  if (channelFilter === "cli") {
    if (config.channels.cli.enabled || channelFilter === "cli") {
      await loadInteractiveDeps();
      await startCLI!(agent, config);
      return; // CLI is interactive, blocks here
    }
  }

  // Daemon mode: start all enabled channels
  const startups: Promise<void>[] = [];

  if (!channelFilter || channelFilter === "telegram") {
    startups.push(startTelegram(agent, config));
  }

  if (!channelFilter || channelFilter === "discord") {
    startups.push(startDiscord(agent, config));
  }

  startups.push(startScheduler(agent, config, memory));

  await Promise.all(startups);

  // Connect telegram bot to scheduler for cron messages
  if (config.channels.telegram.enabled) {
    const { getTelegramBot } = await import("./channels/telegram");
    const bot = getTelegramBot();
    if (bot) {
      const { setTelegramBot } = await import("./core/scheduler");
      setTelegramBot(bot);
      console.log("[Scheduler] Telegram bot connected for cron messages");
    }
  }

  // Connect cron tool callback to scheduler
  setCronCallback((id: string) => {
    onCronJobChanged(id);
  });

  console.log("\n🌊 RippleClaw daemon running. Ctrl+C to stop.\n");
  startLogTail(config);

  // Keep alive
  process.on("SIGINT", () => {
    console.log("\n👋 RippleClaw shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n👋 RippleClaw shutting down...");
    process.exit(0);
  });
}

type EmailSendCommand = {
  to: string[];
  subject?: string;
  body?: string;
  body_type?: "plain" | "html";
  provider?: EmailProvider;
  dry_run: boolean;
};

function parseEmailArgs(rawArgs: string[]): EmailSendCommand {
  const result: EmailSendCommand = { to: [], dry_run: false };

  for (let i = 0; i < rawArgs.length; ) {
    const arg = rawArgs[i];
    switch (arg) {
      case "--dry-run":
        result.dry_run = true;
        i += 1;
        break;
      case "--to": {
        i += 1;
        if (i >= rawArgs.length) throw new Error("--to requires a value");
        result.to.push(rawArgs[i]);
        i += 1;
        break;
      }
      case "--subject": {
        i += 1;
        if (i >= rawArgs.length) throw new Error("--subject requires a value");
        result.subject = rawArgs[i];
        i += 1;
        break;
      }
      case "--body": {
        i += 1;
        if (i >= rawArgs.length) throw new Error("--body requires a value");
        result.body = rawArgs[i];
        i += 1;
        break;
      }
      case "--body-type": {
        i += 1;
        if (i >= rawArgs.length) throw new Error("--body-type requires a value");
        result.body_type = rawArgs[i] === "html" ? "html" : "plain";
        i += 1;
        break;
      }
      case "--provider": {
        i += 1;
        if (i >= rawArgs.length) throw new Error("--provider requires a value");
        const value = rawArgs[i].toLowerCase();
        if (value !== "smtp" && value !== "api") {
          throw new Error("--provider must be smtp or api");
        }
        result.provider = value as EmailProvider;
        i += 1;
        break;
      }
      default:
        throw new Error(`Unexpected argument '${arg}'`);
    }
  }

  return result;
}

async function runEmailCommand(rawArgs: string[]) {
  let values: EmailSendCommand;
  try {
    values = parseEmailArgs(rawArgs);
  } catch (err) {
    console.error("Error parsing command:", err instanceof Error ? err.message : err);
    process.exit(1);
    return;
  }

  const recipients = values.to.map((entry) => String(entry).trim()).filter((v) => v.length > 0);

  if (!recipients.length) {
    console.error("Error: --to is required");
    process.exit(1);
  }

  const subject = typeof values.subject === "string" ? values.subject.trim() : "";
  if (!subject) {
    console.error("Error: --subject is required");
    process.exit(1);
  }

  const body = typeof values.body === "string" ? values.body : "";
  if (!body) {
    console.error("Error: --body is required");
    process.exit(1);
  }

  const provider = typeof values.provider === "string" ? values.provider : undefined;
  const bodyType = values.body_type === "html" ? "html" : "plain";
  const dryRun = Boolean(values.dry_run);

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error("Failed to load config for email command:", err);
    process.exit(1);
  }

  const sender = new EmailSender(config);
  const result = await sender.send({
    to: recipients,
    subject,
    body,
    body_type: bodyType,
    provider,
    dry_run: dryRun
  });

  if (result.success) {
    console.log(dryRun ? "Email preparado en seco" : "Email enviado");
    process.exit(0);
  }

  console.error(`Email error: ${result.error ?? "UNKNOWN"}`);
  process.exit(1);
}

if (isEmailCommand) {
  runEmailCommand(args.slice(2)).catch((err) => {
    console.error("Email command failed:", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
