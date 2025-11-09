# 前端思考（Thinking）流式渲染指南

> 适用于需要在第三方前端实时展示 Claude 推理过程的场景。本文基于本项目最新改动，总结了思考内容的解码、状态管理与 UI 渲染要点，并附带参考代码 diff，便于对接其他框架时复用。

## 1. 启用前置条件

1. **后端需开启思考输出**：必须在运行后端时指定 `--max-thinking-tokens N` 或设置 `MAX_THINKING_TOKENS` 环境变量，详见后端文档《thinking-streaming-backend.md》。
2. **确保 SDK 推送 `content_block_delta`**：`handlers/chat.ts` 默认启用了 `includePartialMessages: true`，若第三方后端关闭该开关，将无法收到 `thinking_delta`。

## 2. 数据流处理要点

### 2.1 StreamingContext → ProcessingContext

`useStreamParser` 会把 `StreamingContext` 适配成 `ProcessingContext`，核心字段如下：

- `updateThinkingMessage`：用于定向更新当前思考气泡。
- `updateLastMessage(content, "thinking")`：兜底更新 UI，防止引用不一致带来的渲染缺失。

### 2.2 UnifiedMessageProcessor 逻辑

新增的思考流适配分为两部分：

1. **`handleThinkingDelta` 缓存**：把每个 `content_block_delta` 累加到 `thinkingStreamCache`，并在首次出现时 `addMessage`。
2. **`consumeThinkingStream` 匹配**：当最终 `assistant` 消息重复携带完整 `thinking` 字串时，优先匹配缓存；若 SDK 再次发送同内容，也会复用 `lastThinkingMessage` 直接覆盖。

此外，在 `processAssistantMessage` 中，如果 `thinking` 内容没有命中缓存但仍处于流模式，也会使用 `lastThinkingMessage` 更新，彻底避免重复气泡与缺失。

### 2.3 React 状态更新

`useChatState.updateThinkingMessage` 在 React 状态尚未挂载气泡时会先原地修改引用；一旦气泡被加入 `messages`，后续增量则通过不可变更新触发重渲染。

```diff
diff --git a/src/hooks/chat/useChatState.ts b/src/hooks/chat/useChatState.ts
@@
-  const updateThinkingMessage = useCallback(
-    (target: ThinkingMessage, content: string, timestamp = Date.now()) => {
-      let updatedMessage: ThinkingMessage = target;
 -
-      setMessages((prev) =>
-        prev.map((msg) => {
-          if (msg === target && msg.type === "thinking") {
-            updatedMessage = {
-              ...msg,
-              content,
-              timestamp,
-            } as ThinkingMessage;
-            return updatedMessage;
-          }
-
-          return msg;
-        }),
-      );
-
-      return updatedMessage;
-    },
-    [],
-  );
+  const updateThinkingMessage = useCallback(
+    (target: ThinkingMessage, content: string, timestamp = Date.now()) => {
+      let updatedMessage: ThinkingMessage = target;
+      let found = false;
+
+      setMessages((prev) =>
+        prev.map((msg) => {
+          if (msg === target && msg.type === "thinking") {
+            found = true;
+            updatedMessage = {
+              ...msg,
+              content,
+              timestamp,
+            } as ThinkingMessage;
+            return updatedMessage;
+          }
+
+          return msg;
+        }),
+      );
+
+      if (!found) {
+        target.content = content;
+        target.timestamp = timestamp;
+        updatedMessage = target;
+      }
+
+      return updatedMessage;
+    },
+    [],
+  );
```

## 3. UI 展示规范

- `ThinkingMessageComponent` 使用 `CollapsibleDetails` 并默认展开；为了实时更新内容，在 `CollapsibleDetails` 内部会依据 `details` 重新渲染，无需额外操作。
- 若希望在第三方前端折叠思考内容，可复用 `CollapsibleDetails` 的实现思路：**不要** 单独创建新的 DOM 节点，只需更新现有 `<pre>` 文本，避免多余气泡。

## 4. 集成避坑指南

1. **务必复用引用**：保持“当前思考消息”引用（如 `lastThinkingMessage`）并集中更新，而不是每个增量都 `push` 新消息。
2. **防止状态不同步**：在 React 状态仍未插入思考消息时，先在本地对象上更新字段，可避免“第一段显示，后续丢失”的问题。
3. **确保 fallback**：就算上两步都做了，也要调用 `updateLastMessage(content, "thinking")` 当作兜底，避免因引用失效导致 UI 不更新。
4. **监听 `message_start`**：每轮对话开始前要 `resetThinkingStreams()`，否则后续轮次会复用旧缓存重放历史思考。
5. **处理重复 `assistant` 消息**：SDK 可能连续发送多条带 `thinking` 的 `assistant` 消息，经由 `consumeThinkingStream` + `lastThinkingMessage` 即可无痛复用。

## 5. 第三方前端迁移步骤

1. 按照本文提供的 diff 更新本地状态管理与流式解析逻辑。
2. 确保后端接口负责开启 `maxThinkingTokens` 并返回 `stream_event`。
3. 在 UI 层只保留一条“思考”气泡，所有增量都复用它。
4. 为了兼容历史记录，`processMessagesBatch` 仍会一次性生成完整的 `thinking` + `assistant`，无需额外操作。

通过以上步骤，即可在任何 React/非 React 前端中获得与官方 Web UI 一致的思考流式展示体验。
