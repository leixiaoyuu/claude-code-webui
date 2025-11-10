# TRP Sync - Node.js 版本

基于 Python 版本的 `trp_sync.py` 重写的 Node.js 版本，支持增量/全量同步和定时任务。

## 功能特性

- ✅ 完全兼容 Python 版本的所有功能
- ⏰ 支持定时轮询（默认每分钟一次）
- 🔄 支持增量同步和全量同步
- 📁 自动配置目标文件夹路径
- 🚀 一键启动开发服务器 + 定时同步

## 快速使用

### 1. 初始化配置
```bash
npm run trp-sync:init
```

### 2. 一键启动（推荐）
```bash
npm run dev:trp -- --max-thinking-tokens 2048 --default-cwd /Users/xiaoyu/Desktop/next-aotuba/data/workspaces/lxy3 --autoba-cwd-prefix /Users/xiaoyu/Desktop/next-aotuba/data
```

**这个命令会同时**：
- 自动更新 TRP Sync 配置的 `targetFolder`
- 启动开发服务器
- 启动定时同步任务

### 3. 单独使用

#### 一次性同步
```bash
npm run trp-sync:sync
```

#### 启动定时同步
```bash
npm run trp-sync:scheduler
```

#### 停止定时同步
```bash
npm run trp-sync:stop
```

#### 查看配置状态
```bash
npm run trp-sync -- status
```

## 配置文件

配置文件位置：`trp-sync-config.json`

```json
{
  "baseUrl": "http://your-server:port",
  "workspaceSn": "your-workspace",
  "versionIid": "your-version-id",
  "targetFolder": "/path/to/knowledge-base/trp-docs",
  "scheduler": {
    "enabled": true,
    "intervalMinutes": 1,
    "runImmediately": true
  }
}
```

## 核心命令

| 命令 | 功能 |
|------|------|
| `npm run trp-sync:init` | 初始化配置文件 |
| `npm run trp-sync:sync` | 执行一次文档同步 |
| `npm run trp-sync:scheduler` | 启动定时同步 |
| `npm run trp-sync:stop` | 停止定时同步 |
| `npm run dev:trp` | 启动开发服务器 + 定时同步 |
| `npm run trp-sync -- status` | 查看同步状态 |

## 文件结构

```
backend/
├── trp-sync/               # TRP Sync 目录
│   ├── trp-sync.js         # 核心同步逻辑
│   ├── trp-sync-cli.js     # 命令行接口
│   ├── dev-with-trp-sync.js # 集成启动脚本
│   ├── trp-sync-config.json# 配置文件
│   └── TRP-SYNC-README.md  # 这个说明文档
├── package.json            # 包含 TRP Sync 依赖和脚本
```