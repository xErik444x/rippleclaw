import { spawn } from "child_process";
import { promises as fs } from "fs";
import { join, resolve, relative, isAbsolute, dirname } from "path";
import type { Config } from "../core/config";
import type { Tool } from "../providers/base";

function isInsideWorkspace(filePath: string, workspace: string): boolean {
  const resolved = resolve(filePath);
  const resolvedWorkspace = resolve(workspace);
  const rel = relative(resolvedWorkspace, resolved);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

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

      // Security: check workspace_only
      if (config.tools.shell.workspace_only && !isInsideWorkspace(workdir, config.workspace)) {
        return `Error: directory "${workdir}" is outside the workspace`;
      }

      const isWin = getPlatform() === "win32";
      const normalizedRes = normalizeShellCommand(command);
      command = normalizedRes.command;
      const normalizedCmd = normalizedRes.normalized;

      // Security: check allowed commands
      const allowed = config.tools.shell.allowed_commands || [];
      const safeAllow = getSafeCommands();
      const combinedAllowed = allowed.length > 0 ? [...allowed, ...safeAllow] : allowed;
      const baseCmd = command.trim().split(/\s+/)[0] || "";
      if (!isCommandAllowed(combinedAllowed, command, normalizedCmd)) {
        return `Error: command "${baseCmd}" is not in allowed_commands`;
      }

      // Security: basic forbidden patterns
      const forbidden = ["rm -rf /", ":(){ :|:& };:", "sudo", "su "];
      if (forbidden.some((f) => command.includes(f))) {
        return `Error: command is forbidden for safety reasons`;
      }

      if (isWin && normalizedCmd === "pwd") {
        return workdir;
      }

      const shellCmd = isWin ? "cmd.exe" : "bash";
      const shellArgs = isWin ? ["/d", "/s", "/c", command] : ["-c", command];
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
      if (isWin && normalizedCmd === "pwd") {
        finalOut = output.replace(/\//g, "\\");
      }
      return finalOut;
    }
  };
}

export function createFileTool(config: Config) {
  return {
    definition: {
      name: "file",
      description: "Read or write files in the workspace",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["read", "write", "list"],
            description: "Action to perform"
          },
          path: { type: "string", description: "File path (relative to workspace or absolute)" },
          content: { type: "string", description: "Content to write (only for write action)" }
        },
        required: ["action", "path"]
      }
    } satisfies Tool,

    async execute(args: {
      action: "read" | "write" | "list";
      path: string;
      content?: string;
    }): Promise<string> {
      if (!args || typeof args !== "object") {
        return 'Error: "action" and "path" are required';
      }
      // Default behavior: if no args provided, list workspace root
      if (!args || !("action" in args) || !("path" in args)) {
        const resolvedRoot = join(config.workspace, ".");
        if (config.tools.file.workspace_only && !isInsideWorkspace(resolvedRoot, config.workspace)) {
          return `Error: path "." is outside the workspace`;
        }
        try {
          await fs.access(resolvedRoot);
        } catch {
          return `Error: directory not found: .`;
        }
        const entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n");
      }

      const { action, path: filePath, content } = args;
      if (typeof filePath !== "string" || !filePath.trim()) {
        return 'Error: "path" must be a non-empty string';
      }
      const resolved = isAbsolute(filePath) ? filePath : join(config.workspace, filePath);

      if (config.tools.file.workspace_only && !isInsideWorkspace(resolved, config.workspace)) {
        return `Error: path "${filePath}" is outside the workspace`;
      }

      switch (action) {
        case "read": {
          try {
            await fs.access(resolved);
          } catch {
            return `Error: file not found: ${filePath}`;
          }
          const text = await fs.readFile(resolved, "utf-8");
          return text.length > 8000 ? text.slice(0, 8000) + "\n...(truncated)" : text;
        }
        case "write": {
          if (content === undefined) return "Error: content is required for write action";
          await fs.mkdir(dirname(resolved), { recursive: true });
          await fs.writeFile(resolved, content, "utf-8");
          return `Written ${content.length} bytes to ${filePath}`;
        }
        case "list": {
          try {
            await fs.access(resolved);
          } catch {
            return `Error: directory not found: ${filePath}`;
          }
          const entries = await fs.readdir(resolved, { withFileTypes: true });
          return entries.map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n");
        }
        default:
          return `Error: unknown action "${action}"`;
      }
    }
  };
}

export function createMemoryTool(memory: import("../core/memory").MemoryStore) {
  return {
    definition: {
      name: "remember",
      description: "Save or retrieve a note from persistent memory",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["save", "get"], description: "save or get a note" },
          key: { type: "string", description: "Note key/name" },
          value: { type: "string", description: "Note value (only for save)" }
        },
        required: ["action", "key"]
      }
    } satisfies Tool,

    async execute(args: { action: "save" | "get"; key: string; value?: string }): Promise<string> {
      if (!args || typeof args !== "object") {
        return 'Error: "action" and "key" are required';
      }
      if (typeof args.key !== "string" || !args.key.trim()) {
        return 'Error: "key" must be a non-empty string';
      }
      if (args.action === "save") {
        if (args.value === undefined) return "Error: value required for save";
        memory.saveNote(args.key, args.value);
        return `Guardé esto en memoria, será útil a futuro. (key: "${args.key}")`;
      }
      const val = memory.getNote(args.key);
      return val ? `Note "${args.key}": ${val}` : `No note found for "${args.key}"`;
    }
  };
}

export function createEnvTool(config: Config) {
  return {
    definition: {
      name: "env",
      description: "Return runtime environment info (os, cwd, workspace).",
      parameters: {
        type: "object",
        properties: {
          include: {
            type: "array",
            items: { type: "string", enum: ["os", "cwd", "workspace"] },
            description: "Optional subset of fields to return"
          }
        }
      }
    } satisfies Tool,

    async execute(args: { include?: ("os" | "cwd" | "workspace")[] }): Promise<string> {
      const include = args.include && args.include.length > 0 ? args.include : ["os", "cwd", "workspace"];
      const os =
        process.platform === "win32"
          ? "Windows"
          : process.platform === "darwin"
            ? "macOS"
            : "Linux";
      const entries: string[] = [];
      if (include.includes("os")) entries.push(`os=${os}`);
      if (include.includes("cwd")) entries.push(`cwd=${process.cwd()}`);
      if (include.includes("workspace")) entries.push(`workspace=${config.workspace}`);
      return entries.join("\n");
    }
  };
}

export function createModelTool(config: Config) {
  return {
    definition: {
      name: "model",
      description: "Change the current default provider/model for this session",
      parameters: {
        type: "object",
        properties: {
          provider: { type: "string", description: "Provider name (optional)" },
          model: { type: "string", description: "Model id" }
        },
        required: ["model"]
      }
    } satisfies Tool,

    async execute(args: { provider?: string; model: string }): Promise<string> {
      const providerName = args.provider || config.default_provider;
      const provider = config.providers.find((p) => p.name === providerName);
      if (!provider) return `Error: provider "${providerName}" not found`;

      if (provider.models && provider.models.length > 0 && !provider.models.includes(args.model)) {
        return `Error: model "${args.model}" not in provider models list`;
      }

      config.default_provider = providerName;
      config.default_model = args.model;
      return `Modelo por defecto actualizado: ${providerName} / ${args.model} (solo sesión)`;
    }
  };
}
