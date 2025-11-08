import { Context } from "hono";
import type { PermissionDecisionRequest } from "../../shared/types.ts";
import {
  PermissionRequestManager,
  globalPermissionRequestManager,
} from "../permissions/manager.ts";
import { logger } from "../utils/logger.ts";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";

function sanitizeInput(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return {};
  }
  return typeof structuredClone === "function"
    ? structuredClone(input)
    : JSON.parse(JSON.stringify(input));
}

export async function handlePermissionDecisionRequest(
  c: Context,
  permissionManager: PermissionRequestManager = globalPermissionRequestManager,
) {
  const permissionRequestId = c.req.param("permissionRequestId");

  if (!permissionRequestId) {
    return c.json({ error: "Permission request ID is required" }, 400);
  }

  const pending = permissionManager.getPendingRequest(permissionRequestId);

  if (!pending) {
    return c.json({ error: "Permission request not found" }, 404);
  }

  let body: PermissionDecisionRequest;
  try {
    body = (await c.req.json()) as PermissionDecisionRequest;
  } catch (error) {
    logger.api.warn("Invalid permission decision payload: {error}", { error });
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (body.behavior !== "allow" && body.behavior !== "deny") {
    return c.json({ error: "Invalid behavior. Expected 'allow' or 'deny'." }, 400);
  }

  let permissionResult: PermissionResult;

  if (body.behavior === "allow") {
    const updatedInput = sanitizeInput(body.updatedInput ?? pending.input);
    permissionResult = {
      behavior: "allow",
      updatedInput,
      ...(body.updatedPermissions?.length
        ? { updatedPermissions: body.updatedPermissions }
        : {}),
    };
  } else {
    permissionResult = {
      behavior: "deny",
      message: body.message || "User denied permission",
      interrupt: body.interrupt ?? true,
    };
  }

  const resolved = permissionManager.resolveRequest(
    permissionRequestId,
    permissionResult,
  );

  if (!resolved) {
    return c.json({ error: "Permission request already handled" }, 409);
  }

  logger.api.debug("Resolved permission request {permissionRequestId}", {
    permissionRequestId,
    behavior: body.behavior,
  });

  return c.json({ success: true });
}
