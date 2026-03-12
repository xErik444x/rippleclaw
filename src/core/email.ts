import { fetch } from "undici";
import nodemailer from "nodemailer";
import type { Config, EmailConfig, EmailProvider, SmtpEmailConfig, ApiEmailConfig } from "./config";
import { logEmailSend } from "./logger";

export type EmailErrorCode = "INVALID_CONFIG" | "AUTHENTICATION" | "NETWORK" | "RATE_LIMIT";

export interface EmailAttachment {
  name: string;
  content: string;
}

export interface EmailSendParams {
  to: string | string[];
  subject: string;
  body: string;
  body_type?: "plain" | "html";
  attachments?: EmailAttachment[];
  provider?: EmailProvider;
  dry_run?: boolean;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: EmailErrorCode;
}

interface EmailTransportSendArgs {
  to: string[];
  from: string;
  subject: string;
  body: string;
  bodyType: "plain" | "html";
  attachments: EmailAttachment[];
  signal: AbortSignal;
  timeoutMs: number;
}

interface EmailTransportResponse {
  messageId?: string;
}

interface EmailTransport {
  providerName: string;
  sendEmail(args: EmailTransportSendArgs): Promise<EmailTransportResponse>;
}

export class EmailError extends Error {
  constructor(
    public readonly code: EmailErrorCode,
    message?: string
  ) {
    super(message);
    this.name = "EmailError";
  }
}

function normalizeRecipients(to: string | string[]): string[] {
  const values = Array.isArray(to) ? to : [to];
  return Array.from(
    new Set(
      values
        .map((entry) => entry?.toString().trim())
        .filter((entry) => typeof entry === "string" && entry.length > 0)
    )
  );
}

export class EmailTransportFactory {
  constructor(private readonly config: EmailConfig) {}

  create(provider?: EmailProvider): EmailTransport {
    const chosen = provider || this.config.provider;
    if (chosen === "smtp") {
      return new SmtpTransport(this.config.smtp, this.config.default_from);
    }
    if (chosen === "api") {
      return new HttpTransport(this.config.api, this.config.default_from);
    }
    throw new EmailError("INVALID_CONFIG", `Unsupported email provider: ${chosen}`);
  }
}

class SmtpTransport implements EmailTransport {
  providerName = "smtp";

  constructor(
    private readonly config: SmtpEmailConfig,
    private readonly defaultFrom: string
  ) {}

  async sendEmail(args: EmailTransportSendArgs): Promise<EmailTransportResponse> {
    if (!this.config.host) {
      throw new EmailError("INVALID_CONFIG", "SMTP host is required");
    }

    const transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.username, pass: this.config.password },
      connectionTimeout: args.timeoutMs,
      socketTimeout: args.timeoutMs
    });

    const onAbort = () => transporter.close();
    args.signal.addEventListener("abort", onAbort);

    try {
      const info = await transporter.sendMail({
        from: this.defaultFrom,
        to: args.to,
        subject: args.subject,
        text: args.bodyType === "plain" ? args.body : undefined,
        html: args.bodyType === "html" ? args.body : undefined,
        attachments: args.attachments.map((att) => ({ filename: att.name, content: att.content }))
      });
      return { messageId: info.messageId };
    } catch (err) {
      throw mapSmtpError(err);
    } finally {
      args.signal.removeEventListener("abort", onAbort);
      transporter.close();
    }
  }
}

class HttpTransport implements EmailTransport {
  providerName = "api";

  constructor(
    private readonly config: ApiEmailConfig,
    private readonly defaultFrom: string
  ) {}

  async sendEmail(args: EmailTransportSendArgs): Promise<EmailTransportResponse> {
    if (!this.config.base_url) {
      throw new EmailError("INVALID_CONFIG", "Missing API base_url");
    }
    if (!this.config.api_key) {
      throw new EmailError("INVALID_CONFIG", "Missing API key");
    }

    const payload = {
      from: args.from,
      to: args.to,
      subject: args.subject,
      body: args.body,
      body_type: args.bodyType,
      attachments: args.attachments
    };

    const response = await fetch(this.config.base_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.api_key}`
      },
      body: JSON.stringify(payload),
      signal: args.signal
    });

    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new EmailError("AUTHENTICATION", raw);
      }
      if (response.status === 429) {
        throw new EmailError("RATE_LIMIT", raw);
      }
      if (response.status >= 400 && response.status < 500) {
        throw new EmailError("INVALID_CONFIG", raw);
      }
      throw new EmailError("NETWORK", raw);
    }

    let json = {} as Record<string, unknown>;
    if (raw) {
      try {
        json = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        json = {};
      }
    }

    return { messageId: json.messageId as string | undefined };
  }
}

function mapSmtpError(err: unknown): EmailError {
  if (err instanceof EmailError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/AUTH|EAUTH|Invalid login/i.test(message)) {
    return new EmailError("AUTHENTICATION", message);
  }
  if (/timeout|ETIMEDOUT|ECONNECTION|ENOTFOUND/i.test(message)) {
    return new EmailError("NETWORK", message);
  }
  if (/rate limit|429/i.test(message)) {
    return new EmailError("RATE_LIMIT", message);
  }
  return new EmailError("NETWORK", message);
}

interface NormalizedParams {
  to: string[];
  subject: string;
  body: string;
  bodyType: "plain" | "html";
  attachments: EmailAttachment[];
  provider: EmailProvider;
}

export class EmailSender {
  private readonly timeoutMs: number;

  constructor(
    private readonly config: Config,
    private readonly factory?: EmailTransportFactory
  ) {
    const emailConfig = this.config.email;
    this.factory = factory ?? new EmailTransportFactory(emailConfig);
    this.timeoutMs = Math.max(1000, emailConfig.smtp.timeout_ms || 15000);
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    const start = Date.now();
    const emailConfig = this.config.email;
    const normalized = this.normalizeParams(params);
    const logPayload = {
      to: normalized.to,
      provider: normalized.provider,
      duration_ms: 0,
      success: false,
      messageId: undefined as string | undefined,
      error: undefined as EmailErrorCode | undefined,
      dry_run: Boolean(params.dry_run)
    };

    try {
      if (!emailConfig.enabled) {
        logPayload.error = "INVALID_CONFIG";
        return { success: false, error: "INVALID_CONFIG" };
      }

      const transport = this.factory!.create(normalized.provider);
      if (params.dry_run) {
        logPayload.success = true;
        return { success: true };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const result = await transport.sendEmail({
          ...normalized,
          from: emailConfig.default_from,
          signal: controller.signal,
          timeoutMs: this.timeoutMs
        });
        logPayload.success = true;
        logPayload.messageId = result.messageId;
        return { success: true, messageId: result.messageId };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      if (err instanceof EmailError) {
        logPayload.error = err.code;
        return { success: false, error: err.code };
      }
      logPayload.error = "NETWORK";
      return { success: false, error: "NETWORK" };
    } finally {
      logPayload.duration_ms = Date.now() - start;
      logEmailSend(this.config, logPayload);
    }
  }

  private normalizeParams(params: EmailSendParams): NormalizedParams {
    const toList = normalizeRecipients(params.to);
    if (!toList.length) {
      throw new EmailError("INVALID_CONFIG", "At least one recipient is required");
    }
    const attachments = Array.isArray(params.attachments)
      ? params.attachments.filter(
          (item): item is EmailAttachment =>
            typeof item?.name === "string" && typeof item?.content === "string"
        )
      : [];
    const bodyType = params.body_type === "html" ? "html" : "plain";
    const provider = params.provider || this.config.email.provider;

    return {
      to: toList,
      subject: params.subject,
      body: params.body,
      bodyType,
      attachments,
      provider
    };
  }
}
