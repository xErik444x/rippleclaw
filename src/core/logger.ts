import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import type { AgentContext } from "./agent";
import type { Config } from "./config";

const MAX_FIELD = 2000;

function truncate(value: unknown): unknown {
  if (typeof value === "string" && value.length > MAX_FIELD) {
    return value.slice(0, MAX_FIELD) + "...(truncated)";
  }
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase().includes("key") || k.toLowerCase().includes("token")) {
      out[k] = "***";
    } else if (typeof v === "string") {
      out[k] = truncate(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function resolveLogPath(config: Config): string {
  // Store under workspace by default
  return join(config.workspace, ".rippleclaw", "logs", "tool.log");
}

export function logToolEvent(
  config: Config,
  ctx: AgentContext,
  data: {
    tool: string;
    args: Record<string, unknown>;
    result: string;
    ok: boolean;
  }
) {
  const path = resolveLogPath(config);
  mkdirSync(dirname(path), { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    channel: ctx.channel,
    userId: ctx.userId,
    tool: data.tool,
    args: redactObject(data.args),
    ok: data.ok,
    result: truncate(data.result)
  };
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
}
