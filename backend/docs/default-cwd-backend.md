# 默认工作目录（后端）

> 当第三方前端未显式传入 `workingDirectory` 时，可通过启动参数指定统一的 Agent 执行目录。

## 使用场景

- 多项目部署：后端启动于固定目录，但希望默认在另一个仓库内运行 Claude Agent。
- SaaS 场景：不同实例需要指向不同租户的代码库，减少前端显式带路径的需求。

## 配置方式

1. **CLI 参数**：

   ```bash
   deno task dev -- --default-cwd /data/repos/foo
   # 或
   node cli/node.js --default-cwd /data/repos/foo
   ```

2. **环境变量**：

   ```bash
   DEFAULT_CWD=/data/repos/foo npm run dev-backend
   ```

## 生效顺序

1. 前端在 `/api/chat` 请求体中传入 `workingDirectory` 时 **最高优先**。
2. 启动参数 / 环境变量指定的 `defaultCwd` 在前端缺省时生效。
3. 若均未配置，则继续沿用“后端启动所在目录”作为 Claude Agent 的工作目录（保持旧行为）。

## 实现概览

- CLI 解析阶段新增 `--default-cwd` / `DEFAULT_CWD`，并写入 `AppConfig`。
- `createConfigMiddleware` 将 `defaultWorkingDirectory` 注入 `c.var.config`，所有 handler 均可访问。
- `handlers/chat.ts` 里，`chatRequest.workingDirectory ?? defaultWorkingDirectory` 会在调用 `query()` 前生成最终的 `cwd` 选项。

> 提示：若默认目录包含 `.claude/skills/`，可与 `docs/agent-sdk/skills.md` 中的技能加载能力配合使用。
