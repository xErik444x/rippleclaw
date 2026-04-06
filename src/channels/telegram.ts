import type { Agent } from "../core/agent";
import type { Config } from "../core/config";
import type { MemoryStore } from "../core/memory";
import { updateConfig } from "../core/config";
import type TelegramBot from "node-telegram-bot-api";
import type { InlineKeyboardMarkup, SendMessageOptions } from "node-telegram-bot-api";
import { createVersionTool } from "../tools/version";

let lastChatId: number | null = null;
let telegramBotInstance: TelegramBot | null = null;

const pendingEdits = new Map<number, string>(); // chatId -> configPath

async function sendSafeMessage(
  bot: TelegramBot,
  chatId: number,
  text: string,
  options: SendMessageOptions = {}
): Promise<TelegramBot.Message> {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (err: any) {
    if (err.message && err.message.toLowerCase().includes("parse")) {
      console.warn(`[Telegram] Markdown parse error. Falling back to plain text.`);
      const safeOptions = { ...options };
      delete safeOptions.parse_mode;
      return await bot.sendMessage(chatId, text, safeOptions);
    }
    throw err;
  }
}

function renderConfigMenu(
  config: Config,
  path: string = ""
): { text: string; reply_markup: InlineKeyboardMarkup } {
  const parts = path ? path.split(".") : [];
  let current: unknown = config;
  for (const p of parts) {
    if (p.includes("[") && p.includes("]")) {
      const baseKey = p.split("[")[0];
      const index = parseInt(p.split("[")[1].split("]")[0]);
      const arr = (current as Record<string, unknown>)[baseKey] as unknown[];
      current = arr[index];
    } else {
      current = (current as Record<string, unknown>)[p];
    }
  }

  const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
  let text = `⚙️ *Configuration: ${path || "Root"}*\n\n`;

  if (typeof current === "object" && current !== null && !Array.isArray(current)) {
    const obj = current as Record<string, unknown>;
    const keys = Object.keys(obj).filter(
      (k) => !k.startsWith("_") && k !== "api_key" && k !== "token" && k !== "password"
    );

    // Sort keys: primitives first, then objects
    const sortedKeys = keys.sort((a, b) => {
      const typeA = typeof obj[a];
      const typeB = typeof obj[b];
      if (typeA !== "object" && typeB === "object") return -1;
      if (typeA === "object" && typeB !== "object") return 1;
      return a.localeCompare(b);
    });

    for (const key of sortedKeys) {
      const val = obj[key];
      const fullPath = path ? `${path}.${key}` : key;
      const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");

      if (typeof val === "boolean") {
        keyboard.push([
          {
            text: `${val ? "✅" : "❌"} ${label}`,
            callback_data: `config:${fullPath}:toggle`
          }
        ]);
      } else if (typeof val === "string" || typeof val === "number") {
        // Truncate long strings
        const displayVal =
          typeof val === "string" && val.length > 20 ? val.slice(0, 17) + "..." : val;
        keyboard.push([
          {
            text: `${label}: ${displayVal}`,
            callback_data: `config:${fullPath}:edit`
          }
        ]);
      } else if (typeof val === "object" && val !== null) {
        keyboard.push([
          {
            text: `📂 ${label}`,
            callback_data: `config:${fullPath}`
          }
        ]);
      }
    }
  } else if (Array.isArray(current)) {
    text += "_(Item list)_\n";
    current.forEach((item: Record<string, unknown>, index: number) => {
      const fullPath = `${path}[${index}]`;
      const name = (item.name as string) || (item.id as string) || `Item ${index}`;
      keyboard.push([
        {
          text: `🔹 ${name}`,
          callback_data: `config:${fullPath}`
        }
      ]);
    });
  }

  // Back button
  if (path) {
    const parentPath = parts.slice(0, -1).join(".");
    keyboard.push([{ text: "⬅️ Back", callback_data: `config:${parentPath}` }]);
  }

  return {
    text,
    reply_markup: { inline_keyboard: keyboard }
  };
}

export function getLastTelegramChatId(): number | null {
  return lastChatId;
}

export function getTelegramBot() {
  return telegramBotInstance;
}

export async function startTelegram(agent: Agent, config: Config, memory?: MemoryStore) {
  const tgConfig = config.channels.telegram;
  if (!tgConfig.enabled || !tgConfig.token) {
    console.log("[Telegram] Disabled or no token configured");
    return;
  }

  // Dynamic import to avoid loading if disabled
  const TelegramBot = (await import("node-telegram-bot-api")).default;
  const bot = new TelegramBot(tgConfig.token, { polling: true });
  telegramBotInstance = bot;

  // Register bot commands with autocomplete
  await bot.setMyCommands([
    { command: "start", description: "Start the bot" },
    { command: "help", description: "Show help" },
    { command: "newsession", description: "Restart session/forget context" },
    { command: "status", description: "View current status" },
    { command: "compress", description: "Compress context" },
    { command: "version", description: "Check version information" }
  ]);

  const allowAll = tgConfig.allowed_users.includes("*");

  console.log("[Telegram] ✅ Bot started, polling...");

  bot.on("message", async (msg) => {
    // Save chatId for cron messages
    lastChatId = msg.chat.id;

    const text = msg.text;
    if (!text) return;

    // Handle /version command directly
    if (text.toLowerCase().startsWith("/version")) {
      const userId = String(msg.from?.id || "unknown");
      const userName = msg.from?.username || msg.from?.first_name || userId;

      // Check if user is allowed
      if (
        !allowAll &&
        !tgConfig.allowed_users.includes(userId) &&
        !tgConfig.allowed_users.includes(userName)
      ) {
        await bot.sendMessage(
          msg.chat.id,
          `⛔ Unauthorized. Ask the operator to run:\nrippleclaw channel allow-telegram ${userId}`
        );
        return;
      }

      console.log(`[Telegram] 📨 ${userName}: ${text}`);

      try {
        await bot.sendChatAction(msg.chat.id, "typing");
        const thinkingMsg = await bot.sendMessage(msg.chat.id, "🤔 Checking version...");

        // Use version tool directly
        let versionContent = "";
        if (memory) {
          const versionTool = createVersionTool(memory, config);
          versionContent = await versionTool.execute({ action: "check" });
        } else {
          // Fallback to agent.run if no memory
          const versionResult = await agent.run("version check", {
            channel: "telegram",
            userId,
            userName
          });
          versionContent = versionResult.content;
        }

        await bot.editMessageText(versionContent, {
          chat_id: msg.chat.id,
          message_id: thinkingMsg.message_id,
          parse_mode: "Markdown"
        });
      } catch (error) {
        console.error("[Telegram] Error handling /version:", error);
        await bot.sendMessage(msg.chat.id, "❌ Error checking version. Please try again.");
      }
      return;
    }

    const userId = String(msg.from?.id || "unknown");
    const userName = msg.from?.username || msg.from?.first_name || userId;

    // Allowlist check
    if (
      !allowAll &&
      !tgConfig.allowed_users.includes(userId) &&
      !tgConfig.allowed_users.includes(userName)
    ) {
      await bot.sendMessage(
        msg.chat.id,
        `⛔ Unauthorized. Ask the operator to run:\nrippleclaw channel allow-telegram ${userId}`
      );
      return;
    }

    // Handle pending config edits
    if (pendingEdits.has(msg.chat.id)) {
      const path = pendingEdits.get(msg.chat.id)!;
      pendingEdits.delete(msg.chat.id);
      try {
        updateConfig(config, path, text);
        const parentPath = path.split(".").slice(0, -1).join(".");
        const menu = renderConfigMenu(config, parentPath);
        await bot.sendMessage(msg.chat.id, `✅ Updated: *${path}* to \`${text}\`\n\n${menu.text}`, {
          parse_mode: "Markdown",
          reply_markup: menu.reply_markup
        });
      } catch (err) {
        await bot.sendMessage(msg.chat.id, `❌ Error updating: ${err}`);
      }
      return;
    }

    console.log(`[Telegram] 📨 ${userName}: ${text}`);

    try {
      // Send "typing..." indicator and a temporary thinking message
      await bot.sendChatAction(msg.chat.id, "typing");
      const thinkingMsg = await bot.sendMessage(msg.chat.id, "🤔 Thinking...");

      try {
        const response = await agent.run(text, {
          channel: "telegram",
          userId,
          userName
        });

        // Remove thinking message before sending response
        await bot.deleteMessage(msg.chat.id, thinkingMsg.message_id);

        const options: SendMessageOptions = { parse_mode: "Markdown" };
        if (response.metadata?.telegram?.reply_markup) {
          options.reply_markup = response.metadata.telegram.reply_markup as any;
        }

        await sendSafeMessage(bot, msg.chat.id, response.content, options);
      } catch (err) {
        try {
          await bot.deleteMessage(msg.chat.id, thinkingMsg.message_id);
        } catch {}
        throw err;
      }
    } catch (err) {
      console.error("[Telegram] Error:", err);
      await bot.sendMessage(msg.chat.id, `❌ Error: ${err}`);
    }
  });

  bot.on("callback_query", async (query) => {
    if (!query.message || !query.data) return;

    const userId = String(query.from.id);
    const userName = query.from.username || query.from.first_name || userId;

    console.log(`[Telegram] 🔘 Callback (${userName}): ${query.data}`);

    try {
      // Logic for config menu actions
      if (query.data.startsWith("config")) {
        const parts = query.data.split(":");
        const path = parts[1] || "";
        const action = parts[2];

        if (action === "toggle") {
          // Toggle boolean value
          const keys = path.split(".");
          let current: unknown = config;
          for (let i = 0; i < keys.length - 1; i++)
            current = (current as Record<string, unknown>)[keys[i]];
          const lastKey = keys[keys.length - 1];
          const currentObj = current as Record<string, unknown>;
          const newVal = !currentObj[lastKey];
          updateConfig(config, path, newVal);
          await bot.answerCallbackQuery(query.id, { text: `✅ ${path} = ${newVal}` });

          const menu = renderConfigMenu(config, path.split(".").slice(0, -1).join("."));
          await bot.editMessageText(menu.text, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: menu.reply_markup
          });
          return;
        } else if (action === "edit") {
          // Initiate manual edit
          pendingEdits.set(query.message.chat.id, path);
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(query.message.chat.id, `⌨️ Send the new value for *${path}*:`, {
            parse_mode: "Markdown"
          });
          return;
        } else {
          // Just navigate to path
          await bot.answerCallbackQuery(query.id);
          const menu = renderConfigMenu(config, path);
          await bot.editMessageText(menu.text, {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: menu.reply_markup
          });
          return;
        }
      }

      // Logic for common callback actions
      let text = "";
      if (query.data === "newsession") {
        text = "/newsession";
      } else if (query.data === "compress") {
        text = "/compress";
      } else if (query.data === "edit_config") {
        await bot.answerCallbackQuery(query.id);
        const menu = renderConfigMenu(config, "");
        await bot.sendMessage(query.message.chat.id, menu.text, {
          parse_mode: "Markdown",
          reply_markup: menu.reply_markup
        });
        return;
      } else if (query.data === "status") {
        text = "/status";
      } else {
        await bot.answerCallbackQuery(query.id, { text: "Action not recognized" });
        return;
      }

      await bot.answerCallbackQuery(query.id);

      // Simulate a user message for the agent
      await bot.sendChatAction(query.message.chat.id, "typing");
      const response = await agent.run(text, {
        channel: "telegram",
        userId,
        userName
      });

      const options: SendMessageOptions = { parse_mode: "Markdown" };
      if (response.metadata?.telegram?.reply_markup) {
        options.reply_markup = response.metadata.telegram.reply_markup as any;
      }

      await sendSafeMessage(bot, query.message.chat.id, response.content, options);
    } catch (err) {
      console.error("[Telegram] Callback error:", err);
      await bot.sendMessage(query.message.chat.id, `❌ Action error: ${err}`);
    }
  });

  bot.on("polling_error", (err) => {
    console.error("[Telegram] Polling error:", err);
  });
}
