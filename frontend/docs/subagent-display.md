# Subagent 消息展示整合指南

本指南说明了当后端通过 `Task` 工具自动调用子代理 (subagent) 时，Claude Code Web UI 前端如何对消息流进行解析与展示，并包含本次增强的关键代码 diff 与亮色主题样式建议，便于第三方前端集成时对齐行为。

## 0. 变更概览与关键 diff

- **新增类型**：`SubagentMessage` 用于承载任务描述、模型、子代理标识、方向等元数据。
- **消息解析**：在 `UnifiedMessageProcessor` 中缓存 `Task` 工具调用，并在处理含 `parent_tool_use_id` 的 `user` 消息时生成 `subagent` 气泡。
- **渲染组件**：`SubagentMessageComponent` 提供独立气泡样式并左对齐。

核心 diff（节选自 `frontend` 仓库）：

```diff
diff --git a/src/types.ts b/src/types.ts
@@
+export interface SubagentMessage {
+  type: "subagent";
+  variant: "request" | "response";
+  toolUseId: string;
+  toolName: string;
+  content: string;
+  timestamp: number;
+  subagentName?: string;
+  taskDescription?: string;
+  model?: string;
+}

diff --git a/src/utils/UnifiedMessageProcessor.ts b/src/utils/UnifiedMessageProcessor.ts
@@
+  private createSubagentTaskMessage(...) {
+    if (!parentToolUseId || !toolInfo || toolInfo.name !== "Task") {
+      return null;
+    }
+    ... // 读取 description/subagent_type/model 并生成 SubagentMessage
+  }

+  private processUserMessage(...) {
+    const delegatedMessage = this.createSubagentTaskMessage(...);
+    if (delegatedMessage) {
+      localContext.addMessage(delegatedMessage);
+    } else {
+      // 回退到普通用户消息
+    }
+  }

diff --git a/src/components/MessageComponents.tsx b/src/components/MessageComponents.tsx
@@
+export function SubagentMessageComponent({ message }: SubagentMessageComponentProps) {
+  return (
+    <MessageContainer alignment="left" colorScheme="bg-cyan-50/90 ...">
+      {/* 顶部方向标签 + 子代理名称 + 时间戳 */}
+      {/* 中部任务描述/正文 */}
+      {/* 底部徽章展示 tool/model/agent id */}
+    </MessageContainer>
+  );
+}

diff --git a/src/components/chat/ChatMessages.tsx b/src/components/chat/ChatMessages.tsx
@@
+  } else if (isSubagentMessage(message)) {
+    return <SubagentMessageComponent key={key} message={message} />;
```

Vitest 新增用例 `"creates a styled subagent message when Task tool delegates work"`，用于验证解析逻辑。

## 1. 数据流概览

1. 主 Agent 在 `assistant` 消息中输出 `type: "tool_use"` 且 `name: "Task"` 的内容，并附带：
   - `description`: 任务描述。
   - `subagent_type`: 子代理标识。
   - `model`: 可选的模型名称。
2. Claude SDK 随后会推送一条 `user` 消息，其 `parent_tool_use_id` 指向上述 `tool_use.id`：
   - `content` 若为 `text`，表示主 Agent 给子代理的请求文案。
   - `content` 若为 `tool_result`，表示子代理的响应结果。
3. 若子代理返回结构化结果，Claude SDK 仍使用 `user` 消息承载，需要依赖 `parent_tool_use_id` 来区分普通用户输入与子代理往返内容。

## 2. 前端识别逻辑

整合时建议实现以下步骤：

- **缓存 Task 工具调用**：在解析 `assistant` 消息时，记录 `tool_use.id → { name, input }`。仅当 `name === "Task"` 时视为子代理调用。
- **匹配 parent_tool_use_id**：当收到 `user` 消息，若其 `parent_tool_use_id` 命中缓存，说明该消息属于子代理会话。
- **区分方向**：
  - 当 `message.role === "user"` 且为文本：表示主 Agent 发送给子代理的请求，可渲染为 “Claude → Subagent”。
  - 当同一 `parent_tool_use_id` 下的 `user` 消息包含 `tool_result` 或文本回写，则表示子代理返回内容，即 “Subagent → Claude”。
- **保留上下文字段**：可从缓存中读取 `description`、`subagent_type`、`model`，用于展示任务标签、子代理名称与模型信息。

## 3. UI 展示建议（含亮色主题）

- **独立气泡类型**：为子代理往返消息定义单独样式，避免与真实用户输入混淆。官方前端采用浅青色系、圆角、徽章标签，并左对齐以贴近工具/系统消息。
- **信息层级**：建议在气泡顶部展示：
  - `Subagent · <subagent_type>` 或友好名称。
  - 方向标签：`Claude → Subagent` / `Subagent → Claude`。
  - 时间戳。
- **附加元数据**：在底部徽章区展示任务描述摘要、模型、tool 名称(如 `Task`)等，方便排查。
- **可折叠详情**：若子代理回复较长，可复用现有折叠组件或 monospace 文本以保持一致性。

## 4. 示例事件顺序

```text
assistant message
 └─ content[0]: { type: "tool_use", id: "tool_x", name: "Task", input: { description, subagent_type, model } }

user message (parent_tool_use_id = "tool_x")
 └─ content[0]: { type: "text", text: "用户想问今天深圳的天气…" }

user message (parent_tool_use_id = "tool_x")
 └─ content[0]: { type: "tool_result", content: [{ type: "text", text: "今天深圳下雨" }] }

assistant message
 └─ content: Claude 将结果返回终端用户
```

前端应将两条 `user` 消息渲染为子代理气泡：第一条标记为请求，第二条标记为响应。

## 5. 兼容性提示

- 若未实现该逻辑，子代理请求/响应将被误判为终端用户输入，从而在 UI 中出现蓝色 User 气泡。
- 对历史记录/批量消息同样适用：请在批处理时先构建 `tool_use` 缓存，再解析 `user` 消息。
- 若未来支持多子代理并发，需根据 `parent_tool_use_id` 区分不同任务，避免状态覆盖。

通过上述约定，第三方前端即可正确识别 Claude Agent SDK 中的子代理调用语义，并提供清晰、一致的交互展示。
- **亮色主题配色参考**：
  - 背景：`bg-cyan-50/90` (Hex #ECFEFF) 或 `#E0FBFC`，营造轻盈玻璃态。
  - 边框：`border-cyan-200/70` (Hex #A5F3FC)；在 hover/active 时可加深至 #67E8F9。
  - 文本：主色 `#0E7490`，辅助说明 `#0891B2`。
  - 标签徽章：白底 (`rgba(255,255,255,0.85)`) + 细边 + `text-cyan-600`，凸显任务方向。
  - 图标：简洁几何 (如 ✳︎ 或 🔁) + 渐变投影 `rgba(6,182,212,0.15)`，保持清新质感。

针对暗色主题，可将背景调整为 `dark:bg-cyan-900/25`、文字采用 `#E0FBFC`，其余色值按 60% 亮度比例下调即可。
