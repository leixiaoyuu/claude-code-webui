# 流式输入输出增强（后端）

> 适用于希望直接复用 /api/chat 接口、或基于 @anthropic-ai/claude-agent-sdk 构建自定义中间层的第三方前端。本文详细说明了最新的流式输入输出变更，并给出对接指引。

## 背景

- 旧实现只向 `query()` 传入字符串 prompt，导致 SDK 自动切换成 **Single Message Input**，无法真正流式地向 Claude Code 发送多段消息。
- SDK 默认不会推送 `stream_event`（partial assistant）消息，前端只能等完整回答返回后一次性渲染。
- 权限弹窗等结构在 shared 层与 SDK 类型不完全一致，第三方前端兼容成本高。

## 行为变化概览

1. **输入改为 AsyncIterable**：后端始终用 `AsyncGenerator<SDKUserMessage>` 驱动 Claude，会话在第一条消息发出前即可开始流式处理。
2. **强制开启 `includePartialMessages`**：SDK 会源源不断推送 `stream_event`，前端可即时渲染字粒级别的文本。
3. **NDJSON 保持兼容**：`/api/chat` 仍返回 `application/x-ndjson`，但 `claude_json` 行现在可能包含 `stream_event`。
4. **权限建议裁剪**：只透出 `allow/deny`，防止 SDK 自带的 `ask` 行为污染 shared 类型。

## Thinking 推理流配置

- Claude Agent SDK 只有在 `maxThinkingTokens > 0` 时才会推送 `thinking_delta`；否则推理阶段直接被跳过，前端无法展示。
- 现在可通过 CLI 或环境变量配置：
  - 命令行：`--max-thinking-tokens 2048`
  - 环境变量：`MAX_THINKING_TOKENS=2048`
- 后端会把该值透传给 `query()`，确保 `UnifiedMessageProcessor` 能收到推理增量并实时更新 UI。
- 设置为 `0` 或未设置则等同关闭推理输出，可根据成本需求自由切换。

## 关键实现片段

### 1. 流式输入 + Partial 输出

```diff
@@ handlers/chat.ts
-    for await (const sdkMessage of query({
-      prompt: processedMessage,
+    const promptStream = createStreamingPrompt(processedMessage);
+
+    for await (const sdkMessage of query({
+      prompt: promptStream,
       options: {
         ...
-        settingSources: DEFAULT_SETTING_SOURCES,
-        permissionMode: effectivePermissionMode,
+        settingSources: DEFAULT_SETTING_SOURCES,
+        permissionMode: effectivePermissionMode,
+        includePartialMessages: true,
         ...(canUseTool ? { canUseTool } : {}),
       },
     })) {
```

`createStreamingPrompt()` 会把纯文本用户输入包装成符合 SDK 规范的 `SDKUserMessage`：

```ts
const userMessage: SDKUserMessage = {
  type: "user",
  session_id: "",
  parent_tool_use_id: null,
  message: {
    role: "user",
    content: [{ type: "text", text: message }],
  },
};
```

### 2. 权限建议裁剪

```diff
@@ handlers/chat.ts
 const normalized = suggestions
   .filter(isSupportedSuggestion)
-  .map((suggestion) => ({ ...suggestion })) as SharedPermissionUpdate[];
+  .map((suggestion) => suggestion as SharedPermissionUpdate);

return normalized.length ? normalized : undefined;
```

`isSupportedSuggestion()` 仅允许 `behavior` 为 `allow | deny` 的规则流出，避免 SDK 新增的 `ask` 破坏 shared 枚举。

### 3. 测试更新

`handlers/chat.test.ts` 增加 `getLatestQueryCall()`、`readPromptContent()` 等工具，确保：

- prompt 确实是 `AsyncIterable`
- `includePartialMessages` 恒为 `true`
- 旧有的 `permissionMode / abortController / resume` 等参数依然按预期传递

## NDJSON 协议（更新版）

| 行 `type`           | 描述                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `claude_json`       | SDK 原始消息。除 `system/assistant/user/result` 外，**新增** `stream_event` |
| `permission_request`| 与旧版一致，由共享类型统一定义                                       |
| `error`             | 终止错误                                                             |
| `aborted`           | 用户主动取消                                                         |
| `done`              | 正常结束                                                             |

`stream_event` 结构示例：

```json
{
  "type": "claude_json",
  "data": {
    "type": "stream_event",
    "session_id": "sess-123",
    "event": {
      "type": "content_block_delta",
      "delta": { "type": "text_delta", "text": "我来" }
    }
  }
}
```

## 第三方集成指引

1. **输入**：向 `query()` 传入 `AsyncIterable<SDKUserMessage>`，每个 `yield` 对应一条用户消息；可在生成器里等待用户输入或 UI 事件。
2. **必选参数**：务必转发/继承 `includePartialMessages: true` 与 `abortController`，否则 `stream_event` 不会被推送。
3. **输出解析**：
   - 继续按行读取 NDJSON；
   - 若 `type === "claude_json"` 且 `data.type === "stream_event"`，从 `event.delta` 中提取 `text_delta` 或其他增量类型；
   - 仍要处理 `assistant/result/system` 等完整消息，用于最终收尾。
4. **权限流**：
   - 只会收到 `allow/deny` 建议；
   - 若 SDK 后续增加字段，只需在 shared 类型扩展后端过滤器即可保持兼容。
5. **兼容旧前端**：若旧前端尚未支持 `stream_event`，可临时忽略（直接 `continue`）；最终只会在完整 `assistant` 消息到来时看到完整内容。

## 常见问题

- **为什么 `session_id` 在 prompt 中为空？** SDK 会在 `stream_event`/`assistant` 中返回真实 `session_id`，前端应以响应为准。
- **能否发送多条输入？** 可以。`AsyncGenerator` 支持在用户下一次操作时再 `yield`，SDK 会自动排队。
- **是否需要额外的 keep-alive？** 不需要，只要消费 NDJSON 流即可，Hono + Node 会自动 flush。

> 建议第三方在引入时同时参考 `docs/agent-sdk/streaming-vs-single-mode.md`，以理解 SDK 的 Streaming Input 模式细节。
