# Harness Tavern

[![CI](https://github.com/HenryQUQ/harness-tavern/actions/workflows/ci.yml/badge.svg)](https://github.com/HenryQUQ/harness-tavern/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-6f5bd3.svg)](LICENSE)

[English](README.md)

Harness Tavern 是一个以 **Tavern 体验为核心的因果故事引擎**。Chat 只是叙事视图，不是事实来源：持久 State、可恢复 Control Loop、声明式 Action、按角色隔离的 Observation、持续 Intent 和可回放 Event 共同决定“实际上发生了什么”。

当前版本：**0.13.0**

## 一条命令启动

需要 Node.js 22.19 或更新版本。

```bash
npm start
```

打开 `http://127.0.0.1:8787`。

应用会自动准备：离线演示模型、默认玩家 Persona、三名示例角色，以及多角色故事 **Midnight at the Glass Observatory**。新用户不需要先理解 API Key、Provider、Prompt 或 Agent 模式，就能收到第一条角色回复。

## 产品原则

- **使用酒馆语言，而不是基础设施语言。** 一级入口是 Home、Chats、Library、Create、Settings。
- **逐步展开复杂度。** 模型连接、路由、回复深度、费用和创作者调试信息都存在，但不会阻挡第一次体验。
- **用户永远拥有自己的角色。** 系统不能代替用户说话、思考、感受、决定身份或宣告行动成功。
- **文字不能创造事实。** 模型提出意图；Action 规则先验证条件并提交效果，然后模型才能叙述结果。与事实冲突的草稿会被丢弃、纠正，必要时直接回退到已验证 Observation。
- **意图持续到事实终止它。** 角色 Action 必须来自该角色拥有的活跃 Agenda；只有作者声明的状态条件才能完成、失败、暂停或恢复持续意图。
- **私人知识必须隔离。** 玩家 Journal、公开分享预览和创作者 Inspector 使用不同的数据投影。
- **内容先于平台锁定。** 角色和故事可以通过版本化 Tavern Pack 或便携分享链接迁移。
- **扩展不等于执行陌生代码。** 可导入扩展仅包含声明式模板、快捷动作和主题。

## 玩家旅程

### 第一次进入

引导只问两个问题：

1. 酒馆应该怎么称呼你？
2. 你想认识角色、进入故事，还是创建内容？

不会要求用户先选择模型或 Provider，默认直接使用内置演示模型。

### Home

首页展示：

- 最近对话与故事存档，以及可读的剧情摘要；
- 可以直接认识的角色；
- 可以进入的故事；
- 未完成的创作草稿；
- 三角色示例故事入口。

### 角色聊天

进入 Character Profile，选择自己要使用的 Persona，然后开始或继续聊天。角色身份、语气、目标、边界、记忆和关系状态独立于具体模型长期保存。

### 故事存档与时间线

Story 是可反复游玩的作品；开始故事后创建 Playthrough；每个 Playthrough 可以拥有多个具名 Timeline。“What if?” 分支不会覆盖原历史。

### 玩家 Journal

Journal 把底层状态转换成玩家容易理解的内容：

- 当前场景；
- 剧情回顾；
- 未解决线索；
- 已知事实；
- 关系描述；
- 玩家可见的世界状态；
- 时间线。
- 已解决或被拒绝的 Action receipt；
- 玩家可见的事实、Observation 与公开持续意图；
- State revision 和 Context assembly 策略。

Director-only Lore 与角色私人知识不会出现在玩家 Journal 中。

## 创作者旅程

创作者不需要手写 JSON、Prompt、Schema 或 Harness 配置。

### Quick Character

用普通语言描述想认识的人，系统生成可编辑草稿，包括语气、关系起点、第一句话、目标、秘密与边界。高级字段全部是可选项。

### Quick Story

描述想体验的故事，再选择友好的模板、角色数量、类型、氛围和玩家身份。系统生成：

- Hook 与 Premise；
- 相互区分的角色草稿；
- 每名角色的公开与私人知识；
- 世界规则；
- 开场与场景结构；
- 内容提示；
- Remix 策略。

生成结果先保存为草稿，创作者确认后才发布，并可立即 Playtest。

### 可复用模板

已有 Story 可以一键保存为声明式 Story Template，在 Create 中重复使用，不需要开发插件代码。

## 分享

Harness Tavern 提供三种分享层级。

### 公开预览

可撤销的浏览器页面，只包含玩家安全信息：标题、Hook、公开角色介绍、标签、内容提示和公开 Lore。不会包含角色私人知识、Director-only Lore、Author Notes、模型设置或本地内部 ID。

### 完整可玩 Tavern Pack

版本化 `.tavernpack.json` 文件，包含 Story 和依赖角色。为了让故事能够正常运行，完整包会包含创作者私人知识，因此它属于可编辑源内容，不应当被当作公开展示页面。

### 便携链接

较小内容可压缩进 URL Fragment。接收方会先看到内容预览和冲突，再决定是否导入；较大内容自动改用下载文件。

导入始终提供预览，并明确选择冲突策略：

- **Copy**：保留现有内容并创建副本；
- **Replace**：更新匹配内容；
- **Skip**：复用已有匹配内容。

SillyTavern Character Card V2/V3 JSON、PNG 和 CHARX 也通过相同的预览与导入流程处理。完整迁移工作区可以扫描 SillyTavern 用户数据目录或 ZIP，在写入前预览 Characters、Chats、Group Chats、Groups、World Info、Personas 和兼容预设。`secrets.json` 永远排除；扩展、Quick Replies、主题和向量索引只做清单，不执行、不当成可信状态。

### 可编辑 Story v2

无角色旁白故事、单人故事和多人故事使用同一个 `harness-tavern-story/v2` 标准。小故事可以是一个自包含 JSON 文件；大故事可以拆成 `story.tavern.json`、Character Card、Lorebook、Markdown Scene、Action 和 Agenda 文件。它们使用稳定 key，可直接编辑、放进 Git、验证并重新编译到 SQLite。

### 可移植存档

Story Pack 使用 SHA-256 完整性校验（不是作者身份签名）。Playthrough Pack 会携带因果事件流，可在另一个实例继续同一组事实；完整备份会包含本地 Library、Conversations、Profile 与自定义预设，但永远不包含 API 凭据或 Provider Connection。

## 安全扩展

扩展格式只允许声明式内容：

- 角色模板；
- 故事模板；
- 输入框快捷动作；
- 主题 Token。

包含 script、JavaScript、module、entrypoint 或 eval 等可执行字段的扩展会被拒绝。这样既方便社区分享，又让用户能够理解安全边界。

## AI 连接

不连接外部模型也可以使用完整应用。高级用户可以在 **Settings → AI Connections** 中配置：

- OpenRouter，包括 OAuth/PKCE 账户连接与路由偏好；
- OpenAI-compatible 服务；
- Anthropic；
- Gemini；
- Azure OpenAI；
- Ollama、LM Studio、vLLM、llama.cpp、LocalAI；
- 三十多个 Provider 预设。

聊天标题栏会显示当前 AI 服务和模型。点击即可在已连接的 API 之间切换、刷新或手动输入模型 ID，并套用 **平衡、电影感、聚焦** 三种内置回复预设。每个对话还可以单独调整自定义 AI 指令、带入的历史消息数、显式 Context Budget、思考强度、回复长度、角色主动性、多角色节奏、随机度、Top P、Top K、Min P、频率/存在/重复惩罚、随机种子、停止序列，以及有边界的 Provider 专属 JSON 参数。包括思考强度在内的全部设置都可以保存成新预设，也可以更新已有的自定义预设。历史与 Context Budget 默认都是空值：Tavern 不设置硬上限；用户显式设置预算时，只会省略完整 Context block，不会从 block 中间截断文字。

预设区可以直接导入 SillyTavern Chat Completion 和 Text Completion JSON。应用会先预览逐项映射，把启用的 prompt 块转换成当前对话指令，保留兼容的采样器与推理强度，并清楚列出不会导入的字段；API/模型凭据和输出 Token 上限不会被带入。回复长度只是写作风格，不会转换成人为 Token 上限；输出容量交给所选服务管理，完整叙事也不会再按字符数静默切断。结构化 Control Plan 或叙事不完整时，Command 仍会持久化，Loop 会暂停；修复连接后可安全恢复，不会重复已提交效果，也不会把残缺数据显示成角色台词。

应用只自动准备角色、故事和离线演示模型，不再自动创建演示对话。连接真实 API 后，新对话会优先使用真实服务；内置 Mock 仅在没有其他可用连接时作为离线回退。

API Key 会加密保存。除非 Provider 提供正式授权流程，否则消费者网页订阅不会被冒充成 API 凭据。

## 架构

```text
玩家 / 创作者界面
        ↓
面向人的应用服务
(Home、Journal、引导创作、分享、扩展)
        ↓
Tavern 领域
(Character、Persona、Story、Playthrough、Timeline、Cast)
        ↓
持久因果运行时
(Command → Control Plan → Action → Observation → Narration)
        ↓
Append-only Events + 确定性投影 + SQLite
```

默认产品不包含 Bash、仓库编辑、PTY、LSP 或 Coding Agent Prompt。DeepSeek Harness 是可选的下游集成底座，不是用户看到的产品心智。

详细文档：

- [体验架构](docs/EXPERIENCE_ARCHITECTURE.md)
- [分享与扩展](docs/SHARING_AND_EXTENSIONS.md)
- [创作者指南](docs/CREATOR_GUIDE.md)
- [系统架构](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [安全设计](docs/SECURITY.md)
- [迁移说明](docs/MIGRATION.md)
- [开发指南](docs/DEVELOPMENT.md)
- [运维指南](docs/OPERATIONS.md)
- [架构决策](docs/adr/README.md)

## 验证

```bash
npm run check
npm run test:coverage
npm run verify:journey
npm run doctor
npm run release
```

`npm run verify` 是本地合并门槛。GitHub Actions 会执行相同的源码检查、覆盖率阈值、首次使用 Journey、隔离数据库诊断和依赖审计。Release 会完成冷解包测试、Git Bundle 校验、校验和，以及可选的完整 DeepSeek Harness 源码快照，但不会改写 Git 历史或标签。

## 容器运行

容器默认使用非特权用户，并把持久数据放在 `/data` Volume。非 Loopback 启动必须设置访问 Token。

```bash
export HT_ACCESS_TOKEN="$(openssl rand -hex 32)"
docker compose up --build -d
```

通过反向代理暴露服务前，请阅读[运维指南](docs/OPERATIONS.md)。

## 当前边界

当前版本是可实际用于角色聊天、故事创作、分享、迁移、评估和继续开发的本地单 Owner Beta。它不是经过独立安全审计的多租户 SaaS；多用户 RBAC、计费、集中内容治理、分布式数据库、原生移动客户端和托管市场不在本版本范围内。
