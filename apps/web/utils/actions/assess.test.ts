import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { getMockMessage } from "@/__tests__/helpers";
import { SafeError } from "@/utils/error";
import { analyzeWritingStyleAction, assessAction } from "./assess";

const mocks = vi.hoisted(() => ({
  after: [] as (() => void | Promise<void>)[],
  getSentMessages: vi.fn(),
  getMessages: vi.fn(),
  createProvider: vi.fn(),
  analyzeStyle: vi.fn(),
  assessUser: vi.fn(),
  validateAccess: vi.fn(),
  contentAllowed: vi.fn(),
  locks: new Map<string, { value: string; expires: number }>(),
}));

vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  auth: async () => ({ user: { id: "user-1", email: "user@example.com" } }),
}));
vi.mock("@sentry/nextjs", () => import("@/__tests__/mocks/sentry-nextjs.mock"));
vi.mock("next/server", async (importActual) => ({
  ...(await importActual<typeof import("next/server")>()),
  after: (callback: () => void | Promise<void>) => mocks.after.push(callback),
}));
vi.mock("@/utils/user/validate", () => ({
  validateUserAndAiAccess: mocks.validateAccess,
}));
vi.mock("@/utils/mail-content-ai-policy", () => ({
  isMailContentAiAllowed: mocks.contentAllowed,
}));
vi.mock("@/utils/email/provider", () => ({
  createEmailProvider: mocks.createProvider,
}));
vi.mock("@/utils/ai/knowledge/writing-style", () => ({
  aiAnalyzeWritingStyle: mocks.analyzeStyle,
}));
vi.mock("@/utils/assess", () => ({ assessUser: mocks.assessUser }));
vi.mock("@/utils/whitelist-inbox-zero", () => ({
  whitelistInboxZero: vi.fn(),
}));
vi.mock("@/utils/redis", () => ({
  redis: {
    get: async (key: string) => {
      const value = mocks.locks.get(key);
      return value && value.expires > Date.now() ? value.value : null;
    },
    set: async (
      key: string,
      value: string,
      options: { nx?: boolean; ex: number },
    ) => {
      const current = mocks.locks.get(key);
      if (options.nx && current && current.expires > Date.now()) return null;
      mocks.locks.set(key, { value, expires: Date.now() + options.ex * 1000 });
      return "OK";
    },
    eval: async (_script: string, keys: string[], args: string[]) => {
      const current = mocks.locks.get(keys[0]);
      if (
        !current ||
        current.value !== args[0] ||
        current.expires <= Date.now()
      )
        return 0;
      if (args.length === 1) mocks.locks.delete(keys[0]);
      else
        mocks.locks.set(keys[0], {
          value: args[1],
          expires: Date.now() + Number(args[2]) * 1000,
        });
      return 1;
    },
  },
}));

async function drainAfter() {
  while (mocks.after.length) await mocks.after.shift()!();
}

function expectNoProviderOrAiActivity() {
  expect(mocks.createProvider).not.toHaveBeenCalled();
  expect(mocks.getSentMessages).not.toHaveBeenCalled();
  expect(mocks.getMessages).not.toHaveBeenCalled();
  expect(mocks.analyzeStyle).not.toHaveBeenCalled();
  expect(mocks.assessUser).not.toHaveBeenCalled();
  expect(mocks.after).toHaveLength(0);
}

describe("account analysis policy gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.length = 0;
    mocks.locks.clear();
    prisma.emailAccount.findUnique.mockImplementation(async (args) => {
      if (args.select?.account) {
        return {
          email: "user@example.com",
          account: { userId: "user-1", provider: "google" },
        } as never;
      }
      return {
        id: "account-1",
        user: {},
        behaviorProfile: null,
        writingStyle: null,
      } as never;
    });
    prisma.emailAccount.update.mockResolvedValue({ id: "account-1" } as never);
    mocks.contentAllowed.mockReturnValue(true);
    mocks.validateAccess.mockResolvedValue({
      emailAccount: { id: "account-1" },
    });
    mocks.getMessages.mockResolvedValue({ messages: [] });
    mocks.getSentMessages.mockResolvedValue([getMockMessage()]);
    mocks.createProvider.mockResolvedValue({
      name: "google",
      getMessagesWithPagination: mocks.getMessages,
      getSentMessages: mocks.getSentMessages,
      getLabelById: async () => ({}),
      getLabels: async () => [],
      getFiltersList: async () => [],
      getForwardingAddresses: async () => [],
    });
    mocks.analyzeStyle.mockResolvedValue({
      typicalLength: "Short",
      formality: "Informal",
      commonGreeting: "Hello",
      notableTraits: [],
      examples: [],
    });
    mocks.assessUser.mockResolvedValue({ any: "profile" });
  });

  describe.each([
    ["assessAction", assessAction],
    ["analyzeWritingStyleAction", analyzeWritingStyleAction],
  ])("%s", (_name, action) => {
    it("does no provider read or AI call when access is denied", async () => {
      mocks.validateAccess.mockRejectedValue(
        new SafeError("Please upgrade for AI access", 403),
      );

      const result = await action("account-1");
      await drainAfter();

      expect(result).toMatchObject({ data: { success: true, skipped: true } });
      expectNoProviderOrAiActivity();
      expect(prisma.emailAccount.update).not.toHaveBeenCalled();
    });

    it("does no provider read or AI call when deployment policy denies the account", async () => {
      mocks.contentAllowed.mockReturnValue(false);

      const result = await action("account-1");
      await drainAfter();

      expect(result).toMatchObject({ data: { success: true, skipped: true } });
      expect(mocks.validateAccess).not.toHaveBeenCalled();
      expectNoProviderOrAiActivity();
      expect(prisma.emailAccount.update).not.toHaveBeenCalled();
    });

    it("does no provider read or AI call when the account is not found", async () => {
      mocks.validateAccess.mockRejectedValue(new SafeError("User not found"));

      const result = await action("account-1");
      await drainAfter();

      expect(result?.data).toBeUndefined();
      expectNoProviderOrAiActivity();
      expect(prisma.emailAccount.update).not.toHaveBeenCalled();
    });

    it("checks access before reading the account", async () => {
      mocks.validateAccess.mockRejectedValue(
        new SafeError("Please upgrade for AI access", 403),
      );
      await action("account-1");
      const accountReads = prisma.emailAccount.findUnique.mock.calls.filter(
        ([args]) => !args.select?.account,
      );
      expect(accountReads).toHaveLength(0);
    });
  });

  it("writing style: granted access reads Sent mail and calls AI", async () => {
    const result = await analyzeWritingStyleAction("account-1");
    expect(result).toMatchObject({ data: { status: "running" } });
    expect(mocks.createProvider).not.toHaveBeenCalled();

    await drainAfter();

    expect(mocks.createProvider).toHaveBeenCalledOnce();
    expect(mocks.getSentMessages).toHaveBeenCalledOnce();
    expect(mocks.analyzeStyle).toHaveBeenCalledOnce();
    expect(prisma.emailAccount.update).toHaveBeenCalledOnce();
  });

  it("assess: granted access runs the mailbox assessment", async () => {
    const result = await assessAction("account-1");
    expect(result).toMatchObject({ data: { status: "running" } });

    await drainAfter();

    expect(mocks.createProvider).toHaveBeenCalledOnce();
    expect(mocks.assessUser).toHaveBeenCalledOnce();
    expect(prisma.emailAccount.update).toHaveBeenCalledOnce();
  });
});
