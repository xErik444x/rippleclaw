import type { Config } from "../core/config";
import type { Tool } from "../providers/base";

type WebResult = { title: string; url: string; snippet?: string };

const WEB_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SEARCH_TIMEOUT_MS = 10_000;
const PERPLEXITY_TIMEOUT_MS = 30_000;

const reTags = /<[^>]+>/g;
const reDDGLink = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
const reDDGSnippet = /<a class="result__snippet[^"]*".*?>([\s\S]*?)<\/a>/gi;

function stripTags(content: string): string {
  return content.replace(reTags, "");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function formatResults(query: string, providerLabel: string, items: WebResult[], count: number): string {
  if (!items.length) return `No results for: ${query}`;
  const lines: string[] = [];
  lines.push(`Results for: ${query}${providerLabel ? ` (${providerLabel})` : ""}`);
  items.slice(0, count).forEach((item, i) => {
    lines.push(`${i + 1}. ${item.title}`);
    lines.push(`   ${item.url}`);
    if (item.snippet) lines.push(`   ${item.snippet}`);
  });
  return lines.join("\n");
}

async function searchBrave(query: string, count: number, apiKey: string): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetchWithTimeout(
    url,
    { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } },
    SEARCH_TIMEOUT_MS
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Brave API error (${res.status}): ${body}`);
  }
  const data = JSON.parse(body) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  const results =
    data.web?.results
      ?.filter((r) => r.title && r.url)
      .map((r) => ({ title: r.title!, url: r.url!, snippet: r.description })) || [];
  return formatResults(query, "via Brave", results, count);
}

async function searchTavily(query: string, count: number, apiKey: string, baseURL?: string): Promise<string> {
  const url = baseURL && baseURL.trim() ? baseURL : "https://api.tavily.com/search";
  const payload = {
    api_key: apiKey,
    query,
    search_depth: "advanced",
    include_answer: false,
    include_images: false,
    include_raw_content: false,
    max_results: count
  };
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": WEB_USER_AGENT },
      body: JSON.stringify(payload)
    },
    SEARCH_TIMEOUT_MS
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Tavily API error (${res.status}): ${body}`);
  }
  const data = JSON.parse(body) as { results?: { title?: string; url?: string; content?: string }[] };
  const results =
    data.results
      ?.filter((r) => r.title && r.url)
      .map((r) => ({ title: r.title!, url: r.url!, snippet: r.content })) || [];
  return formatResults(query, "via Tavily", results, count);
}

async function searchDuckDuckGoHtml(query: string, count: number): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": WEB_USER_AGENT } }, SEARCH_TIMEOUT_MS);
  const html = await res.text();

  const linkMatches = Array.from(html.matchAll(reDDGLink));
  if (linkMatches.length === 0) {
    return `No results found or extraction failed. Query: ${query}`;
  }
  const snippetMatches = Array.from(html.matchAll(reDDGSnippet));
  const results: WebResult[] = [];
  const maxItems = Math.min(linkMatches.length, count);

  for (let i = 0; i < maxItems; i++) {
    let urlStr = linkMatches[i][1];
    let title = stripTags(linkMatches[i][2]).trim();

    if (urlStr.includes("uddg=")) {
      try {
        const decoded = decodeURIComponent(urlStr);
        const idx = decoded.indexOf("uddg=");
        if (idx !== -1) urlStr = decoded.slice(idx + 5);
      } catch {
        // ignore
      }
    }

    const snippet = i < snippetMatches.length ? stripTags(snippetMatches[i][1]).trim() : "";
    results.push({ title, url: urlStr, snippet: snippet || undefined });
  }

  return formatResults(query, "via DuckDuckGo", results, count);
}

async function searchPerplexity(query: string, count: number, apiKey: string): Promise<string> {
  const url = "https://api.perplexity.ai/chat/completions";
  const payload = {
    model: "sonar",
    messages: [
      {
        role: "system",
        content:
          "You are a search assistant. Provide concise search results with titles, URLs, and brief descriptions in the following format:\n1. Title\n   URL\n   Description\n\nDo not add extra commentary."
      },
      {
        role: "user",
        content: `Search for: ${query}. Provide up to ${count} relevant results.`
      }
    ],
    max_tokens: 1000
  };
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": WEB_USER_AGENT
      },
      body: JSON.stringify(payload)
    },
    PERPLEXITY_TIMEOUT_MS
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Perplexity API error (${res.status}): ${body}`);
  }
  const data = JSON.parse(body) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return `No results for: ${query}`;
  return `Results for: ${query} (via Perplexity)\n${content}`;
}

async function searchSearxng(query: string, count: number, baseURL: string): Promise<string> {
  const url = `${baseURL.replace(/\/+$/, "")}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
  const res = await fetchWithTimeout(url, {}, SEARCH_TIMEOUT_MS);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`SearXNG returned status ${res.status}`);
  }
  const data = JSON.parse(body) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  const results =
    data.results
      ?.filter((r) => r.title && r.url)
      .slice(0, count)
      .map((r) => ({ title: r.title!, url: r.url!, snippet: r.content })) || [];
  return formatResults(query, "via SearXNG", results, count);
}

async function searchGLM(query: string, count: number, apiKey: string, baseURL?: string, engine?: string): Promise<string> {
  const url = baseURL && baseURL.trim() ? baseURL : "https://open.bigmodel.cn/api/paas/v4/web_search";
  const payload = {
    search_query: query,
    search_engine: engine && engine.trim() ? engine : "search_std",
    search_intent: false,
    count,
    content_size: "medium"
  };
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload)
    },
    SEARCH_TIMEOUT_MS
  );
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`GLM Search API error (${res.status}): ${body}`);
  }
  const data = JSON.parse(body) as {
    search_result?: { title?: string; link?: string; content?: string }[];
  };
  const results =
    data.search_result
      ?.filter((r) => r.title && r.link)
      .map((r) => ({ title: r.title!, url: r.link!, snippet: r.content })) || [];
  return formatResults(query, "via GLM Search", results, count);
}

function normalizeCount(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(num)) return fallback;
  return Math.min(10, Math.max(1, Math.floor(num)));
}

function toKeyList(value?: string | string[]): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createWebTool(config: Config) {
  return {
    definition: {
      name: "web_search",
      description:
        "Search the web for up-to-date information. Returns a short list of results with titles, URLs, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          count: { type: "number", description: "Number of results (1-10)", default: 5 },
          max_results: { type: "number", description: "Alias for count (1-10)", default: 5 }
        },
        required: ["query"]
      }
    } satisfies Tool,

    async execute(args: { query: string; count?: number; max_results?: number }): Promise<string> {
      if (!config.tools.web?.enabled) {
        return "Error: web tool is disabled in config.tools.web.enabled";
      }
      if (!args || typeof args.query !== "string" || !args.query.trim()) {
        return 'Error: "query" is required';
      }
      const count = normalizeCount(args.count ?? args.max_results, config.tools.web?.max_results ?? 5);

      const explicitProvider = config.tools.web?.provider;
      const providers = config.tools.web?.providers;

      const braveKeys =
        toKeyList(providers?.brave?.api_keys) || toKeyList(config.tools.web?.api_key || process.env.RIPPLECLAW_BRAVE_KEY);
      const tavilyKeys = toKeyList(providers?.tavily?.api_keys);
      const perplexityKeys = toKeyList(providers?.perplexity?.api_keys);
      const glmKey = providers?.glm?.api_key;

      try {
        if (explicitProvider === "perplexity" && perplexityKeys.length) {
          for (const key of perplexityKeys) {
            try {
              return await searchPerplexity(args.query, count, key);
            } catch (err) {
              if (!/429|401|403|5\d\d/.test(String(err))) return `Error: ${err}`;
            }
          }
        }
        if (explicitProvider === "brave" && braveKeys.length) {
          for (const key of braveKeys) {
            try {
              return await searchBrave(args.query, count, key);
            } catch (err) {
              if (!/429|401|403|5\d\d/.test(String(err))) return `Error: ${err}`;
            }
          }
        }
        if (explicitProvider === "searxng" && providers?.searxng?.base_url) {
          return await searchSearxng(args.query, count, providers.searxng.base_url);
        }
        if (explicitProvider === "tavily" && tavilyKeys.length) {
          for (const key of tavilyKeys) {
            try {
              return await searchTavily(args.query, count, key, providers?.tavily?.base_url);
            } catch (err) {
              if (!/429|401|403|5\d\d/.test(String(err))) return `Error: ${err}`;
            }
          }
        }
        if (explicitProvider === "glm" && glmKey) {
          return await searchGLM(args.query, count, glmKey, providers?.glm?.base_url, providers?.glm?.search_engine);
        }
        if (explicitProvider === "duckduckgo") {
          return await searchDuckDuckGoHtml(args.query, count);
        }
      } catch (err) {
        return `Error: ${String(err)}`;
      }

      if (providers?.perplexity?.enabled && perplexityKeys.length) {
        for (const key of perplexityKeys) {
          try {
            return await searchPerplexity(args.query, count, key);
          } catch (err) {
            if (!/429|401|403|5\d\d/.test(String(err))) return `Error: ${err}`;
          }
        }
      }
      if (providers?.brave?.enabled && braveKeys.length) {
        for (const key of braveKeys) {
          try {
            return await searchBrave(args.query, count, key);
          } catch (err) {
            if (!/429|401|403|5\d\d/.test(String(err))) return `Error: ${err}`;
          }
        }
      }
      if (providers?.searxng?.enabled && providers?.searxng?.base_url) {
        try {
          return await searchSearxng(args.query, count, providers.searxng.base_url);
        } catch (err) {
          return `Error: ${String(err)}`;
        }
      }
      if (providers?.tavily?.enabled && tavilyKeys.length) {
        for (const key of tavilyKeys) {
          try {
            return await searchTavily(args.query, count, key, providers?.tavily?.base_url);
          } catch (err) {
            if (!/429|401|403|5\d\d/.test(String(err))) return `Error: ${err}`;
          }
        }
      }
      if (providers?.duckduckgo?.enabled ?? true) {
        try {
          return await searchDuckDuckGoHtml(args.query, count);
        } catch (err) {
          return `Error: ${String(err)}`;
        }
      }
      if (providers?.glm?.enabled && glmKey) {
        try {
          return await searchGLM(args.query, count, glmKey, providers?.glm?.base_url, providers?.glm?.search_engine);
        } catch (err) {
          return `Error: ${String(err)}`;
        }
      }

      return "Error: no web search provider configured.";
    }
  };
}
