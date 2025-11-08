import type {
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type { PermissionRequestEvent } from "../../shared/types.ts";

interface PermissionRequestInit {
  requestId: string;
  sessionId?: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
}

interface PendingPermissionRequest extends PermissionRequestInit {
  permissionRequestId: string;
  resolve: (result: PermissionResult) => void;
  reject: (reason?: unknown) => void;
}

const cloneData = <T>(value: T): T => {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

export class PermissionRequestManager {
  private pending = new Map<string, PendingPermissionRequest>();

  createRequest(init: PermissionRequestInit) {
    const permissionRequestId = crypto.randomUUID();
    let resolveFn: (result: PermissionResult) => void;
    let rejectFn: (reason?: unknown) => void;

    const resultPromise = new Promise<PermissionResult>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const record: PendingPermissionRequest = {
      ...init,
      permissionRequestId,
      resolve: resolveFn!,
      reject: rejectFn!,
    };

    this.pending.set(permissionRequestId, record);

    const payload: PermissionRequestEvent = {
      permissionRequestId,
      requestId: init.requestId,
      sessionId: init.sessionId,
      toolName: init.toolName,
      input: cloneData(init.input),
      suggestions: init.suggestions?.length
        ? cloneData(init.suggestions)
        : undefined,
    };

    return { payload, resultPromise, permissionRequestId } as const;
  }

  resolveRequest(permissionRequestId: string, result: PermissionResult) {
    const record = this.pending.get(permissionRequestId);
    if (!record) {
      return false;
    }

    record.resolve(result);
    this.pending.delete(permissionRequestId);
    return true;
  }

  rejectRequest(permissionRequestId: string, reason?: unknown) {
    const record = this.pending.get(permissionRequestId);
    if (!record) {
      return false;
    }

    record.reject(reason ?? new Error("Permission request rejected"));
    this.pending.delete(permissionRequestId);
    return true;
  }

  rejectRequestsForChatRequest(requestId: string, reason?: unknown) {
    for (const [permissionRequestId, record] of this.pending.entries()) {
      if (record.requestId === requestId) {
        record.reject(reason ?? new Error("Chat request ended"));
        this.pending.delete(permissionRequestId);
      }
    }
  }

  getPendingRequest(permissionRequestId: string) {
    return this.pending.get(permissionRequestId);
  }

  clearAll() {
    this.pending.clear();
  }
}

export const globalPermissionRequestManager = new PermissionRequestManager();
