import { beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const tmpDir = join(__dirname, ".tmp");
const configPath = join(tmpDir, "email.config.json");

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        name: "RippleClaw",
        version: "0.1.0",
        workspace: ".",
        default_provider: "openai",
        default_model: "gpt-4o",
        autonomy: "full",
        providers: [],
        channels: {
          telegram: { enabled: false, token: "", allowed_users: [] },
          discord: { enabled: false, token: "", allowed_users: [] },
          cli: { enabled: false }
        },
        memory: { backend: "json", path: ".memory.json", auto_save: false },
        tools: {
          shell: { enabled: false, allowed_commands: [], workspace_only: true },
          file: { enabled: false, workspace_only: true },
          web: { enabled: false },
          weather: { enabled: false },
          summarize: { enabled: false }
        },
        cron: { enabled: false, jobs: [] },
        email: {
          enabled: true,
          provider: "smtp",
          default_from: "Ripple <no-reply@example.com>",
          smtp: {
            host: "smtp.example.com",
            port: 587,
            username: "user",
            password: "secret",
            secure: true,
            timeout_ms: 15000
          },
          api: { base_url: "", api_key: "" }
        }
      },
      null,
      2
    )
  );

  spawnSync("npm", ["run", "build"], { stdio: "inherit" });
});

describe("daemon email CLI", () => {
  it("runs --dry-run without launching the daemon", () => {
    const result = spawnSync(
      "node",
      [
        "dist/daemon.js",
        "email",
        "send",
        "--dry-run",
        "--to",
        "user@example.com",
        "--subject",
        "Prueba",
        "--body",
        "Contenido"
      ],
      {
        env: { ...process.env, RIPPLECLAW_CONFIG: configPath },
        encoding: "utf-8"
      }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Email preparado en seco");
  });
});
