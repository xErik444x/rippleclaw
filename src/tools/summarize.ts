import { spawn } from "child_process";
import type { Config } from "../core/config";
import type { Tool } from "../providers/base";

export function createSummarizeTool(config: Config) {
  let attemptedInstall = false;

  const runSummarize = async (cmdArgs: string[]): Promise<string> => {
    const maxBuffer = 1024 * 1024;
    const timeoutMs = 120000;

    return new Promise<string>((resolveOutput) => {
      const child = spawn("summarize", cmdArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let exceeded = false;

      const onData = (chunk: Buffer, target: "stdout" | "stderr") => {
        const text = chunk.toString("utf-8");
        if (target === "stdout") stdout += text;
        else stderr += text;
        if (stdout.length + stderr.length > maxBuffer) {
          exceeded = true;
          child.kill();
        }
      };

      const timeout = setTimeout(() => {
        child.kill();
      }, timeoutMs);

      child.stdout?.on("data", (chunk) => onData(chunk as Buffer, "stdout"));
      child.stderr?.on("data", (chunk) => onData(chunk as Buffer, "stderr"));

      child.on("error", (err) => {
        clearTimeout(timeout);
        resolveOutput(`Error: ${err.message}`);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (exceeded) {
          resolveOutput("Error: summarize output exceeded max buffer");
          return;
        }
        const out = stdout.trim();
        if (out) {
          resolveOutput(out);
          return;
        }
        resolveOutput(stderr.trim() || `(exit code: ${code ?? 0})`);
      });
    });
  };

  const tryInstallSummarize = async (): Promise<string | null> => {
    if (!config.tools.summarize?.auto_install || attemptedInstall) return null;
    attemptedInstall = true;

    const installCmd = config.tools.summarize?.install_command || "npm i -g @steipete/summarize";
    const parts = installCmd.split(/\s+/).filter(Boolean);
    const cmd = parts[0];
    const args = parts.slice(1);
    if (!cmd) return "Error: summarize install_command is empty";

    const maxBuffer = 512 * 1024;
    const timeoutMs = 180000;

    return new Promise<string>((resolveOutput) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let exceeded = false;

      const onData = (chunk: Buffer, target: "stdout" | "stderr") => {
        const text = chunk.toString("utf-8");
        if (target === "stdout") stdout += text;
        else stderr += text;
        if (stdout.length + stderr.length > maxBuffer) {
          exceeded = true;
          child.kill();
        }
      };

      const timeout = setTimeout(() => {
        child.kill();
      }, timeoutMs);

      child.stdout?.on("data", (chunk) => onData(chunk as Buffer, "stdout"));
      child.stderr?.on("data", (chunk) => onData(chunk as Buffer, "stderr"));

      child.on("error", (err) => {
        clearTimeout(timeout);
        resolveOutput(`Error: ${err.message}`);
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        if (exceeded) {
          resolveOutput("Error: install output exceeded max buffer");
          return;
        }
        const out = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
        if (code === 0) {
          resolveOutput("ok");
          return;
        }
        resolveOutput(out || `(exit code: ${code ?? 0})`);
      });
    });
  };

  return {
    definition: {
      name: "summarize",
      description: "Summarize a URL, local file, or YouTube link using the summarize CLI (summarize.sh).",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "URL, YouTube link, or local file path" },
          model: { type: "string", description: "Optional model override (e.g. google/gemini-3-flash-preview)" },
          length: {
            type: "string",
            enum: ["short", "medium", "long", "xl", "xxl"],
            description: "Optional summary length"
          },
          extract_only: { type: "boolean", description: "Extract transcript/text only (URLs only)" },
          youtube: { type: "string", description: "YouTube mode (e.g. auto)" },
          json: { type: "boolean", description: "Return JSON output" }
        },
        required: ["target"]
      }
    } satisfies Tool,

    async execute(args: {
      target: string;
      model?: string;
      length?: "short" | "medium" | "long" | "xl" | "xxl";
      extract_only?: boolean;
      youtube?: string;
      json?: boolean;
    }): Promise<string> {
      if (!config.tools.summarize?.enabled) {
        return "Error: summarize tool is disabled in config.tools.summarize.enabled";
      }
      if (!args || typeof args.target !== "string" || !args.target.trim()) {
        return 'Error: "target" is required';
      }

      const cmdArgs: string[] = [args.target];
      const model = args.model || config.tools.summarize?.default_model;
      const length = args.length || config.tools.summarize?.default_length;

      if (model) {
        cmdArgs.push("--model", model);
      }
      if (length) {
        cmdArgs.push("--length", length);
      }
      if (args.youtube) {
        cmdArgs.push("--youtube", args.youtube);
      }
      if (args.extract_only) {
        cmdArgs.push("--extract-only");
      }
      if (args.json) {
        cmdArgs.push("--json");
      }

      const first = await runSummarize(cmdArgs);
      if (!first.startsWith("Error: spawn summarize") && !/ENOENT/i.test(first)) {
        return first;
      }

      const installResult = await tryInstallSummarize();
      if (installResult && installResult !== "ok") {
        return `Error: summarize not installed and auto-install failed.\n${installResult}`;
      }
      if (!installResult) {
        return "Error: summarize not installed. Enable tools.summarize.auto_install or install it manually.";
      }

      const second = await runSummarize(cmdArgs);
      return second;
    }
  };
}
