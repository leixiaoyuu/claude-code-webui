# 后端启用思考（Thinking）流式输出指南

> 本文总结如何在 Claude Code Web UI 后端开启推理内容的流式推送、并向第三方前端正确暴露 `thinking_delta`。适合希望自研 UI 或 SDK 的团队参考。

## 1. 能力概览

- 通过 `@anthropic-ai/claude-agent-sdk` 的 `maxThinkingTokens` 选项，允许 Claude 在回答前输出推理过程。
- `/api/chat` 保持 NDJSON 协议不变，但当 `includePartialMessages: true` 且 `maxThinkingTokens > 0` 时，会额外推送 `type === "stream_event"`、`event.delta.type === "thinking_delta"` 的增量消息。
- 前端可据此实现单条思考气泡的实时刷新。

## 2. 启用方法

### 2.1 CLI / 环境变量

```bash
# 命令行
claude-code-webui --max-thinking-tokens 2048

# 或环境变量
MAX_THINKING_TOKENS=2048 claude-code-webui
```

- 设为 **0 或不设置**：等同关闭推理输出，依旧只返回最终回答。
- 建议根据成本/延迟选择 1024~4096 之间的值；越大代表允许模型使用更多思考 token。

### 2.2 配置注入

`cli/args.ts` 解析 `--max-thinking-tokens` 与 `MAX_THINKING_TOKENS`，随后通过 `createApp` 注入到 Hono `context` 中：

```diff
diff --git a/cli/args.ts b/cli/args.ts
@@
 export interface ParsedArgs {
   debug: boolean;
   port: number;
   host: string;
   claudePath?: string;
+  maxThinkingTokens?: number;
 }
+function parsePositiveInteger(value: string, label: string): number { ... }
@@
     .option(
       "--max-thinking-tokens <number>",
       "Maximum tokens Claude can spend on thinking (enables reasoning deltas)",
       (value) => parsePositiveInteger(value, "max thinking tokens"),
     );
@@
   const thinkingEnv = getEnv("MAX_THINKING_TOKENS");
   const envThinkingTokens = thinkingEnv ? parsePositiveInteger(...) : undefined;
@@
   return {
     ...,
     maxThinkingTokens: options.maxThinkingTokens ?? envThinkingTokens,
   };
```

在 `cli/node.ts` / `cli/deno.ts` 中转交 `createApp`：

```diff
diff --git a/cli/node.ts b/cli/node.ts
@@
  const app = createApp(runtime, {
    debugMode: args.debug,
    staticPath,
    cliPath,
+    maxThinkingTokens: args.maxThinkingTokens,
  });
```

`AppConfig` 与 `createConfigMiddleware` 相应新增 `maxThinkingTokens`，供所有 handler 访问。

## 3. 向 SDK 透传

`handlers/chat.ts` 中的 `executeClaudeCommand` 会读取 `maxThinkingTokens` 并传入 `query()`：

```diff
diff --git a/handlers/chat.ts b/handlers/chat.ts
@@
 async function* executeClaudeCommand(..., cliPath: string, maxThinkingTokens?: number, ...) {
@@
    for await (const sdkMessage of query({
      prompt: promptStream,
      options: {
        ...,
        includePartialMessages: true,
+        ...(typeof maxThinkingTokens === "number"
+          ? { maxThinkingTokens }
+          : {}),
        ...(canUseTool ? { canUseTool } : {}),
      },
    })) {
```

`handleChatRequest` 将从 `c.var.config` 里取出 `maxThinkingTokens`，因此任何路由调用都自动继承。

## 4. 集成避坑指南

1. **务必同时开启 `includePartialMessages`**：否则 SDK 不会推送 `thinking_delta`，即便传了 `maxThinkingTokens` 也只会得到最终回答。
2. **注意命令行覆盖逻辑**：`--max-thinking-tokens` 优先级高于环境变量，若传非法值会在解析阶段直接抛错。
3. **Hono 中间件注入**：自定义 handler 若未通过 `createConfigMiddleware`，就无法读取 `maxThinkingTokens`。确保所有 API 都在 `createApp` 注册之后运行。
4. **权限模式兼容**：思考输出与 `permissionMode` 无关；即使启用 Plan 模式或 Bypass，也能同时工作。
5. **对接第三方前端**：前端只需监听 `claude_json` 中 `type === "stream_event"` 的行，`event.delta.type === "thinking_delta"` 即为增量文本，`event.index` 表示当前思考块编号。

## 5. 参考行为

启用思考后，后端日志会看到如下条目：

```
debug chat Claude SDK Message: {
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0,
           delta: { type: 'thinking_delta', thinking: '用户让我…' } },
  session_id: 'xxx',
  ...
}
```

随后仍会下发完整的 `assistant` + `result`，无需额外处理。

通过上述步骤，第三方后端即可与本项目保持一致的推理流式输出体验，供任意 UI/SDK 消费。
