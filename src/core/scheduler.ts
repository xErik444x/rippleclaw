import type { Agent } from "./agent";
import type { Config } from "./config";
import type { MemoryStore } from "./memory";
import { getLastTelegramChatId } from "../channels/telegram";

interface ScheduledTask {
  stop: () => void;
}

let _nodeCron: {
  schedule: (expr: string, func: () => void | Promise<void>) => ScheduledTask;
  validate: (expr: string) => boolean;
} | null = null;

let _agent: Agent;
let _memory: MemoryStore;
let _telegramBot: {
  sendMessage: (chatId: number, text: string) => Promise<unknown>;
} | null = null;
const scheduledTasks = new Map<string, ScheduledTask>();

export async function startScheduler(agent: Agent, config: Config, memory: MemoryStore) {
  _agent = agent;
  _memory = memory;

  if (!config.cron.enabled) {
    console.log("[Scheduler] Disabled in config");
    return;
  }

  const nodeCronImport = (await import("node-cron")) as unknown as {
    default: {
      schedule: (expr: string, func: () => void | Promise<void>) => ScheduledTask;
      validate: (expr: string) => boolean;
    };
  };
  _nodeCron = nodeCronImport.default;

  const jobs = _memory.listCronJobs();
  console.log(`[Scheduler] Loading ${jobs.length} cron jobs`);

  for (const job of jobs) {
    if (!job.enabled) {
      console.log(`[Scheduler] Skipping disabled job "${job.id}"`);
      continue;
    }

    if (!_nodeCron.validate(job.schedule)) {
      console.warn(`[Scheduler] Invalid cron for "${job.id}": ${job.schedule}`);
      continue;
    }

    registerJob(job.id, job.schedule, job.prompt);
  }

  console.log("[Scheduler] Started");
}

export function setTelegramBot(bot: {
  sendMessage: (chatId: number, text: string) => Promise<unknown>;
}) {
  _telegramBot = bot;
}

async function sendCronMessage(message: string) {
  const chatId = getLastTelegramChatId();
  if (_telegramBot && chatId) {
    try {
      await _telegramBot.sendMessage(chatId, message);
      console.log(`[Scheduler] Sent cron message to chat ${chatId}`);
    } catch (err) {
      console.error("[Scheduler] Failed to send cron message:", err);
    }
  } else {
    console.log(
      `[Scheduler] No telegram bot/chat available, skipping message: ${message.slice(0, 50)}...`
    );
  }
}

function registerJob(id: string, schedule: string, prompt: string) {
  if (scheduledTasks.has(id)) {
    console.log(`[Scheduler] Job "${id}" already registered`);
    return;
  }

  if (!_nodeCron) {
    console.error("[Scheduler] node-cron not initialized");
    return;
  }

  const task = _nodeCron.schedule(schedule, async () => {
    console.log(`[Scheduler] Running job "${id}": ${prompt.slice(0, 50)}...`);
    try {
      const cronPrompt = `[CRON JOB] ${prompt}\n\nResponde solo con el resultado directo, sin saludos ni despedidas.`;
      const result = await _agent.run(cronPrompt, {
        channel: "cron",
        userId: `cron:${id}`
      });
      console.log(`[Scheduler] Job "${id}" done: ${result.content.slice(0, 100)}...`);

      sendCronMessage(result.content);
    } catch (err) {
      console.error(`[Scheduler] Job "${id}" failed:`, err);
    }
  });

  scheduledTasks.set(id, task);
  console.log(`[Scheduler] Registered job "${id}" @ ${schedule}`);
}

export async function onCronJobChanged(id: string) {
  if (!_agent || !_memory) return;

  if (scheduledTasks.has(id)) {
    const task = scheduledTasks.get(id);
    if (task) task.stop();
    scheduledTasks.delete(id);
    console.log(`[Scheduler] Cleared job "${id}"`);
  }

  const job = _memory.getCronJob(id);
  if (!job) {
    console.log(`[Scheduler] Job "${id}" not found in memory`);
    return;
  }

  if (!job.enabled) {
    console.log(`[Scheduler] Job "${id}" is disabled`);
    return;
  }

  if (!_nodeCron) {
    console.error("[Scheduler] node-cron not initialized");
    return;
  }

  if (!_nodeCron.validate(job.schedule)) {
    console.warn(`[Scheduler] Invalid cron for "${id}": ${job.schedule}`);
    return;
  }

  registerJob(job.id, job.schedule, job.prompt);
}
