# bypassPermissions 模式前端整合说明

> 指南：如何在第三方前端沿用本项目的 bypass 权限体验，并理解必要的 API／UI 改动。

## 目标

- 从页面加载起即以 `permissionMode = "bypassPermissions"` 与后端互动，避免多余授权提示。
- 仍保留切换至 `default`、`plan`、`acceptEdits` 的能力，供精细控制。

## 主要变更

1. **类型统一** `src/types.ts`
   - `PermissionMode` 增加 `"bypassPermissions"`，`fromSDKPermissionMode` 不再强制回落。
2. **状态管理** `usePermissionMode`
   - 默认值改为 `bypassPermissions`，并提供 `isBypassMode` 便于 UI 呈现。
3. **输入面板** `ChatInput`
   - 指示条新增图示与显示文字，循环顺序改为 `bypass → default → plan → acceptEdits`。
4. **Demo 与 Mock**
   - `DemoPage` 以及 `mockResponseGenerator`、`useClaudeStreaming.test.ts` 皆改用 bypass，确保教学／测试一致。
5. **测试**
   - `usePermissionMode.test.ts` 等单测同步调整预期值。

## 代表性差异片段

```diff
diff --git a/src/types.ts b/src/types.ts
@@
-export type PermissionMode = "default" | "plan" | "acceptEdits";
+export type PermissionMode =
+  | "default"
+  | "plan"
+  | "acceptEdits"
+  | "bypassPermissions";
@@
-  // Filter out bypassPermissions for UI
-  return sdkMode === "bypassPermissions" ? "default" : sdkMode;
+  return sdkMode as PermissionMode;

diff --git a/src/hooks/chat/usePermissionMode.ts b/src/hooks/chat/usePermissionMode.ts
@@
-  const [permissionMode, setPermissionModeState] =
-    useState<PermissionMode>("default");
+  const [permissionMode, setPermissionModeState] =
+    useState<PermissionMode>("bypassPermissions");
@@
   return {
     permissionMode,
     setPermissionMode,
     isPlanMode: permissionMode === "plan",
     isDefaultMode: permissionMode === "default",
     isAcceptEditsMode: permissionMode === "acceptEdits",
+    isBypassMode: permissionMode === "bypassPermissions",
   };

diff --git a/src/components/chat/ChatInput.tsx b/src/components/chat/ChatInput.tsx
@@
-    const modes: PermissionMode[] = ["default", "plan", "acceptEdits"];
+    const modes: PermissionMode[] = [
+      "bypassPermissions",
+      "default",
+      "plan",
+      "acceptEdits",
+    ];
```

## 第三方整合步骤

1. **采用共享类型**：确保前端 `PermissionMode` 与后端 `ChatRequest.permissionMode` 一致，推荐直接引用 `shared/types.ts` 或复制上述定义。
2. **默认 bypass**：初始化状态时就设为 `bypassPermissions`，并在发送消息时直接传入；若需要显示切换，可沿用本项目的 `getNextPermissionMode` 流程。
3. **UI 提示**：在输入框下方或设置区显示当前模式，方便用户切换；可参考 `ChatInput` 的 emoji 指示条设计。
4. **Demo／测试**：若提供展示页或单元测试，请确保模拟数据 (`SDKMessage.permissionMode`) 改为 `bypassPermissions`，否则可能与实际输出不符。

## 测试

- `npm run test -- --run`
  - 其中 `usePermissionMode.test.ts`、`useClaudeStreaming.test.ts`、`PlanPermissionInputPanel.test.tsx` 等皆覆盖新默认值。

## 推荐做法

- 若前端期望在部分操作中重新启用计划模式，可在发送消息时传入覆盖值，例如 `sendMessage(text, tools, false, "plan")`。
- 若要保留用户偏好，可将 `permissionMode` 存于 `localStorage` 或 URL Query，再传递给 `usePermissionMode` 以决定初始值。
