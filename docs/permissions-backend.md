# 后端权限桥接集成指南

本指南汇总了 **Claude Code Web UI** 后端在权限审批方面的全部改动，方便第三方服务复用同样的机制（尤其是需要托管前端、后端分离的场景）。

## 1. 功能概览

- `@anthropic-ai/claude-agent-sdk` 的 `canUseTool` 回调现由服务器托管，并与浏览器进行交互式审批。
- 后端会在 NDJSON 流中插入 `permission_request` 事件，前端据此展示授权弹窗，不再强制中断 CLI 会话。
- 新增 `POST /api/permissions/:permissionRequestId` 接口，用于把用户审批结果回传给 `canUseTool`。
- 所有会话级权限请求均由 `PermissionRequestManager` 管理，支持多请求并发与自动回收。

## 2. 流式响应格式

新增的 `permission_request` 行与 `claude_json` 同级，前端必须监听：

```json
{"type":"permission_request","data":{
  "permissionRequestId":"51f7...",
  "requestId":"03cc...",
  "sessionId":"f528...",
  "toolName":"WebSearch",
  "input":{"query":"..."},
  "suggestions":[{"type":"addRules","behavior":"allow","destination":"session","rules":[{"toolName":"WebSearch"}]}]
}}
```

- `suggestions` 来自 SDK（如“始终允许”需要写入的规则）。
- 前端应记录 `permissionRequestId`，审批结束后调用新的权限接口。

## 3. 新增接口：`POST /api/permissions/:permissionRequestId`

请求体使用 `PermissionDecisionRequest`：

```json
{
  "behavior": "allow",
  "updatedInput": {"query": "..."},
  "updatedPermissions": [
    {
      "type": "addRules",
      "behavior": "allow",
      "destination": "session",
      "rules": [{"toolName": "WebSearch"}]
    }
  ]
}
```

- `behavior = "deny"` 时可额外带 `message`/`interrupt`。
- 服务端在收到请求后会调用 `PermissionRequestManager.resolveRequest`，唤醒挂起的 `canUseTool` 回调。

## 4. 关键实现片段

### 4.1 `shared/types.ts`

```diff
@@
+export type PermissionBehavior = "allow" | "deny";
+export type PermissionRuleValue = { toolName: string; ruleContent?: string };
+export type PermissionUpdate = { ... };
+export interface PermissionRequestEvent { ... }
+export interface PermissionDecisionRequest { ... }
@@
-export interface StreamResponse {
-  type: "claude_json" | "error" | "done" | "aborted";
-}
+export interface StreamResponse {
+  type: "claude_json" | "error" | "done" | "aborted" | "permission_request";
+  data?: unknown;
+}
```

### 4.2 `handlers/chat.ts`

```diff
@@
-import { query } from "@anthropic-ai/claude-agent-sdk";
+import { query, AbortError, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
+import { PermissionRequestManager } from "../permissions/manager";
@@
   permissionMode?: PermissionMode,
+  permissionManager?: PermissionRequestManager,
+  sendStreamResponse?: (chunk: StreamResponse) => void,
 )
@@
-    for await (const sdkMessage of query({
+    for await (const sdkMessage of query({
         ...(canUseTool ? { canUseTool } : {}),
@@
      emitStreamResponse({ type: "permission_request", data: payload });
      const result = await resultPromise;
```

### 4.3 `app.ts`

```diff
@@
-const requestAbortControllers = new Map<string, AbortController>();
+const permissionRequestManager = new PermissionRequestManager();
@@
-app.post("/api/chat", (c) => handleChatRequest(c, requestAbortControllers));
+app.post("/api/chat", (c) =>
+  handleChatRequest(c, requestAbortControllers, permissionRequestManager));
+app.post("/api/permissions/:permissionRequestId", (c) =>
+  handlePermissionDecisionRequest(c, permissionRequestManager));
```

## 5. 集成步骤（第三方后端）

1. **确保 SDK 版本** ≥ `@anthropic-ai/claude-agent-sdk@0.1.30`，以便可直接导出 `AbortError` & `CanUseTool`。
2. 在自己的流式接口中：
   - 构造 `PermissionRequestManager`
   - 给 `query()` 传入 `canUseTool`
   - 将 `permission_request` 事件写入响应流
3. 提供一个 HTTP 端点接收审批结果，并在其中调用 `resolveRequest(permissionRequestId, result)`。
4. 记得在会话结束/异常时调用 `rejectRequestsForChatRequest(requestId)` 以释放未完成的审批。

## 6. 兼容性注意事项

- 老版本前端若未处理 `permission_request`，会忽略该行，权限依旧 fallback 为 CLI 终止。升级前端前，务必保持 `allowedTools` 逻辑可用。
- 为避免恶意请求伪造审批，可在 `/api/permissions/*` 层增加认证（例如校验请求是否来自本域前端）。
- `PermissionUpdate.destination` 推荐使用 `session`，以免修改到用户全局设置。

---

通过以上改动，即可在后端维持 Claude CLI 的执行连续性，同时把权限确认的 UI/体验交给任意前端实现。第三方只需遵循此协议，即可与官方 Web UI 完全互通。
