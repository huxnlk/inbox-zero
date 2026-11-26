import type { Client } from "@microsoft/microsoft-graph-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "@/__tests__/helpers";
import { unwatchOutlook, watchOutlook } from "@/utils/outlook/watch";

const { envMock } = vi.hoisted(() => ({
  envMock: {
    WEBHOOK_URL: "https://notify.example.com",
    NEXT_PUBLIC_BASE_URL: "https://app.example.com",
    MICROSOFT_WEBHOOK_CLIENT_STATE: "test-state",
    MICROSOFT_WEBHOOK_CHANGE_TYPE: "created,updated" as
      | "created"
      | "created,updated",
    MICROSOFT_WEBHOOK_INBOX_ONLY: false,
  },
}));

vi.mock("@/env", () => ({ env: envMock }));

describe("watchOutlook", () => {
  beforeEach(() => {
    envMock.MICROSOFT_WEBHOOK_CHANGE_TYPE = "created,updated";
    envMock.MICROSOFT_WEBHOOK_INBOX_ONLY = false;
  });

  it.each([
    [false, "created,updated", "/me/messages"],
    [true, "created", "/me/mailFolders('inbox')/messages"],
  ] as const)("subscribes with the selected incoming scope (%s, %s)", async (inboxOnly, changeType, resource) => {
    envMock.MICROSOFT_WEBHOOK_INBOX_ONLY = inboxOnly;
    envMock.MICROSOFT_WEBHOOK_CHANGE_TYPE = changeType;
    const post = vi.fn().mockResolvedValue({
      id: "subscription-1",
      expirationDateTime: "2026-01-04T00:00:00Z",
    });
    const client = {
      api: vi.fn().mockReturnValue({ post }),
    } as unknown as Client;

    await watchOutlook(client, createTestLogger());

    expect(client.api).toHaveBeenCalledWith("/subscriptions");
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        changeType,
        resource,
        notificationUrl: "https://notify.example.com/api/outlook/webhook",
        clientState: "test-state",
      }),
    );
  });
});

describe("unwatchOutlook", () => {
  it("treats a subscription Graph no longer has as already removed", async () => {
    const client = createClientWithDelete(
      vi
        .fn()
        .mockRejectedValue(
          createGraphError(
            404,
            "ResourceNotFound",
            "The object was not found.",
          ),
        ),
    );

    await expect(
      unwatchOutlook(client, "subscription-1", createTestLogger()),
    ).resolves.toBeUndefined();
  });

  it("still throws other Graph errors", async () => {
    const error = createGraphError(403, "Forbidden", "Access denied.");
    const client = createClientWithDelete(vi.fn().mockRejectedValue(error));

    await expect(
      unwatchOutlook(client, "subscription-1", createTestLogger()),
    ).rejects.toBe(error);
  });
});

function createClientWithDelete(deleteFn: ReturnType<typeof vi.fn>) {
  return {
    api: vi.fn().mockReturnValue({ delete: deleteFn }),
  } as unknown as Client;
}

function createGraphError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}
