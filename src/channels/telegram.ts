import type { Agent } from "../core/agent";
import type { Config } from "../core/config";

export async function startTelegram(agent: Agent, config: Config) {
  const tgConfig = config.channels.telegram;
  if (!tgConfig.enabled || !tgConfig.token) {
    console.log("[Telegram] Disabled or no token configured");
    return;
  }

  // Dynamic import to avoid loading if disabled
  const TelegramBot = (await import("node-telegram-bot-api")).default;
  const bot = new TelegramBot(tgConfig.token, { polling: true });

  // Register bot commands with autocomplete
  await bot.setMyCommands([
    { command: "start", description: "Iniciar el bot" },
    { command: "help", description: "Mostrar ayuda" },
    { command: "newsession", description: "Reiniciar sesión/olvidar contexto" },
    { command: "status", description: "Ver estado actual" },
    { command: "compress", description: "Comprimir contexto" }
  ]);

  const allowAll = tgConfig.allowed_users.includes("*");

  console.log("[Telegram] ✅ Bot started, polling...");

  bot.on("message", async (msg) => {
    const text = msg.text;
    if (!text) return;

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

    console.log(`[Telegram] 📨 ${userName}: ${text}`);

    try {
      // Send "typing..." indicator and a temporary thinking message
      await bot.sendChatAction(msg.chat.id, "typing");
      const thinkingMsg = await bot.sendMessage(msg.chat.id, "🤔 Pensando...");

      try {
        const response = await agent.run(text, {
          channel: "telegram",
          userId,
          userName
        });

        // Remove thinking message before sending response
        await bot.deleteMessage(msg.chat.id, thinkingMsg.message_id);
        await bot.sendMessage(msg.chat.id, response);
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

  bot.on("polling_error", (err) => {
    console.error("[Telegram] Polling error:", err);
  });
}
