import type { MemoryStore } from "../core/memory";
import type { Config } from "../core/config";
import { readFileSync, existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  body?: string;
}

interface VersionCheckResult {
  current: string;
  latest: string;
  isUpdateAvailable: boolean;
  releaseNotes?: string;
  publishedAt?: string;
  htmlUrl?: string;
}

const DEFAULT_VERSION = "1.8";

function getCurrentVersion(): string {
  const searchPaths = [
    resolve(process.cwd(), "package.json"),
    resolve(dirname(process.execPath), "package.json"),
    resolve(homedir(), ".rippleclaw", "package.json"),
    join(__dirname, "..", "package.json"),
    join(__dirname, "..", "..", "package.json")
  ];

  for (const packagePath of searchPaths) {
    try {
      if (existsSync(packagePath)) {
        const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
        if (pkg.version) return pkg.version;
      }
    } catch {}
  }

  return DEFAULT_VERSION;
}

export function createVersionTool(memory: MemoryStore, config: Config) {
  const VERSION_CHECK_KEY = "version_check";
  const CURRENT_VERSION = getCurrentVersion();

  async function checkGitHubReleases(): Promise<VersionCheckResult> {
    try {
      const response = await fetch("https://api.github.com/repos/xErik444x/rippleclaw/releases");

      if (!response.ok) {
        throw new Error(`GitHub API responded with status: ${response.status}`);
      }

      const releases: GitHubRelease[] = await response.json();

      if (!releases || releases.length === 0) {
        return {
          current: CURRENT_VERSION,
          latest: CURRENT_VERSION,
          isUpdateAvailable: false
        };
      }

      // Ordenar por fecha de publicación (más reciente primero)
      const sortedReleases = releases.sort(
        (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
      );

      const latestRelease = sortedReleases[0];
      const latestVersion = latestRelease.tag_name.replace(/^v/, "");

      const isUpdateAvailable = compareVersions(latestVersion, CURRENT_VERSION) > 0;

      // Guardar en memoria
      const checkData = {
        last_checked: Date.now(),
        latest_version: latestVersion,
        current_version: CURRENT_VERSION,
        last_release_notes: latestRelease.body || "",
        last_release_url: latestRelease.html_url
      };

      memory.saveNote(VERSION_CHECK_KEY, JSON.stringify(checkData));

      return {
        current: CURRENT_VERSION,
        latest: latestVersion,
        isUpdateAvailable,
        releaseNotes: latestRelease.body,
        publishedAt: latestRelease.published_at,
        htmlUrl: latestRelease.html_url
      };
    } catch (error) {
      console.error("[Version] Error checking GitHub releases:", error);

      // Intentar obtener datos de la última verificación
      const stored = memory.getNote(VERSION_CHECK_KEY);
      if (stored) {
        try {
          const data = JSON.parse(stored);
          const isUpdateAvailable = compareVersions(data.latest_version, CURRENT_VERSION) > 0;

          return {
            current: CURRENT_VERSION,
            latest: data.latest_version || CURRENT_VERSION,
            isUpdateAvailable,
            publishedAt: data.last_checked ? new Date(data.last_checked).toISOString() : undefined
          };
        } catch (parseError) {
          console.error("[Version] Error parsing stored version data:", parseError);
        }
      }

      return {
        current: CURRENT_VERSION,
        latest: CURRENT_VERSION,
        isUpdateAvailable: false
      };
    }
  }

  function compareVersions(v1: string, v2: string): number {
    // Simple version comparison (handles semver-ish strings like "0.1.7c")
    const parts1 = v1.split(/[.-]/).map((part) => {
      const num = parseInt(part, 10);
      return isNaN(num) ? part : num;
    });

    const parts2 = v2.split(/[.-]/).map((part) => {
      const num = parseInt(part, 10);
      return isNaN(num) ? part : num;
    });

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (typeof p1 === "number" && typeof p2 === "number") {
        if (p1 !== p2) return p1 - p2;
      } else {
        const str1 = String(p1);
        const str2 = String(p2);
        if (str1 !== str2) return str1.localeCompare(str2);
      }
    }

    return 0;
  }

  function getLastCheckInfo(): {
    lastChecked?: number;
    latestVersion?: string;
    currentVersion?: string;
  } {
    const stored = memory.getNote(VERSION_CHECK_KEY);
    if (!stored) return {};

    try {
      const data = JSON.parse(stored);
      return {
        lastChecked: data.last_checked,
        latestVersion: data.latest_version,
        currentVersion: data.current_version
      };
    } catch {
      return {};
    }
  }

  return {
    definition: {
      name: "version",
      description: "Check for new releases and get version information",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["check", "info"],
            description:
              "Action to perform: 'check' to check for updates, 'info' to get current info"
          }
        }
      },
      required: ["action"]
    },

    async execute(args: { action: "check" | "info" }): Promise<string> {
      if (!args || typeof args !== "object") {
        return 'Error: "action" is required (check|info)';
      }

      switch (args.action) {
        case "check": {
          const result = await checkGitHubReleases();

          if (result.isUpdateAvailable) {
            return (
              `📢 **Nueva versión disponible!**\n\n` +
              `Versión actual: ${result.current}\n` +
              `Última versión: ${result.latest}\n` +
              `Publicada: ${result.publishedAt ? new Date(result.publishedAt).toLocaleDateString() : "N/A"}\n\n` +
              `URL: ${result.htmlUrl || "https://github.com/xErik444x/rippleclaw/releases"}`
            );
          } else {
            return (
              `✅ **Estás al día!**\n\n` +
              `Versión actual: ${result.current}\n` +
              `Última versión: ${result.latest}\n` +
              `No hay nuevas actualizaciones disponibles.`
            );
          }
        }

        case "info": {
          const lastCheck = getLastCheckInfo();
          const result = await checkGitHubReleases(); // Check again for fresh data

          const lastCheckedStr = lastCheck.lastChecked
            ? new Date(lastCheck.lastChecked).toLocaleString()
            : "Nunca";

          return (
            `📋 **Información de Versión**\n\n` +
            `Versión actual: ${result.current}\n` +
            `Última versión disponible: ${result.latest}\n` +
            `Actualización disponible: ${result.isUpdateAvailable ? "✅ Sí" : "❌ No"}\n` +
            `Última verificación: ${lastCheckedStr}\n\n` +
            `Para actualizar manualmente:\n` +
            `\`git pull && npm install && npm run build\``
          );
        }

        default:
          return `Acción no válida: ${args.action}. Usa "check" o "info".`;
      }
    }
  };
}
