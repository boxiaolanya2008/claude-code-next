# Claude Code Dashboard

Dashboard 服务用于收集和展示 Claude Code 的会话数据和 token 使用情况。

## 功能特性

- 自动收集每次会话的数据
- 记录详细的 token 使用情况（输入、输出、缓存读取、缓存创建）
- 统计工具使用次数和消息数量
- 提供 Web 界面展示数据趋势
- 数据持久化存储在 SQLite 数据库中

## 数据存储位置

所有数据存储在 `%APPDATA%/.claude/sessions.db` (Windows) 或 `~/.config/.claude/sessions.db` (Linux/Mac)

## 自动启动

Dashboard 服务会在 CLI 启动时自动启动（仅在交互模式下）。

默认端口：3456（如果被占用会自动尝试下一个端口）

## 访问 Dashboard

启动 Claude Code 后，在浏览器中访问：

```
http://127.0.0.1:3456
```

## Dashboard 界面

Dashboard 提供以下信息：

1. **API 配置信息**
   - API 状态（是否已配置）
   - Base URL（从环境变量 `ANTHROPIC_BASE_URL` 或 settings.json 读取）
   - 使用的模型（从环境变量 `ANTHROPIC_MODEL` 或 settings.json 读取）

2. **统计卡片**
   - 总会话数
   - 总输入 Token 数
   - 总输出 Token 数
   - 缓存效率

3. **每日 Token 使用趋势图**
   - 显示最近 30 天的输入和输出 token 使用情况
   - 折线图展示趋势

4. **Token 分布图**
   - 饼图展示输入、输出、缓存读取、缓存创建的比例

5. **最近会话列表**
   - 显示最近 20 个会话的详细信息
   - 包括会话 ID、模型、开始时间、持续时间、消息数、工具使用数、token 统计

## 数据库结构

### sessions 表

存储会话级别的统计信息：

- id: 会话 ID
- startTime: 开始时间（毫秒时间戳）
- endTime: 结束时间（毫秒时间戳）
- model: 使用的模型
- totalInputTokens: 总输入 token 数
- totalOutputTokens: 总输出 token 数
- totalCacheReadTokens: 总缓存读取 token 数
- totalCacheCreationTokens: 总缓存创建 token 数
- messageCount: 消息数量
- toolUseCount: 工具使用次数

### token_usage 表

存储每条消息的详细 token 使用情况：

- id: 自增 ID
- sessionId: 关联的会话 ID
- timestamp: 时间戳（毫秒）
- model: 使用的模型
- inputTokens: 输入 token 数
- outputTokens: 输出 token 数
- cacheReadTokens: 缓存读取 token 数
- cacheCreationTokens: 缓存创建 token 数
- messageType: 消息类型（user 或 assistant）

## API 端点

- `GET /` - Dashboard 主页面
- `GET /api/config` - 获取 API 配置信息（从 settings.json 或环境变量读取）
- `GET /api/sessions` - 获取所有会话列表
- `GET /api/sessions/:id` - 获取指定会话详情
- `GET /api/token-usage/:sessionId` - 获取指定会话的 token 使用记录
- `GET /api/daily-stats?days=30` - 获取每日统计数据（默认 30 天）

## 配置来源

Dashboard 从以下位置读取 API 配置：

1. **环境变量**（优先级最高）
   - `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`
   - `ANTHROPIC_BASE_URL`
   - `ANTHROPIC_MODEL`

2. **settings.json**（位于 `%APPDATA%/.claude/settings.json`）
   - `primaryApiKey`
   - 其他配置项

这意味着无需在 Dashboard 中单独配置 API，它会自动使用 CLI 的配置。

## 注意事项

- Dashboard 仅在交互模式下启动（`--print` 模式不启动）
- 数据收集对性能影响极小
- 如果 Dashboard 启动失败，不会影响 CLI 的正常使用
- 数据会在每次启动时自动收集和累积
- API 配置自动从 settings.json 或环境变量读取，无需额外配置
