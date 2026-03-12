import { promises as fs } from "fs";
import { join, isAbsolute, dirname } from "path";
import type { Config } from "../core/config";
import type { Tool } from "../providers/base";
import { isInsideWorkspace } from "./utils/path";

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
      if (!args || !("action" in args) || !("path" in args)) {
        const resolvedRoot = join(config.workspace, ".");
        if (config.tools.file.workspace_only && !isInsideWorkspace(resolvedRoot, config.workspace)) {
          return 'Error: path "." is outside the workspace';
        }
        try {
          await fs.access(resolvedRoot);
        } catch {
          return "Error: directory not found: .";
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
