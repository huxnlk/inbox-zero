import { afterEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  MAIL_CONTENT_AI_ALLOWED_ACCOUNTS: undefined as string | undefined,
}));
vi.mock("@/env", () => ({ env: envMock }));

import { isMailContentAiAllowed } from "./mail-content-ai-policy";

describe("isMailContentAiAllowed", () => {
  afterEach(() => {
    envMock.MAIL_CONTENT_AI_ALLOWED_ACCOUNTS = undefined;
  });

  it("allows when the policy is unset", () => {
    expect(isMailContentAiAllowed("a1")).toBe(true);
  });

  it("denies every account when set to none or empty", () => {
    envMock.MAIL_CONTENT_AI_ALLOWED_ACCOUNTS = "none";
    expect(isMailContentAiAllowed("a1")).toBe(false);
    envMock.MAIL_CONTENT_AI_ALLOWED_ACCOUNTS = " ";
    expect(isMailContentAiAllowed("a1")).toBe(false);
  });

  it("allows only listed accounts", () => {
    envMock.MAIL_CONTENT_AI_ALLOWED_ACCOUNTS = "a1, a2";
    expect(isMailContentAiAllowed("a2")).toBe(true);
    expect(isMailContentAiAllowed("a3")).toBe(false);
  });
});
