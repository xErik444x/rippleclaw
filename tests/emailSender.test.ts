import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "../src/core/config";
import type { Config } from "../src/core/config";
import { EmailSender } from "../src/core/email";

function makeConfig(overrides?: Partial<Config>): Config {
  const base = createDefaultConfig();
  return { ...base, ...overrides } as Config;
}

describe("EmailSender", () => {
  it("succeeds on dry run without touching transports", async () => {
    const baseEmail = createDefaultConfig().email;
    const config = makeConfig({
      email: {
        ...baseEmail,
        enabled: true,
        smtp: {
          ...baseEmail.smtp,
          host: "smtp.example.com",
          username: "user",
          password: "secret"
        }
      }
    });

    const sender = new EmailSender(config);
    const result = await sender.send({
      to: "user@example.com",
      subject: "Prueba",
      body: "Hola",
      dry_run: true
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns INVALID_CONFIG when email is disabled", async () => {
    const config = makeConfig({
      email: {
        ...createDefaultConfig().email,
        enabled: false
      }
    });

    const sender = new EmailSender(config);
    const result = await sender.send({
      to: "user@example.com",
      subject: "Hola",
      body: "Texto"
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_CONFIG");
  });
});
