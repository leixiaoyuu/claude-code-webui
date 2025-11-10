# TRP Sync API 接口文档

TRP同步API提供了通过HTTP接口触发TRP文档同步的功能，支持创建同步任务、查询任务状态等操作。

## 基础信息

- **Base URL**: `http://localhost:22080`
- **Content-Type**: `application/json`
- **认证方式**: Token认证（通过请求体传递）

## API端点

### 1. 创建同步任务

**POST** `/api/trp-sync/sync`

创建一个新的TRP文档同步任务，任务将异步执行。

#### 请求参数

```json
{
  "baseUrl": "http://10.22.1.93:12090",     // 必需: TRP服务器地址
  "workspaceSn": "HZ4KTTD",                // 必需: 工作空间编号
  "versionIid": "68b1413f5c5d708b0d738131", // 必需: 版本ID
  "token": "sunline",                      // 必需: 认证令牌
  "targetFolder": "/tmp/test-trp",         // 必需: 目标文件夹路径
  "concurrency": 10,                       // 可选: 并发数，默认10
  "useOrderPrefix": false,                 // 可选: 是否使用序号前缀，默认false
  "incremental": true,                     // 可选: 是否增量同步，默认true
  "fromTime": null,                        // 可选: 起始时间戳
  "overwrite": false                       // 可选: 是否覆盖已存在文件，默认false
}
```

#### 响应示例

**成功响应** (200 OK):
```json
{
  "taskId": "sync_1762770379669_qnwoltxk5",
  "status": "pending",
  "message": "同步任务已创建并开始执行"
}
```

**错误响应** (400 Bad Request):
```json
{
  "error": "缺少必需参数",
  "details": "必需参数: baseUrl, workspaceSn, versionIid, targetFolder"
}
```

**错误响应** (500 Internal Server Error):
```json
{
  "error": "创建同步任务失败",
  "details": "具体的错误信息"
}
```

### 2. 获取所有同步任务

**GET** `/api/trp-sync/tasks`

获取所有同步任务的列表和状态信息。

#### 响应示例

**成功响应** (200 OK):
```json
{
  "tasks": [
    {
      "taskId": "sync_1762770379669_qnwoltxk5",
      "status": "completed",
      "progress": {
        "total": 0,
        "success": 0,
        "errors": 0,
        "skipped": 0
      },
      "startTime": "2025-11-10T10:26:19.669Z",
      "endTime": "2025-11-10T10:26:39.093Z",
      "config": {
        "baseUrl": "http://10.22.1.93:12090",
        "workspaceSn": "HZ4KTTD",
        "versionIid": "68b1413f5c5d708b0d738131",
        "targetFolder": "/tmp/test-trp",
        "incremental": true
      }
    }
  ]
}
```

### 3. 获取特定任务状态

**GET** `/api/trp-sync/tasks/:taskId`

获取指定同步任务的详细状态信息。

#### 路径参数

- `taskId` (string, 必需): 任务ID

#### 响应示例

**成功响应** (200 OK):
```json
{
  "taskId": "sync_1762770379669_qnwoltxk5",
  "status": "completed",
  "progress": {
    "total": 0,
    "success": 0,
    "errors": 0,
    "skipped": 0
  },
  "startTime": "2025-11-10T10:26:19.669Z",
  "endTime": "2025-11-10T10:26:39.093Z",
  "config": {
    "baseUrl": "http://10.22.1.93:12090",
    "workspaceSn": "HZ4KTTD",
    "versionIid": "68b1413f5c5d708b0d738131",
    "targetFolder": "/tmp/test-trp",
    "incremental": true
  }
}
```

**错误响应** (404 Not Found):
```json
{
  "error": "任务不存在"
}
```

## 任务状态说明

任务可能处于以下状态之一：

- **pending**: 任务已创建，等待执行
- **running**: 任务正在执行中
- **completed**: 任务已成功完成
- **failed**: 任务执行失败

## 使用示例

### 使用 curl 创建同步任务

```bash
curl -X POST http://localhost:22080/api/trp-sync/sync \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "http://10.22.1.93:12090",
    "workspaceSn": "HZ4KTTD",
    "versionIid": "68b1413f5c5d708b0d738131",
    "token": "sunline",
    "targetFolder": "/tmp/test-trp",
    "incremental": true
  }'
```

### 使用 curl 查询任务状态

```bash
# 获取所有任务
curl http://localhost:22080/api/trp-sync/tasks

# 获取特定任务状态
curl http://localhost:22080/api/trp-sync/tasks/sync_1762770379669_qnwoltxk5
```

### 使用 Postman

1. 创建新的HTTP请求
2. 设置请求方法为 `POST`
3. URL设置为 `http://localhost:22080/api/trp-sync/sync`
4. 在Headers中添加 `Content-Type: application/json`
5. 在Body中选择 `raw` 和 `JSON` 格式，输入请求参数
6. 点击发送按钮

## 注意事项

1. **token认证**: 必须提供正确的token参数，否则会返回401认证错误
2. **目标文件夹**: 确保目标文件夹存在且有写入权限
3. **异步执行**: 任务创建后会异步执行，需要通过查询接口获取执行结果
4. **内存存储**: 当前任务信息存储在内存中，重启服务会丢失历史任务数据
5. **并发控制**: 默认并发数为10，可根据需要调整

## 错误处理

API会返回以下HTTP状态码：

- **200**: 请求成功
- **400**: 请求参数错误
- **404**: 任务不存在
- **500**: 服务器内部错误

所有错误响应都会包含详细的错误信息，便于调试和问题定位。