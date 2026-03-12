const { createInterface } = require("readline");
const { appendFileSync, mkdirSync, readFileSync, statSync, existsSync } = require("fs");
const { dirname, join, resolve } = require("path");

function parseArgs(argv) {
  const args = {
    channel: "cli",
    userId: process.env.USER || process.env.USERNAME || "local",
    noLog: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--channel" && next) {
      args.channel = next;
      i++;
      continue;
    }
    if (arg === "--user" && next) {
      args.userId = next;
      i++;
      continue;
    }
    if (arg === "--input" && next) {
      args.input = next;
      i++;
      continue;
    }
    if (arg === "--prompt" && next) {
      args.prompt = next;
      i++;
      continue;
    }
    if (arg === "--no-log") {
      args.noLog = true;
    }
  }

  return args;
}

function resolveLogPath(workspace) {
  return join(workspace, ".rippleclaw", "logs", "debug-chat.log");
}

function logLine(path, entry) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
}

function readScriptLines(filePath) {
  const text = readFileSync(filePath, "utf-8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const distRoot = resolve(__dirname, "..", "dist");

  if (!existsSync(distRoot)) {
    console.error(`Missing dist/. Run "npm run build" first.`);
    process.exit(1);
  }

  const { Agent } = require(join(distRoot, "core", "agent.js"));
  const { loadConfig } = require(join(distRoot, "core", "config.js"));
  const { createMemory } = require(join(distRoot, "core", "memory.js"));

  const config = loadConfig();
  const memory = createMemory(config);
  const agent = new Agent(config, memory);

  const ctx = { channel: args.channel, userId: args.userId };
  const logPath = resolveLogPath(resolve(config.workspace));

  const log = (role, content) => {
    if (args.noLog) return;
    logLine(logPath, {
      ts: new Date().toISOString(),
      channel: ctx.channel,
      userId: ctx.userId,
      role,
      content
    });
  };

  const runOne = async (input) => agent.run(input, ctx);

  if (args.prompt) {
    log("user", args.prompt);
    try {
      const response = await runOne(args.prompt);
      log("assistant", response);
      console.log(response);
    } catch (err) {
      const msg = String(err);
      log("error", msg);
      console.error(msg);
      process.exitCode = 1;
    }
    return;
  }

  if (args.input) {
    const inputPath = resolve(args.input);
    if (!statSync(inputPath).isFile()) {
      console.error(`Input file not found: ${args.input}`);
      process.exit(1);
    }
    const lines = readScriptLines(inputPath);
    for (const line of lines) {
      log("user", line);
      try {
        const response = await runOne(line);
        log("assistant", response);
        console.log(`You: ${line}`);
        console.log(`RippleClaw: ${response}`);
      } catch (err) {
        const msg = String(err);
        log("error", msg);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
        break;
      }
    }
    return;
  }

  if (!process.stdin.isTTY) {
    const stdin = readFileSync(0, "utf-8");
    const lines = stdin
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line);
    for (const line of lines) {
      log("user", line);
      try {
        const response = await runOne(line);
        log("assistant", response);
        console.log(`You: ${line}`);
        console.log(`RippleClaw: ${response}`);
      } catch (err) {
        const msg = String(err);
        log("error", msg);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
        break;
      }
    }
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\n🧪 You: "
  });

  console.log(`\nDebug Chat`);
  console.log(`- channel: ${ctx.channel}`);
  console.log(`- userId: ${ctx.userId}`);
  console.log(`- log: ${args.noLog ? "disabled" : logPath}`);
  console.log(`Commands: /exit, /quit, /ctx, /log`);

  rl.prompt();
  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "/exit" || input === "/quit") {
      rl.close();
      return;
    }
    if (input === "/ctx") {
      console.log(`channel=${ctx.channel} userId=${ctx.userId}`);
      rl.prompt();
      return;
    }
    if (input === "/log") {
      console.log(args.noLog ? "log disabled" : logPath);
      rl.prompt();
      return;
    }

    log("user", input);
    try {
      process.stdout.write("\n🧪 RippleClaw: thinking...\r");
      const response = await runOne(input);
      process.stdout.clearLine(0);
      log("assistant", response);
      console.log(`\n🧪 RippleClaw: ${response}`);
    } catch (err) {
      const msg = String(err);
      log("error", msg);
      console.error(`\n❌ Error: ${msg}`);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\n👋 Goodbye!");
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
