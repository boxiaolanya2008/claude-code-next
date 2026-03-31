# Claude Code Next - 部署指南

## 项目概述

这是一个 **Claude Code Next** 项目，使用 **Bun** 作为 JavaScript/TypeScript 运行时。

## 当前状态

### 已完成的工作：

1. ✅ 创建了项目配置文件
   - [package.json](file:///workspace/package.json) - 项目依赖和脚本配置
   - [tsconfig.json](file:///workspace/tsconfig.json) - TypeScript 配置
   - [bunfig.toml](file:///workspace/bunfig.toml) - Bun 构建配置

2. ✅ 安装了项目依赖
   - 主要依赖：@anthropic-ai/sdk, react, axios, chalk, lodash-es, zod 等
   - 开发依赖：@types/react, @types/bun

3. ✅ 分析了项目代码
   - 项目是一个 AI 代码助手应用
   - 包含完整的命令行工具链
   - 使用 React 构建 UI 组件

### 注意事项：

⚠️ **项目代码库不完整**：
   - 缺少一些模块和文件（如 daemon/, environment-runner/, self-hosted-runner/ 等）
   - 这是一个截断的代码库，无法完整运行

## 建议的下一步

### 1. 获取完整代码

从 GitHub 仓库获取完整代码：
```bash
# 确保你有权限访问
git clone https://github.com/boxiaolanya2008/claude-code-next.git
cd claude-code-next
```

### 2. 使用完整代码部署

完整的项目应该包含：
- 所有缺失的模块文件
- 完整的 package.json（包含 build scripts）
- CI/CD 配置
- Dockerfile（如有）
- 部署文档

### 3. 安装和运行（完整代码）

```bash
# 安装依赖
bun install

# 开发模式运行
bun dev

# 或使用启动命令
bun start

# 构建项目
bun build
```

## 当前可用的脚本

- `bun dev` / `bun start` - 运行应用（需要完整代码）
- `bun build` - 构建项目（需要完整代码）

## 项目远程仓库

```
https://github.com/boxiaolanya2008/claude-code-next
```

## 技术栈

- **运行时**: Bun 1.2.14
- **UI 库**: React 18.3
- **语言**: TypeScript
- **命令行**: Commander.js
- **AI SDK**: @anthropic-ai/sdk

## 注意

当前工作目录仅包含部分代码，主要用于：
- 代码分析和学习
- 功能测试（部分功能）
- 研究项目架构

要完整部署和运行，请获取完整的项目代码库。
