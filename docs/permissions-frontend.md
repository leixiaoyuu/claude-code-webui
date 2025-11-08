# 前端权限审批适配指南

此文档面向需要对接 **Claude Code Web UI** 新权限流程的第三方前端。重点是如何监听 `permission_request` 事件、弹出审批 UI，并把结果回传给 `/api/permissions/:permissionRequestId`。

## 1. 数据流回顾

1. 后端在 NDJSON 中推送 `permission_request`。
2. 前端解析到事件后，展示包含工具名称/命令等信息的授权面板。
3. 用户点击 “允许 / 始终允许 / 拒绝”。
4. 前端调用 `POST /api/permissions/:permissionRequestId`，服务端继续/终止当前工具调用。

## 2. Streaming 处理

`useStreamParser` 内新增了对 `permission_request` 的分支：

```diff
@@ useStreamParser.ts
-    if (data.type === "claude_json") { ... }
+    if (data.type === "claude_json") { ... }
+    } else if (data.type === "permission_request" && data.data) {
+      context.onPermissionRequest?.(data.data as PermissionRequestEvent);
```

同时 `StreamingContext` 需要暴露 `onPermissionRequest` 回调，供具体页面实现。

## 3. 权限状态管理 Hook

`usePermissions` 负责在 React 层维护弹窗：

```diff
@@ usePermissions.ts
-const [permissionRequest, setPermissionRequest] = useState<...>(null);
+const [permissionRequest, setPermissionRequest] = useState<...>(null);
+const showInteractivePermissionRequest = useCallback((event) => {
+  const { toolName, commands } = extractToolInfo(event.toolName, event.input);
+  setPermissionRequest({
+    interactive: {
+      permissionRequestId: event.permissionRequestId,
+      requestId: event.requestId,
+      sessionId: event.sessionId,
+      input: event.input,
+      suggestions: event.suggestions,
+    },
+    patterns: generateToolPatterns(toolName, commands),
+    ...
+  });
+});
```

`respondToInteractivePermissionRequest` 会把审批写回后端：

```ts
await fetch(getPermissionDecisionUrl(permissionRequestId), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ behavior, updatedInput, updatedPermissions })
});
```

- 若 `behavior === "allow"` 且 SDK 提供 `suggestions`，会原样携带 `updatedPermissions`，前端无需自行生成规则。
- 若无 `suggestions`，`disableAllowPermanent` 会阻止“始终允许”按钮，提示用户当前请求无法持久化。

## 4. Chat 组件的接入点

### 4.1 消费事件

`ChatPage` 在构建 `StreamingContext` 时把 `showInteractivePermissionRequest` 传入：

```diff
const streamingContext = {
  ...
  onPermissionRequest: showInteractivePermissionRequest,
  onPermissionError: handlePermissionError,
};
```

### 4.2 “始终允许”按钮

```diff
const permissionData = {
  patterns: permissionRequest.patterns,
  onAllow: handlePermissionAllow,
  onAllowPermanent: handlePermissionAllowPermanent,
  disableAllowPermanent: Boolean(
    permissionRequest.interactive &&
    !(permissionRequest.interactive.suggestions?.length),
  ),
};
```

- 当 `suggestions` 为空时，“始终允许”将被禁用，防止发送无效的 `updatedPermissions`。
- 传统 `allowedTools` 仍然保留，用于旧 CLI 模式或本地 Demo。

## 5. UI 层实现要点

`PermissionInputPanel` 增加了加载/错误状态以及禁用提示：

```diff
-onAllowPermanent={() => ...}
+onAllowPermanent={() => {
+  if (isProcessing || disableAllowPermanent) return;
+  ...
+}}
+{disableAllowPermanent && (
+  <p>Always allow is unavailable...</p>
+)}
```

如果第三方希望自定义权限弹窗，只需遵循以下协议：

1. 显示 `patterns`（来自工具名/命令），帮助用户确认 CLI 要执行的操作。
2. 当用户同意时，将 `behavior: "allow"` 与后端给出的 `updatedPermissions` 一并提交。
3. 若用户点击“始终允许”而 SDK 未返回建议，可直接提示“当前操作无法记住授权”。

## 6. API 封装

在 `src/config/api.ts` 中新增了 `getPermissionDecisionUrl(permissionRequestId)`，第三方可在自己的 API 层提供类似的 helper，确保所有请求都以相对路径 `POST /api/permissions/:id` 发送。

## 7. 整体交互顺序（供第三方参考）

1. **收到 `permission_request` 行** ➜ 缓存 `permissionRequestId` 与上下文。
2. **展示审批 UI** ➜ 用户选择操作。
3. **调用 `/api/permissions/:id`**：
   - 允许：带上 `updatedInput`（可直接复用事件中的 input）。
   - 始终允许：若 `suggestions` 存在则转发，否则禁用按钮。
   - 拒绝：携带 `behavior: "deny"` 与提示语。
4. **关闭弹窗 & 继续 Streaming**。

## 8. 回退策略

- 若前端暂未实现新协议，可在收到 `permission_request` 时直接提示“不支持此权限模式”，同时调用 `/api/permissions/:id` 且 `behavior: "deny"`，保持 CLI 行为与旧版本一致。
- 保留 `allowedTools` 逻辑，可在无 UI 状态时依旧使用 `/api/chat` 的 `allowedTools` 数组继续对话。

---

通过以上改动，第三方前端即可无缝对接新版后台的权限桥接能力，实现与官方 Web UI 相同的审批体验。
