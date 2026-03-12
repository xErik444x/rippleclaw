import { loadConfig } from "./core/config";
import { createMemory } from "./core/memory";
import { Agent } from "./core/agent";
import { ensureApiKeys } from "./channels/cli-setup";
import { startCLI } from "./channels/cli";
import { startTelegram } from "./channels/telegram";
import { startDiscord } from "./channels/discord";
import { startScheduler } from "./core/scheduler";
import { promptStartupMenu } from "./channels/startup-menu";
import { startLogTail } from "./core/log-tail";

const VERSION = "0.1.0";

const args = process.argv.slice(2);
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
    console.error("❌ Failed to load config:", err);
    console.error("Make sure config.json exists or run: rippleclaw onboard");
    process.exit(1);
  }

  // Validate at least one provider has an API key (CLI can bootstrap)
  const activeProviders = config.providers.filter((p) => p.api_key);
  const canBootstrap =
    flags.channel === "cli" || (!flags.channel && config.channels.cli.enabled);
  if (activeProviders.length === 0) {
    if (canBootstrap) {
      await ensureApiKeys(config);
    } else {
      console.error("❌ No providers configured with API keys. Edit config.json and add your keys.");
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

  // Init agent
  const agent = new Agent(config, memory);

  // Decide startup mode
  let channelFilter = flags.channel;
  if (!channelFilter && flags.menu && process.stdin.isTTY) {
    const choice = await promptStartupMenu();
    if (choice === "exit") process.exit(0);
    if (choice === "cli") channelFilter = "cli";
    if (choice === "telegram") channelFilter = "telegram";
    if (choice === "discord") channelFilter = "discord";
    if (choice === "daemon") channelFilter = null;
  }

  if (channelFilter === "cli") {
    if (config.channels.cli.enabled || channelFilter === "cli") {
      await startCLI(agent, config);
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

  startups.push(startScheduler(agent, config));

  await Promise.all(startups);

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

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
