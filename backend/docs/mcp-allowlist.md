## MCP 白名单启动参数

后端默认会加载用户级（`~/.claude/settings*.json`）与项目级（`.claude/settings*.json`）中配置的全部 MCP。某些场景下只想指定“允许加载的”服务，可以在启动命令里追加 `--allowed-load-mcp-servers` 参数：

```bash
# Deno
deno task dev -- --allowed-load-mcp-servers playwright,chrome-mcp-server

# Node.js
node cli/node.js --allowed-load-mcp-servers playwright chrome-mcp-server
```

该参数支持逗号分隔或通过空格重复传入多个名称。启用后，后端会在调用 `claude` CLI 时注入额外的 `--settings`，强制 `enableAllProjectMcpServers=false`，并把 `enabledMcpjsonServers` 设置为提供的白名单。这样来自用户 / 项目级设置文件的 MCP 只有在列表中的名字才会被加载，其它 MCP 将保持禁用。

不传该参数时维持现状，继续加载所有 MCP 配置。
