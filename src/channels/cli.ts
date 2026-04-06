import type { Agent } from "../core/agent";
import type { Config } from "../core/config";
import * as readline from "readline";
import { runSetupMenu } from "./cli-setup";

export async function startCLI(agent: Agent, config: Config) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\n🌊 You: "
  });

  console.log(`
╭─────────────────────────────────╮
│  🌊 RippleClaw CLI              │
│  Type your message and press ↵  │
│  Ctrl+C to exit                 │
╰─────────────────────────────────╯`);

  const ctx = { channel: "cli", userId: process.env.USER || process.env.USERNAME || "local" };

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "/exit" || input === "/quit") {
      console.log("👋 Goodbye!");
      process.exit(0);
    }

    if (input === "/clear") {
      console.clear();
      rl.prompt();
      return;
    }

    if (input === "/help") {
      console.log("Commands: /clear, /exit, /quit, /setup, /restart, /version");
      rl.prompt();
      return;
    }

    if (input === "/version") {
      console.log("🌊 RippleClaw: Checking version...");
      try {
        const versionResult = await agent.run("version check", ctx);
        console.log(`🌊 RippleClaw: ${versionResult.content}`);
      } catch (error) {
        console.error(`❌ Error checking version: ${error}`);
      }
      rl.prompt();
      return;
    }

    try {
      if (input === "/setup") {
        await runSetupMenu(config);
        rl.prompt();
        return;
      }
      if (input === "/restart") {
        try {
          const { execSync } = await import("child_process");
          execSync("systemctl restart rippleclaw", { stdio: "inherit" });
          console.log("\n✅ Service restarted.");
        } catch (err) {
          console.error(`\n❌ Could not restart service: ${err}`);
        }
        rl.prompt();
        return;
      }
      process.stdout.write("\n🌊 RippleClaw: thinking...\r");
      const response = await agent.run(input, ctx);
      process.stdout.clearLine(0);
      console.log(`\n🌊 RippleClaw: ${response.content}`);
    } catch (err) {
      console.error(`\n❌ Error: ${err}`);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    console.log("\n👋 Goodbye!");
    process.exit(0);
  });
}
