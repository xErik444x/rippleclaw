import type { Tool } from "../providers/base";
import type { EmailAttachment, EmailSender } from "../core/email";

function normalizeRecipient(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return [value.trim()].filter((entry) => entry.length > 0);
  }
  return [];
}

function isAttachment(value: unknown): value is EmailAttachment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EmailAttachment).name === "string" &&
    typeof (value as EmailAttachment).content === "string"
  );
}

export function createEmailTool(emailSender: EmailSender) {
  return {
    definition: {
      name: "emailSender",
      description: "Send emails using the configured transport",
      parameters: {
        type: "object",
        properties: {
          to: {
            description: "Destination address(es)",
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" }, minItems: 1 }]
          },
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email content" },
          body_type: { type: "string", enum: ["plain", "html"], description: "Format: plain or html" },
          provider: {
            type: "string",
            enum: ["smtp", "api"],
            description: "Provider override (smtp or api)"
          },
          attachments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                content: { type: "string" }
              },
              required: ["name", "content"]
            }
          }
        },
        required: ["to", "subject", "body"]
      }
    } satisfies Tool,
    async execute(args: Record<string, unknown>): Promise<string> {
      const to = normalizeRecipient(args.to);
      if (!to.length) {
        return 'Error: the "to" field must be a string or array of strings';
      }
      const subject = typeof args.subject === "string" ? args.subject.trim() : "";
      if (!subject) {
        return 'Error: the "subject" field is required and must be a string';
      }
      const body = typeof args.body === "string" ? args.body : "";
      if (!body) {
        return 'Error: the "body" field is required and must be a string';
      }

      const attachments = Array.isArray(args.attachments)
        ? args.attachments.filter(isAttachment)
        : [];

      const provider =
        typeof args.provider === "string" ? (args.provider as "smtp" | "api") : undefined;
      const bodyType = args.body_type === "html" ? "html" : "plain";

      const result = await emailSender.send({
        to,
        subject,
        body,
        body_type: bodyType,
        attachments,
        provider
      });

      return JSON.stringify(result);
    }
  };
}
