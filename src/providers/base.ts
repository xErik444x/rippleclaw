import type { Config, ProviderConfig } from "../core/config";

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  provider: string;
  tokens?: { prompt: number; completion: number };
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

async function chatOpenAICompat(
  provider: ProviderConfig,
  model: string,
  messages: Message[],
  tools?: Tool[]
): Promise<ChatResponse> {
  const body: Record<string, unknown> = { model, messages };
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
    body.tool_choice = "auto";
  }

  const res = await fetch(`${provider.api_base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.api_key}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Provider ${provider.name} error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    choices: {
      message: {
        content: string;
        tool_calls?: { function: { name: string; arguments: string } }[];
      };
    }[];
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const msg = data.choices[0].message;

  // Handle tool calls
  if (msg.tool_calls?.length) {
    const safeParse = (value: string): Record<string, unknown> => {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch {
        return { _raw: value };
      }
    };
    return {
      content: `__tool_call__:${JSON.stringify(
        msg.tool_calls.map((tc) => ({
          name: tc.function.name,
          arguments: safeParse(tc.function.arguments)
        }))
      )}`,
      model: data.model,
      provider: provider.name,
      tokens: data.usage
        ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens }
        : undefined
    };
  }

  return {
    content: msg.content || "",
    model: data.model,
    provider: provider.name,
    tokens: data.usage
      ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens }
      : undefined
  };
}

async function chatGemini(
  provider: ProviderConfig,
  model: string,
  messages: Message[]
): Promise<ChatResponse> {
  // Convert to Gemini format
  const systemMsg = messages.find((m) => m.role === "system");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

  const body: Record<string, unknown> = { contents };
  if (systemMsg) body.system_instruction = { parts: [{ text: systemMsg.content }] };

  const cleanModel = model.replace("gemini/", "");
  const url = `${provider.api_base}/models/${cleanModel}:generateContent?key=${provider.api_key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err}`);
  }

  const data = (await res.json()) as {
    candidates: { content: { parts: { text: string }[] } }[];
  };

  return {
    content: data.candidates[0].content.parts[0].text,
    model: cleanModel,
    provider: provider.name
  };
}

export async function chat(
  config: Config,
  messages: Message[],
  options?: { provider?: string; model?: string; tools?: Tool[] }
): Promise<ChatResponse> {
  const providerName = options?.provider || config.default_provider;
  const provider = config.providers.find((p) => p.name === providerName);
  if (!provider) throw new Error(`Provider "${providerName}" not found`);

  const model = options?.model || config.default_model || provider.models[0];

  if (provider.name === "gemini") {
    return chatGemini(provider, model, messages);
  }

  return chatOpenAICompat(provider, model, messages, options?.tools);
}

export function parseToolCalls(content: string): ToolCall[] | null {
  const trimmed = content.trim();

  if (trimmed.startsWith("__tool_call__:")) {
    try {
      return JSON.parse(trimmed.replace("__tool_call__:", "")) as ToolCall[];
    } catch {
      return null;
    }
  }

  // Handle XML-ish toolcall wrappers or partial toolcall text
  if (trimmed.includes("TOOLCALL") || trimmed.includes("arguments")) {
    const start = trimmed.indexOf("<TOOLCALL>");
    const end = trimmed.indexOf("</TOOLCALL>");
    let inner = "";
    if (start !== -1 && end !== -1 && end > start) {
      inner = trimmed.slice(start + "<TOOLCALL>".length, end).trim();
    } else {
      // Fallback: try to extract JSON object from the content
      const firstBrace = trimmed.indexOf("{");
      const lastBrace = trimmed.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        inner = trimmed.slice(firstBrace, lastBrace + 1).trim();
      }
    }

    if (!inner && trimmed.includes("arguments")) {
      // Try to salvage a tool call from partial text
      // Example: arguments": {"action": "save", "value": "Ripple", "key": "nickname"}}]</TOOLCALL>
      const argsIdx = trimmed.indexOf("\"arguments\"");
      if (argsIdx !== -1) {
        const braceStart = trimmed.indexOf("{", argsIdx);
        const braceEnd = trimmed.lastIndexOf("}");
        if (braceStart !== -1 && braceEnd !== -1 && braceEnd > braceStart) {
          const argsJson = trimmed.slice(braceStart, braceEnd + 1);
          // Default to remember tool if name is missing
          inner = JSON.stringify({ name: "remember", arguments: JSON.parse(argsJson) });
        }
      }
    }

    if (inner) {
      try {
        const parsed = JSON.parse(inner) as ToolCall | ToolCall[];
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === "object" && "name" in parsed && "arguments" in parsed) {
          return [parsed as ToolCall];
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}
