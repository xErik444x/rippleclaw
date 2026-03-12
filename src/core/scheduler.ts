import type { Agent } from "../core/agent";
import type { Config } from "../core/config";

export async function startScheduler(agent: Agent, config: Config) {
  if (!config.cron.enabled || config.cron.jobs.length === 0) {
    console.log("[Scheduler] No cron jobs configured");
    return;
  }

  const cron = await import("node-cron");

  for (const job of config.cron.jobs) {
    if (!cron.validate(job.schedule)) {
      console.warn(`[Scheduler] Invalid cron expression for job "${job.id}": ${job.schedule}`);
      continue;
    }

    cron.schedule(job.schedule, async () => {
      console.log(`[Scheduler] 🕐 Running job "${job.id}": ${job.prompt}`);
      try {
        const result = await agent.run(job.prompt, {
          channel: "cron",
          userId: `cron:${job.id}`
        });
        console.log(`[Scheduler] ✅ Job "${job.id}" done: ${result.slice(0, 100)}...`);
      } catch (err) {
        console.error(`[Scheduler] ❌ Job "${job.id}" failed:`, err);
      }
    });

    console.log(`[Scheduler] ✅ Registered job "${job.id}" @ ${job.schedule}`);
  }
}
