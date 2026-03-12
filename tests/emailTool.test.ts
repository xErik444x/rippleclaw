import { describe, expect, it, vi } from "vitest";
import { createEmailTool } from "../src/tools/email";
import type { EmailSender } from "../src/core/email";

describe("email tool", () => {
  it("returns an error when required parameters are missing", async () => {
    const emailSender = { send: vi.fn() } as unknown as EmailSender;
    const tool = createEmailTool(emailSender);

    const response = await tool.execute({} as Record<string, unknown>);
    expect(response).toContain("Error");
  });

  it("normalizes a single recipient string and returns the sender result", async () => {
    const sendMock = vi.fn().mockResolvedValue({ success: true, messageId: "msg-123" });
    const emailSender = { send: sendMock } as unknown as EmailSender;
    const tool = createEmailTool(emailSender);

    const payload = await tool.execute({
      to: "dest@example.com",
      subject: "Hola",
      body: "Contenido",
      body_type: "plain"
    });

    expect(sendMock).toHaveBeenCalled();
    expect(payload).toContain("msg-123");
  });
});
