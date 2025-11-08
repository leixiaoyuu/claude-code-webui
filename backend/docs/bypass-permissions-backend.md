# bypassPermissions 模式后端调整指南

> 说明如何在后端默认启用 `bypassPermissions`，并向第三方前端暴露所需的协议变更。

## 背景

- 依照 `docs/agent-sdk/permissions.md` 与 `docs/agent-sdk/agent-sdk-reference-ts.md` 的建议，Claude Agent SDK 支持 `permissionMode: "bypassPermissions"` 以绕过额外授权提示。
- 为了让第三方前端可即插即用，本次更新将 **后端与共享类型** 全面调整为“默认 bypass”。

## 核心改動

1. **共享类型** `shared/types.ts`
   - `ChatRequest.permissionMode` 允许 `"bypassPermissions"`。
2. **聊天处理器** `handlers/chat.ts`
   - 新增 `effectivePermissionMode`，若请求未指定 `permissionMode` 即传递 `"bypassPermissions"`。
   - 无需前端额外设置即可获得无提示体验。
3. **测试** `handlers/chat.test.ts`
   - 新增用例覆盖默认为 `bypassPermissions` 的情况。

## 重要代码差异

```diff
diff --git a/shared/types.ts b/shared/types.ts
@@
 export interface ChatRequest {
   message: string;
   sessionId?: string;
   requestId: string;
   allowedTools?: string[];
   workingDirectory?: string;
-  permissionMode?: "default" | "plan" | "acceptEdits";
+  permissionMode?:
+    | "default"
+    | "plan"
+    | "acceptEdits"
+    | "bypassPermissions";
 }

diff --git a/handlers/chat.ts b/handlers/chat.ts
@@
-  const canUseTool = buildPermissionHandler();
-  const effectivePermissionMode = permissionMode ?? "bypassPermissions";
+  const canUseTool = buildPermissionHandler();
+  const effectivePermissionMode = permissionMode ?? "bypassPermissions";
@@
-        ...(permissionMode ? { permissionMode } : {}),
+        permissionMode: effectivePermissionMode,

diff --git a/handlers/chat.test.ts b/handlers/chat.test.ts
@@
-    it("should not include permissionMode in options when undefined", async () => {
+    it("should default permissionMode to 'bypassPermissions' when undefined", async () => {
@@
-      expect(queryCall.options).not.toHaveProperty("permissionMode");
+      expect(queryCall.options.permissionMode).toBe("bypassPermissions");
```

## 第三方接入建议

1. **无需传入 `permissionMode`** 时即可获得 bypass 行为；若需要计划或受控模式，可在请求体中显式设置。
2. 因为后端始终传递 `permissionMode`，第三方只需处理 `StreamResponse` 中的 `permission_request` 事件即可完成 UI 授权流程。
3. 若仍要支持自家自动化授权逻辑，可在自定义前端按需覆盖 `permissionMode`。

## 测试

- `npm test`
- 针对 `handlers/chat.test.ts` 的 `Permission Mode Parameter Handling` 新增案例已覆盖该逻辑。
