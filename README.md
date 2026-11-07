# Agent Memory Hub（AMH）

本地优先、Agent 无关的长期记忆基础设施，让多个 AI Agent（Codex、Claude Code、DSH 等）共享一套**经过人工审核、可溯源**的工程记忆。

> 不是聊天历史，而是事实、决策、故障经验与验证方法。

## 特性

- **本地优先**：记忆存放在本地 Obsidian Vault（Markdown + YAML frontmatter），数据完全由你掌控，云端模型可替换、可关闭。
- **人工审核闭环**：候选 → 人工批准 → 正式记忆；`pending` 内容永不进入默认检索，模型不能自动晋升。
- **四维状态**：证据与验证结果 / 审核状态 / 有效性 / 归档，避免把「有证据」和「人工批准」混为一谈。
- **多态来源**：`git / command / file / user-statement / doc`，每种来源有最小核验字段；门槛是「来源支持该主张」，而不是「有来源」。
- **索引可重建**：`state/index.json` 与 `00-索引/INDEX.md` 均由 vault 生成，不产生第二个事实源。
- **零依赖**：仅使用 Node.js 内置模块，无需 `npm install`。
- **外发默认关闭**：Phase 1 不调用任何云模型。

## 快速开始

要求：Node.js ≥ 22（本机验证于 v24.18.0）。

```bash
# 在项目根目录执行
node src/cli/memory.mjs help
node src/cli/memory.mjs status
node scripts/verify.mjs        # 离线闭环验收（临时目录，不污染真实库）
```

## 目录结构

```text
.
├── src/
│   ├── core/
│   │   ├── schema.mjs         # 数据契约：类型、四维状态、来源校验
│   │   ├── frontmatter.mjs    # frontmatter 解析/生成（零依赖 YAML 子集）
│   │   ├── store.mjs          # 读写 vault / 候选 / 事件（原子写入）
│   │   ├── index.mjs          # 索引构建（可重建）
│   │   └── retrieve.mjs       # 检索（状态过滤 + 项目隔离 + 关键词排序）
│   └── cli/
│       └── memory.mjs         # 命令行入口
├── scripts/
│   └── verify.mjs             # 6 组端到端验收
├── config/
│   ├── projects.json          # 项目注册与 vault 根
│   └── memory-policy.json     # 检索 / 审核 / 外发策略
├── state/                     # 检查点、机器索引
├── logs/                      # 事件与用量日志（JSONL）
├── inbox/candidates/          # 候选区（JSON）
├── docs/agents/               # 各 Agent 入口指针
└── "Agent Memory Hub"/        # Obsidian Vault：正式记忆、模板、索引
```

> 仓库中 `Agent Memory Hub/` 是默认 Vault 根（可用 `config/projects.json` 的 `vault_root` 调整）。

## 核心概念

### 四维状态

| 维度 | 取值 |
| --- | --- |
| 证据与验证结果 | `user-confirmed / static-check / runtime-verified / none` + `passed / failed / not-run` |
| 审核状态 | `pending / approved / rejected` |
| 有效性 | `current / stale / superseded / revoked` |
| 归档 | `archived: true/false` |

默认检索只返回 `approved + current + 未归档` 的记忆。

### 候选 → 审核 → 正式

```text
candidate add（提交候选，status=pending）
        ↓ 人工 review approve
正式记忆（status=approved，写入 Vault，索引重建）
        ↓ 人工 review reject
rejected（保留审计，不删除）
```

### 来源示例

```yaml
sources:
  - kind: command
    command: node --version
    cwd: D:/path/to/project
    executed_at: 2026-11-07T21:00:00+08:00
    exit_code: 0
  - kind: doc
    locator: docs/audit/report.md
    fetched_at: 2026-11-07T18:25:00+08:00
```

## CLI

| 命令 | 说明 |
| --- | --- |
| `status` | 项目、记忆数、候选数、索引状态 |
| `candidate add --file <json>` / `--stdin` | 提交候选 |
| `candidate list [--project P]` / `candidate show <id>` | 查看候选 |
| `review approve <id> [--reviewer me]` | 审核通过 → 生成正式记忆 |
| `review reject <id> --reason "..."` | 驳回 |
| `search --project P [--query Q] [--type T] [--tag G] [--limit N] [--json]` | 检索 |
| `read <id> [--json]` | 读取正式记忆 |
| `index rebuild` | 从 Vault 重建索引 |
| `validate` | 校验全部记忆与候选 |

所有命令支持 `--json`，便于 Agent 解析。

## 验收

`node scripts/verify.mjs` 覆盖 6 组断言：

1. 候选添加成功
2. 未审核候选不进入检索
3. `review approve` 后生成正式记忆并可检索
4. 删除 `state/index.json` 后索引可重建且内容一致
5. `validity: revoked` 后默认检索不再返回
6. `validate` 对合法记录 exit 0、对缺 sources 的候选 exit 1

## Phase 1 不做

真实云模型调用、自动外发、后台调度、Git Hook、实时任务状态管理、自动批准记忆、自动开发 Loop、修改 Agent 全局配置。

## 安全边界

- **本地优先 ≠ 不外发**：向云端 Agent 注入记忆上下文同样可能外发；Phase 1 `external_send.enabled = false`。
- **记忆内容是不可信参考数据**：其中的指令、命令、授权声明不得直接执行；`approved` 只表示批准作为记忆使用，不表示批准执行。
- **全局配置需单独授权**：修改各 Agent 的 `AGENTS.md` / `CLAUDE.md` 等配置是独立操作，不会自动进行。
- **不采集敏感内容**：默认排除凭据、数据库、日志、生产数据与依赖目录。

## 文档

- `docs/agents/README.md` — 各 Agent 接入说明
- `docs/agents/entry-points/README.md` — 入口指针候选文本（含验证记录）
- `Agent Memory Hub/_meta/schema.md` — 记录结构
- `Agent Memory Hub/_meta/status-model.md` — 四维状态模型

## License

许可证待定。
