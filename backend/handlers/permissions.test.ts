import { describe, it, expect, vi } from "vitest";
import { handlePermissionDecisionRequest } from "./permissions";
import { PermissionRequestManager } from "../permissions/manager";

describe("handlePermissionDecisionRequest", () => {
  const createMockContext = (options: {
    permissionRequestId?: string;
    body?: unknown;
  }) => {
    const json = vi.fn().mockResolvedValue(options.body);
    const respond = vi
      .fn()
      .mockImplementation((payload: unknown, status = 200) => ({
        status,
        payload,
      }));

    return {
      req: {
        param: vi.fn().mockReturnValue(options.permissionRequestId),
        json,
      },
      json: respond,
    } as any;
  };

  it("resolves pending permission request on allow", async () => {
    const manager = new PermissionRequestManager();
    const { permissionRequestId, resultPromise } = manager.createRequest({
      requestId: "req-1",
      toolName: "Bash",
      input: { command: "ls" },
    });

    const context = createMockContext({
      permissionRequestId,
      body: { behavior: "allow" },
    });

    const response = await handlePermissionDecisionRequest(context, manager);

    expect(response.status).toBe(200);
    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({ behavior: "allow" }),
    );
  });

  it("returns 404 when permission request missing", async () => {
    const manager = new PermissionRequestManager();
    const context = createMockContext({
      permissionRequestId: "missing",
      body: { behavior: "allow" },
    });

    const response = await handlePermissionDecisionRequest(context, manager);
    expect(response.status).toBe(404);
  });
});
