# AutoBA 项目筛选（后端）

> 目标：只返回 `cwd` 以指定 AutoBA 前缀开头的项目，从而让 `{uid}/{sessionId}` 组合在 AutoBA 系统内保持唯一。

## 配置 AutoBA CWD 前缀

AutoBA 的工作目录形如 `{autobaCwd前缀}/{uid}/{sessionId}/`。后端通过配置项维护若干前缀，只对这些路径进行 AutoBA 匹配。

1. **CLI 参数（可重复传入）**

   ```bash
   node cli/node.js \
     --autoba-cwd-prefix /data/autoba \
     --autoba-cwd-prefix /mnt/backup/autoba
   ```

2. **环境变量**：`AUTOBA_CWD_PREFIXES` 支持 JSON 数组或逗号分隔字符串。

   ```bash
   AUTOBA_CWD_PREFIXES='["/data/autoba","/mnt/backup/autoba"]' npm run dev
   # 或
   AUTOBA_CWD_PREFIXES="/data/autoba,/mnt/backup/autoba" npm run dev
   ```

若 CLI 与环境变量同时定义，以 CLI 为准。未配置时视为普通 Claude 项目列表。

## API 使用方式

- `GET /api/projects`：保持兼容，返回全部项目。
- `GET /api/projects?isAutoBA=true`：只返回 `cwd` 以任一 AutoBA 前缀开头的项目。如果当前没有配置前缀，则返回空数组。

查询参数支持 `isAutoBA=true` 或 `isAutoBA=1` 的布尔语义。

## 实现要点

- `cli/args.ts` 解析 CLI/环境变量并写入 `AppConfig.autobaCwdPrefixes`。
- `handlers/projects.ts` 将 `isAutoBA` 查询参数与前缀列表结合，过滤 `.claude.json` 中的项目路径。
- 比较逻辑会统一分隔符、兼容有/无结尾斜杠，确保 Windows 与 POSIX 路径都能正确匹配。
