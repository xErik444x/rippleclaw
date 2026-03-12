import type { Agent } from "./agent";
import type { Config } from "./config";
import type { MemoryStore } from "./memory";

interface ScheduledTask {
  stop: () => void;
}

let _agent: Agent;
let _memory: MemoryStore;
const scheduledTasks = new Map<string, ScheduledTask>();

export async function startScheduler(agent: Agent, config: Config, memory: MemoryStore) {
  _agent = agent;
  _memory = memory;

  if (!config.cron.enabled) {
    console.log("[Scheduler] Disabled in config");
    return;
  }

  const nodeCron = (await import("node-cron")) as unknown as {
    default: {
      schedule: (expr: string, func: () => void | Promise<void>) => ScheduledTask;
      validate: (expr: string) => boolean;
    };
  };

  const jobs = memory.listCronJobs();
  console.log(`[Scheduler] Loading ${jobs.length} cron jobs`);

  for (const job of jobs) {
    if (!job.enabled) {
      console.log(`[Scheduler] Skipping disabled job "${job.id}"`);
      continue;
    }

    if (!nodeCron.default.validate(job.schedule)) {
      console.warn(`[Scheduler] Invalid cron for "${job.id}": ${job.schedule}`);
      continue;
    }

    registerJob(job.id, job.schedule, job.prompt);
  }

  console.log("[Scheduler] Started");
}

function registerJob(id: string, schedule: string, prompt: string) {
  if (scheduledTasks.has(id)) {
    console.log(`[Scheduler] Job "${id}" already registered`);
    return;
  }

  const nodeCron = require("node-cron") as {
    schedule: (expr: string, func: () => void | Promise<void>) => ScheduledTask;
    validate: (expr: string) => boolean;
  };

  const task = nodeCron.schedule(schedule, async () => {
    console.log(`[Scheduler] Running job "${id}": ${prompt.slice(0, 50)}...`);
    try {
      const result = await _agent.run(prompt, {
        channel: "cron",
        userId: `cron:${id}`
      });
      console.log(`[Scheduler] Job "${id}" done: ${result.slice(0, 100)}...`);
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

  const nodeCron = require("node-cron") as {
    validate: (expr: string) => boolean;
  };

  if (!nodeCron.validate(job.schedule)) {
    console.warn(`[Scheduler] Invalid cron for "${id}": ${job.schedule}`);
    return;
  }

  registerJob(job.id, job.schedule, job.prompt);
}
