# 流式输入输出适配（前端）

> 本文总结了 Web UI 为适配后端真实流式输出所做的改动，并给出第三方前端接入建议。

## 背景

- 旧实现逐行拆分 NDJSON，`stream_event` 会独立成气泡。
- 完整 `assistant` 消息到达后又追加一条气泡，造成重复。
- 缺少“当前助理消息”引用，无法对同一个气泡做增量更新。

## 核心改动

### 1. ChatPage：流式解码 + 缓冲

`src/components/ChatPage.tsx` 现使用 `TextDecoder.decode(chunk, { stream: true })` 叠加缓冲，并在读取完成或请求结束后再处理尾部残留，确保分包 JSON 不会被截断。

```ts
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

const flushBuffer = () => {
  let idx = buffer.indexOf("\n");
  while (!shouldAbort && idx !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) processStreamLine(line, streamingContext);
    idx = buffer.indexOf("\n");
  }
};

while (true) {
  const { done, value } = await reader.read();
  if (!shouldAbort && value) {
    buffer += decoder.decode(value, { stream: !done });
    flushBuffer();
  }
  if (done || shouldAbort) break;
}

if (!shouldAbort) {
  buffer += decoder.decode();
  flushBuffer();
}
```

### 2. ChatPage：暴露当前助理引用

通过 `useRef` + 包装后的 `setCurrentAssistantMessage`，`StreamingContext` 可随时读取/更新“当前助理气泡”。

```ts
const currentAssistantMessageRef = useRef(currentAssistantMessage);
useEffect(() => {
  currentAssistantMessageRef.current = currentAssistantMessage;
}, [currentAssistantMessage]);

const streamingContext: StreamingContext = {
  currentAssistantMessage: currentAssistantMessageRef.current,
  getCurrentAssistantMessage: () => currentAssistantMessageRef.current,
  setCurrentAssistantMessage: (msg) => {
    currentAssistantMessageRef.current = msg;
    setCurrentAssistantMessage(msg);
  },
  ...
};
```

### 3. UnifiedMessageProcessor：专门处理 `stream_event`

`processStreamEvent()` 识别 `content_block_delta` 并复用 `handleAssistantText()`。若当前没有助理气泡，先创建再增量更新；若已有，则只调用 `updateLastMessage()`，避免重复气泡。

### 4. useStreamParser：消息分流

`claude_json` 行被解析成 `ClaudeSDKMessage`。当 `type === "stream_event"` 时调用 `processStreamEvent`；否则回退到 `processMessage`。

### 5. 类型与测试

- `src/types.ts` 新增 `SDKStreamEventMessage`、`ClaudeSDKMessage` 以表征联合类型。
- `useStreamParser.test.ts` 覆盖增量文本、重复抑制、Plan 混合等关键场景。

## 第三方前端接入要点

1. **解码策略**：采用 `TextDecoder` streaming 模式 + buffer，完整行后再 `JSON.parse`。
2. **状态引用**：维护一个“当前助理气泡”引用，`stream_event` 仅更新该引用与最后一条消息。
3. **消息分流**：
   - `stream_event` → 增量文本/工具进度。
   - `assistant` → 终稿，通常只做收尾和 metadata 更新。
   - `result/system` → 展示执行结果、耗时等。
4. **重复抑制**：如果引用已有内容，勿再次 `addMessage`；只需 `updateLastMessage` 或更新引用。
5. **UX 提示**：可在引用为空时展示“打字动画”，`result`/`done` 到达后关闭。
6. **历史记录**：历史 API 仍返回完整 `TimestampedSDKMessage[]`，不会包含 `stream_event`，渲染逻辑可保持旧版。

> 遵循“解码缓冲 + 助理引用 + 类型分流”三步，任何前端框架都能复刻当前 Web UI 的流式体验。
