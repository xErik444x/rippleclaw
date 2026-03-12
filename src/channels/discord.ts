import type { Agent } from "../core/agent";
import type { Config } from "../core/config";
import type { Client as DiscordClient, Message as DiscordMessage } from "discord.js";

export async function startDiscord(agent: Agent, config: Config) {
  const dsConfig = config.channels.discord;
  if (!dsConfig.enabled || !dsConfig.token) {
    console.log("[Discord] Disabled or no token configured");
    return;
  }

  const discord = (await import("discord.js")) as unknown as {
    Client: typeof import("discord.js").Client;
    GatewayIntentBits?: Record<string, number>;
    Intents?: new (bits: (string | number)[]) => unknown;
  };
  const { Client } = discord;

  type IntentsResolvable = import("discord.js").ClientOptions["intents"];

  const intents = (discord.GatewayIntentBits
    ? [
        discord.GatewayIntentBits.Guilds,
        discord.GatewayIntentBits.GuildMessages,
        discord.GatewayIntentBits.MessageContent,
        discord.GatewayIntentBits.DirectMessages
      ]
    : (["GUILDS", "GUILD_MESSAGES", "DIRECT_MESSAGES"] as unknown)) as IntentsResolvable;

  const client = new Client({ intents });

  const allowAll = dsConfig.allowed_users.includes("*");

  client.once("ready", (c: DiscordClient) => {
    console.log(`[Discord] ✅ Logged in as ${c.user?.tag ?? "unknown"}`);
  });

  client.on("messageCreate", async (message: DiscordMessage) => {
    // Ignore bot messages and messages that don't mention the bot
    if (message.author.bot) return;

    const botMentioned = message.mentions.has(client.user!.id);
    const dmCheck = message.channel as unknown as { isDMBased?: () => boolean; type?: string };
    const isDM = typeof dmCheck.isDMBased === "function" ? dmCheck.isDMBased() : dmCheck.type === "DM";

    if (!botMentioned && !isDM) return;

    const userId = message.author.id;
    const userName = message.author.username;

    // Allowlist check
    if (
      !allowAll &&
      !dsConfig.allowed_users.includes(userId) &&
      !dsConfig.allowed_users.includes(userName)
    ) {
      await message.reply(`⛔ Unauthorized.`);
      return;
    }

    // Strip bot mention from message
    const text = message.content.replace(/<@!?\d+>/g, "").trim();
    if (!text) return;

    console.log(`[Discord] 📨 ${userName}: ${text}`);

    try {
      const typingChannel = message.channel as unknown as { sendTyping?: () => Promise<void> };
      if (typeof typingChannel.sendTyping === "function") {
        await typingChannel.sendTyping();
      }

      const thinkingMsg = await message.reply("🤔 Pensando...");

      try {
        const response = await agent.run(text, {
          channel: "discord",
          userId,
          userName
        });

        try {
          await thinkingMsg.delete();
        } catch {}

        // Discord has 2000 char limit
        if (response.length > 1900) {
          const chunks = response.match(/.{1,1900}/gs) || [];
          for (const chunk of chunks) {
            await message.reply(chunk);
          }
        } else {
          await message.reply(response);
        }
      } catch (err) {
        try {
          await thinkingMsg.delete();
        } catch {}
        throw err;
      }
    } catch (err) {
      console.error("[Discord] Error:", err);
      await message.reply(`❌ Error: ${err}`);
    }
  });

  await client.login(dsConfig.token);
}
