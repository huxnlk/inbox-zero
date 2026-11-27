import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import {
  listMcpEmailAccounts,
  resolveMcpEmailAccount,
} from "@/utils/mcp/account-selection";

vi.mock("@/utils/prisma");

describe("account-selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists linked email accounts with provider metadata", async () => {
    prisma.emailAccount.findMany.mockResolvedValue([
      {
        id: "account_1",
        email: "first@example.com",
        name: "First Account",
        account: { provider: "google" },
      },
    ] as never);

    await expect(listMcpEmailAccounts("user_1")).resolves.toEqual([
      {
        id: "account_1",
        email: "first@example.com",
        name: "First Account",
        provider: "google",
      },
    ]);
  });

  it("rejects a missing selector without querying accounts", async () => {
    await expect(resolveMcpEmailAccount({ userId: "user_1" })).rejects.toThrow(
      "An explicit account is required",
    );
    expect(prisma.emailAccount.findFirst).not.toHaveBeenCalled();
  });

  it("resolves an explicit emailAccountId owned by the user", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue({
      id: "account_1",
      email: "first@example.com",
      name: "First Account",
      account: { provider: "google" },
    } as never);

    await expect(
      resolveMcpEmailAccount({ userId: "user_1", emailAccountId: "account_1" }),
    ).resolves.toEqual({
      id: "account_1",
      email: "first@example.com",
      name: "First Account",
      provider: "google",
    });
    expect(prisma.emailAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "account_1", userId: "user_1" } }),
    );
  });

  it("rejects an unknown or other user's emailAccountId", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue(null);

    await expect(
      resolveMcpEmailAccount({ userId: "user_1", emailAccountId: "foreign" }),
    ).rejects.toThrow("Email account not found for the authenticated user.");
    expect(prisma.emailAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "foreign", userId: "user_1" } }),
    );
  });

  it("resolves an explicitly selected email address", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue({
      id: "account_2",
      email: "selected@example.com",
      name: null,
      account: { provider: "microsoft" },
    } as never);

    await expect(
      resolveMcpEmailAccount({
        userId: "user_1",
        emailAddress: "selected@example.com",
      }),
    ).resolves.toEqual({
      id: "account_2",
      email: "selected@example.com",
      name: null,
      provider: "microsoft",
    });
  });

  it("rejects ambiguous selectors", async () => {
    await expect(
      resolveMcpEmailAccount({
        userId: "user_1",
        emailAccountId: "account_1",
        emailAddress: "selected@example.com",
      }),
    ).rejects.toThrow(
      "Provide either emailAccountId or emailAddress, not both.",
    );
  });
});
