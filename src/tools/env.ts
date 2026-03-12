import type { Config } from "../core/config";
import type { Tool } from "../providers/base";

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
