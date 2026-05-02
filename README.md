# 🌀 MixHub Studio

> **Distilled AI Model Router & Developer Workspace**
> 一个极致提纯的本地 AI 模型路由站，专为追求效率与美学的开发者打造。

---

## ✨ 核心特性

### 🚀 智能模型路由 (Smart Routing)
- **多供应商聚合**：无缝集成 阿里云百炼 (Bailian)、魔搭 (ModelScope)、AIHubMix 等主流供应商。
- **自动负载均衡**：支持 `any` 模型策略，根据可用性与延迟自动选择最优路径。
- **本地端点隔离**：将本地开发环境与线上生产端点完全解耦。

### 📊 极致统计看板 (Metrics Dashboard)
- **Token 级追踪**：实时展示输入/输出 Token 消耗，精确到每一笔请求。
- **健康度监控**：可视化成功率、延迟波动（Latency）及错误封禁统计。
- **请求历史详情**：支持分页查询的 Premium 列表，内置状态高亮与 I/O 数据流向。

### 💬 沉浸式聊天体验 (Immersive Chat)
- **非对称美学**：精心设计的对话气泡，强化角色指向感。
- **Markdown 节奏排版**：针对 AI 响应优化的间距与代码块，具备极佳的可读性。
- **实时性能足迹**：悬浮显影模型名称与响应时间，保持界面极简。

### 🔌 开发者中心 (API Guide)
- **一体化编辑器**：内置沉浸式代码示例框架。
- **多语言接入**：提供 Python (OpenAI SDK)、Node.js 及 cURL 的标准接入方案。
- **语法高亮**：基于 JetBrains Mono 的硬核代码质感。

---

## 🎨 设计哲学：Impeccable Design

本项目深度遵循 **Impeccable** 设计准则，拒绝臃肿，追求“脱水”后的纯粹感：
- **OKLCH 色彩空间**：使用感知均匀的色彩体系，确保深色/浅色模式下的高级质感。
- **工业级间距**：严格的 4px/8px 网格系统，每一像素的留白都经过反复推敲。
- **微互动反馈**：细腻的 Hover 状态、呼吸点（Tab Dot）以及状态脉冲动画。

---

## 🛠️ 技术架构

- **Frontend**: Vue 3 + Vite + Vanilla CSS (No Tailwind)
- **Desktop**: Tauri (Rust)
- **Storage**: Persistent SQLite (Tauri Side)
- **Protocols**: Standard OpenAI API Compatibility

---

## 🏗️ 快速开始

### 开发环境配置
```bash
# 安装依赖
npm install

# 启动本地路由与 UI 调试
make tauri-dev
```

### 生产环境构建
```bash
# 构建 Tauri 安装包
make build
```

---

## 🔐 安全说明

- **Key 安全**：所有 API Keys 仅存储于本地 SQLite 数据库，绝不上传至任何第三方服务器。
- **端点隔离**：默认使用 `localhost:8000` 作为本地网关，保护你的真实端点不被泄露。

---

<p align="center">
  Built with ❤️ by Antigravity Impeccable Team
</p>
