import type { Config } from "../core/config";
import { updateConfig } from "../core/config";
import type { Tool } from "../providers/base";

export function createEnvTool(config: Config) {
  return {
    definition: {
      name: "env",
      description: "Manage runtime environment and configuration. Can get or set values.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["get", "set"],
            description: "Action to perform: 'get' to read info, 'set' to update configuration or env vars."
          },
          include: {
            type: "array",
            items: { type: "string", enum: ["os", "cwd", "workspace", "config"] },
            description: "For 'get' action: subset of fields to return. 'config' returns the full JSON config."
          },
          path: {
            type: "string",
            description: "For 'set' action: Dot-notation path to the config key (e.g., 'default_model', 'tools.web.provider', 'providers[0].api_key') or 'process.env.KEY' for environment variables."
          },
          value: {
            description: "For 'set' action: The new value to set. Can be a string, number, boolean, object, or array."
          }
        },
        required: ["action"]
      }
    } satisfies Tool,

    async execute(args: {
      action: "get" | "set";
      include?: ("os" | "cwd" | "workspace" | "config")[];
      path?: string;
      value?: unknown;
    }): Promise<string> {
      if (args.action === "get") {
        const include =
          args.include && args.include.length > 0
            ? args.include
            : ["os", "cwd", "workspace"];
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
        if (include.includes("config")) {
          const safeConfig = { ...config } as Record<string, unknown>;
          delete safeConfig._path;
          entries.push(`config=${JSON.stringify(safeConfig, null, 2)}`);
        }
        return entries.join("\n");
      }

      if (args.action === "set") {
        if (!args.path) return "Error: 'path' is required for 'set' action.";
        if (args.value === undefined) return "Error: 'value' is required for 'set' action.";

        if (args.path.startsWith("process.env.")) {
          const envKey = args.path.replace("process.env.", "");
          process.env[envKey] = String(args.value);
          return `Environment variable ${envKey} set to ${args.value}`;
        }

        try {
          updateConfig(config, args.path, args.value);
          return `Configuration '${args.path}' updated to ${JSON.stringify(args.value)}. Persistence successful.`;
        } catch (err) {
          return `Error updating config: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      return "Invalid action.";
    }
  };
}
