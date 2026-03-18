import type { MemoryStore, CronJob } from "../core/memory";


let onCronChanged: ((id: string) => void) | null = null;

export function setCronCallback(fn: (id: string) => void) {
  onCronChanged = fn;
}

export function createCronTool(memory: MemoryStore) {
  return {
    definition: {
      name: "cron",
      description:
        "Manage scheduled cron jobs. Use action=list|add|delete|toggle|run (schedule in cron format: * * * * *)",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["list", "add", "delete", "toggle", "run"],
            description: "Action to perform"
          },
          id: { type: "string", description: "Job ID" },
          schedule: { type: "string", description: "Cron schedule (e.g., '0 9 * * *')" },
          prompt: { type: "string", description: "Prompt to execute" },
          enabled: { type: "boolean", description: "Enable/disable job" }
        }
      },
      required: ["action"]
    },

    async execute(args: {
      action: "list" | "add" | "delete" | "toggle" | "run";
      id?: string;
      schedule?: string;
      prompt?: string;
      enabled?: boolean;
    }): Promise<string> {
      if (!args || typeof args !== "object") {
        return 'Error: "action" is required';
      }

      switch (args.action) {
        case "list": {
          const jobs = memory.listCronJobs();
          if (!jobs.length) return "No cron jobs found.";
          const lines = jobs.map((j) => `${j.id}: ${j.schedule}`);
          return `Cron jobs (${jobs.length}):\n${lines.join("\n")}`;
        }

        case "add": {
          if (!args.schedule) return 'Error: "schedule" is required for add';
          if (!args.prompt) return 'Error: "prompt" is required for add';

          const nodeCron = (await import("node-cron")).default;
          if (!nodeCron.validate(args.schedule)) {
            return `Error: Invalid cron schedule "${args.schedule}". Use format: * * * * * (min hour day month weekday)`;
          }

          // Check if prompt looks like a tool result (don't pre-execute tools for cron)
          const toolResultPatterns = [
            /\d+°?C/i, // temperature
            /km\/h/i, // wind speed
            /%\s*(humedad|humidity)/i, // humidity
            /\$.*\d+/i, // prices
            /^\d+\s*(USD|EUR|ARS)/i // currency
          ];

          const looksLikeResult = toolResultPatterns.some((p) => p.test(args.prompt || ""));
          if (looksLikeResult) {
            return `The prompt looks like a result, not a task. To create a cron that executes a task (like checking weather), simply describe the task. Example: "Search weather in London" or "Tell me the time in 1 hour".`;
          }

          // Auto-generate ID if not provided
          const jobId = args.id?.trim() || `cron_${Date.now()}`;

          const job: CronJob = {
            id: jobId,
            schedule: args.schedule.trim(),
            prompt: args.prompt,
            enabled: true
          };

          memory.saveCronJob(job);
          if (onCronChanged) onCronChanged(job.id);
          return `Cron job "${job.id}" created. Will run at ${job.schedule}.`;
        }

        case "delete": {
          if (!args.id) return 'Error: "id" is required for delete';
          const deleted = memory.deleteCronJob(args.id);
          if (deleted && onCronChanged) onCronChanged(args.id);
          return deleted ? `Cron job "${args.id}" deleted.` : `Cron job "${args.id}" not found.`;
        }

        case "toggle": {
          if (!args.id) return 'Error: "id" is required for toggle';
          if (typeof args.enabled !== "boolean")
            return 'Error: "enabled" (boolean) is required for toggle';
          const toggled = memory.toggleCronJob(args.id, args.enabled);
          if (toggled && onCronChanged) onCronChanged(args.id);
          return toggled
            ? `Cron job "${args.id}" ${args.enabled ? "enabled" : "disabled"}.`
            : `Cron job "${args.id}" not found.`;
        }

        case "run": {
          if (!args.id) return 'Error: "id" is required for run';
          const job = memory.getCronJob(args.id);
          if (!job) return `Cron job "${args.id}" not found.`;
          return `To execute job "${args.id}": ${job.prompt}`;
        }

        default:
          return `Error: Unsupported action "${args.action}"`;
      }
    }
  };
}
