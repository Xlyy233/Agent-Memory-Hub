# Agent Memory Hub（Obsidian Vault）

这是 AMH 的**正式记忆库**：人类可读、可审阅、可被 CLI 检索。项目主体（代码、配置、候选区）在上一级目录 `D:\Agent Memory Hub`。

## 目录说明

| 目录 | 用途 |
| --- | --- |
| `00-索引/` | 总索引，由 CLI 自动生成（勿手改） |
| `10-通用/` | 跨 agent、跨项目共享的记忆（environment / workflow / engineering） |
| `20-项目/<ID>/` | 按项目隔离的记忆（如 EQDM） |
| `_templates/` | 记忆模板 |
| `_meta/` | schema、状态模型、写作规范 |

## 新增一条正式记忆

1. 复制 `_templates/memory.md` 到目标项目目录；
2. 填写 frontmatter（`id` 用 `mem-YYYYMMDD-<项目>-0001` 格式），正文按「主张 / 证据 / 适用范围」写；
3. 运行 `node src/cli/memory.mjs index rebuild` 刷新索引；
4. 用 `node src/cli/memory.mjs validate` 校验。

> 正常流程是 Agent 提交候选 → 人工审核通过 → CLI 生成正式文件。手工新建仅限「人工确认的既有事实」。
> 手工改动已被批准的记忆后，其内容哈希会变化，应触发复核（Phase 1 记录此约定，自动检测在后续阶段实现）。

## 状态查看

- 审核状态：`pending / approved / rejected`
- 有效性：`current / stale / superseded / revoked`
- 归档：`archived: true/false`

详见 `_meta/status-model.md`。默认检索只返回 `approved + current + 未归档`。
