import { spawn } from "child_process";
import type { Config } from "../core/config";
import type { Tool } from "../providers/base";
import { isInsideWorkspace } from "./utils/path";

function getPlatform(): "win32" | "unix" {
  return process.platform === "win32" ? "win32" : "unix";
}

function normalizeShellCommand(command: string): { command: string; normalized: string } {
  const normalized = command.trim();
  if (getPlatform() === "win32") {
    if (normalized === "pwd") return { command: "cd", normalized };
    if (normalized === "ls" || normalized === "ls -la" || normalized === "ls -l" || normalized === "ls -a") {
      return { command: "dir /a", normalized };
    }
  }
  return { command, normalized };
}

function isCommandAllowed(allowed: string[], command: string, normalized: string): boolean {
  if (allowed.length === 0) return true;
  const baseCmd = command.trim().split(/\s+/)[0] || "";
  const baseNormalized = normalized.trim().split(/\s+/)[0] || "";

  const candidates = new Set<string>();
  if (baseCmd) candidates.add(baseCmd);
  if (baseNormalized) candidates.add(baseNormalized);

  if (getPlatform() === "win32") {
    if (normalized === "pwd") {
      candidates.add("pwd");
      candidates.add("cd");
    }
    if (normalized === "ls" || normalized.startsWith("ls ")) {
      candidates.add("ls");
      candidates.add("dir");
    }
  }

  return Array.from(candidates).some((c) => allowed.includes(c));
}

function getSafeCommands(): string[] {
  if (getPlatform() === "win32") {
    return ["tasklist", "wmic", "systeminfo", "whoami", "ver", "ipconfig", "netstat", "type"];
  }
  return ["free", "top", "ps", "grep", "uptime", "uname", "df", "du", "whoami", "id", "cat"];
}

export function createShellTool(config: Config) {
  return {
    definition: {
      name: "shell",
      description:
        "Execute a shell command in the workspace. Detects OS (Windows vs Unix) and normalizes common commands (pwd, ls).",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute" },
          cwd: { type: "string", description: "Working directory (defaults to workspace)" }
        },
        required: ["command"]
      }
    } satisfies Tool,

    async execute(args: { command: string; cwd?: string }): Promise<string> {
      if (!args || typeof args.command !== "string") {
        return 'Error: "command" is required';
      }
      let { command, cwd } = args;
      if (!command.trim()) {
        return 'Error: "command" must be a non-empty string';
      }
      const workdir = cwd || config.workspace;

      if (config.tools.shell.workspace_only && !isInsideWorkspace(workdir, config.workspace)) {
        return `Error: directory "${workdir}" is outside the workspace`;
      }

      const isWin = getPlatform();
      const normalizedRes = normalizeShellCommand(command);
      command = normalizedRes.command;
      const normalizedCmd = normalizedRes.normalized;

      const allowed = config.tools.shell.allowed_commands || [];
      const safeAllow = getSafeCommands();
      const combinedAllowed = allowed.length > 0 ? [...allowed, ...safeAllow] : allowed;
      const baseCmd = command.trim().split(/\s+/)[0] || "";
      if (!isCommandAllowed(combinedAllowed, command, normalizedCmd)) {
        return `Error: command "${baseCmd}" is not in allowed_commands`;
      }

      const forbidden = ["rm -rf /", ":(){ :|:& };:", "sudo", "su "];
      if (forbidden.some((f) => command.includes(f))) {
        return "Error: command is forbidden for safety reasons";
      }

      if (isWin === "win32" && normalizedCmd === "pwd") {
        return workdir;
      }

      const shellCmd = isWin === "win32" ? "cmd.exe" : "bash";
      const shellArgs = isWin === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
      const maxBuffer = 1024 * 1024;

      const output = await new Promise<string>((resolveOutput) => {
        const child = spawn(shellCmd, shellArgs, {
          cwd: workdir,
          stdio: ["ignore", "pipe", "pipe"]
        });

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
        }, 30000);

        child.stdout?.on("data", (chunk) => onData(chunk as Buffer, "stdout"));
        child.stderr?.on("data", (chunk) => onData(chunk as Buffer, "stderr"));

        child.on("error", (err) => {
          clearTimeout(timeout);
          resolveOutput(`Error: ${err.message}`);
        });

        child.on("close", (code) => {
          clearTimeout(timeout);
          if (exceeded) {
            resolveOutput("Error: command output exceeded max buffer");
            return;
          }
          const out = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
          resolveOutput(out || `(exit code: ${code ?? 0})`);
        });
      });

      let finalOut = output;
      if (isWin === "win32" && normalizedCmd === "pwd") {
        finalOut = output.replace(/\//g, "\\");
      }
      return finalOut;
    }
  };
}
