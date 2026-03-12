import { existsSync, readFileSync, statSync, createReadStream } from "fs";
import { promises as fsp } from "fs";
import { join, resolve } from "path";
import type { Config } from "./config";

type TailOptions = {
  file?: string;
  label?: string;
  initialLines?: number;
  intervalMs?: number;
};

function lastLines(text: string, count: number): string {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  return lines.slice(Math.max(0, lines.length - count)).join("\n");
}

export function resolveToolLogPath(config: Config): string {
  return join(resolve(config.workspace), ".rippleclaw", "logs", "tool.log");
}

export async function cleanupOldLogs(config: Config, maxAgeMs = 24 * 60 * 60 * 1000) {
  const dir = join(resolve(config.workspace), ".rippleclaw", "logs");
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const full = join(dir, e.name);
          const stat = await fsp.stat(full);
          if (now - stat.mtimeMs > maxAgeMs) {
            await fsp.unlink(full);
          }
        })
    );
  } catch {
    // ignore cleanup errors
  }
}

export function startLogTail(config: Config, options: TailOptions = {}) {
  const path = options.file || resolveToolLogPath(config);
  const label = options.label || "tool.log";
  const initialLines = options.initialLines ?? 200;
  const intervalMs = options.intervalMs ?? 1000;

  console.log(`\n📄 Tailing ${label}: ${path}`);
  let lastSize = 0;

  if (existsSync(path)) {
    const text = readFileSync(path, "utf-8");
    const tail = lastLines(text, initialLines);
    if (tail) console.log(tail);
    lastSize = statSync(path).size;
  } else {
    console.log("(log file not found yet)");
  }

  setInterval(() => {
    if (!existsSync(path)) return;
    const stat = statSync(path);
    if (stat.size <= lastSize) return;

    const stream = createReadStream(path, {
      start: lastSize,
      end: stat.size - 1,
      encoding: "utf-8"
    });

    let data = "";
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => {
      lastSize = stat.size;
      const cleaned = data.trim();
      if (cleaned) console.log(cleaned);
    });
  }, intervalMs);
}
