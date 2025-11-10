export type PermissionBehavior = "allow" | "deny";

export type PermissionRuleValue = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionUpdate =
  | {
      type: "addRules";
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: "userSettings" | "projectSettings" | "localSettings" | "session";
    }
  | {
      type: "replaceRules";
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: "userSettings" | "projectSettings" | "localSettings" | "session";
    }
  | {
      type: "removeRules";
      rules: PermissionRuleValue[];
      behavior: PermissionBehavior;
      destination: "userSettings" | "projectSettings" | "localSettings" | "session";
    }
  | {
    type: "setMode";
    mode: "default" | "plan" | "acceptEdits" | "bypassPermissions";
    destination: "userSettings" | "projectSettings" | "localSettings" | "session";
  }
  | {
      type: "addDirectories";
      directories: string[];
      destination: "userSettings" | "projectSettings" | "localSettings" | "session";
    }
  | {
      type: "removeDirectories";
      directories: string[];
      destination: "userSettings" | "projectSettings" | "localSettings" | "session";
    };

export interface PermissionRequestEvent {
  permissionRequestId: string;
  requestId: string;
  sessionId?: string;
  toolName: string;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
}

export interface PermissionDecisionRequest {
  behavior: PermissionBehavior;
  updatedInput?: Record<string, unknown>;
  message?: string;
  interrupt?: boolean;
  updatedPermissions?: PermissionUpdate[];
}

export interface StreamResponse {
  type:
    | "claude_json"
    | "error"
    | "done"
    | "aborted"
    | "permission_request";
  data?: unknown; // SDKMessage object for claude_json type or PermissionRequestEvent for permission_request
  error?: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  requestId: string;
  allowedTools?: string[];
  workingDirectory?: string;
  permissionMode?:
    | "default"
    | "plan"
    | "acceptEdits"
    | "bypassPermissions";
  uid?: string;
  autobaSessionId?: string;
}

export interface AbortRequest {
  requestId: string;
}

export interface ProjectInfo {
  path: string;
  encodedName: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectsResponse {
  projects: ProjectInfo[];
}

// Conversation history types
export interface ConversationSummary {
  sessionId: string;
  startTime: string;
  lastTime: string;
  messageCount: number;
  lastMessagePreview: string;
}

export interface HistoryListResponse {
  conversations: ConversationSummary[];
}

// Conversation history types
// Note: messages are typed as unknown[] to avoid frontend/backend dependency issues
// Frontend should cast to TimestampedSDKMessage[] (defined in frontend/src/types.ts)
export interface ConversationHistory {
  sessionId: string;
  messages: unknown[]; // TimestampedSDKMessage[] in practice, but avoiding frontend type dependency
  metadata: {
    startTime: string;
    endTime: string;
    messageCount: number;
  };
}
