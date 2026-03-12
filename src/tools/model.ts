import type { Config } from "../core/config";
import type { Tool } from "../providers/base";

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
