# AMH 接入入口（Agent 无关）

给任何 AI Agent 的只读入口说明。**入口文档 ≠ 授权**：它只告诉 Agent 去哪查、怎么用，不改变任何 Agent 的权限。

## 1. 库在哪

| 项 | 路径 |
| --- | --- |
| 项目根 | `D:\Agent Memory Hub` |
| 正式记忆（Obsidian vault） | `D:\Agent Memory Hub\Agent Memory Hub` |
| 候选区 | `D:\Agent Memory Hub\inbox\candidates\` |
| 机器索引 | `D:\Agent Memory Hub\state\index.json` |

## 2. 怎么检索（Phase 1：手动 CLI）

```powershell
node src/cli/memory.mjs search --project <项目ID> --query "<关键词>"
node src/cli/memory.mjs read <记忆ID>
node src/cli/memory.mjs search --json       # 结构化输出，适合 Agent 解析
```

## 3. 默认读什么

只返回 `approved + current + 未归档` 的记忆；候选（pending）、已失效（stale/superseded/revoked）与归档记忆不会出现在默认检索里。需要历史时显式指定。

## 4. 怎么核对（读一条记忆时要检查的三件事）

1. **来源是否支持这条主张**——不是「有没有 sources」，而是每条来源能否支撑 statement；
2. **scope 是否覆盖当前任务范围**——项目 / 模块 / 版本边界；
3. **时效**——`updated_at` / `last_verified_at` 过久时应主动复核，不要当成当前事实。

## 5. 写入规则

Agent 不能直接写正式库。流程：

```
candidate add（提交候选） → 人工 review approve → 写入正式记忆 → 索引重建
```

未审核内容**永不**进入默认检索；模型置信度不是验证证据。

## 6. 记忆不能替代什么

- 不能替代当前指令（AGENTS.md / CLAUDE.md / 用户当轮要求）；
- 不能授予任何操作权限；
- 不能自动执行命令、恢复任务或继承旧授权（任务快照只能作为「带时间的候选资料」）。

## 7. 各 Agent 接入建议

指针候选文本与落点见 [`entry-points/README.md`](<entry-points/README.md>)。当前状态：

| Agent | 落点 | 状态 |
| --- | --- | --- |
| Codex 项目级 | 项目根 `AGENTS.md` | 已在 AMH 项目落地 |
| Codex 用户级 | `~/.codex/AGENTS.md` | 未写入（需授权） |
| Claude Code | `CLAUDE.md` / `~/.claude/CLAUDE.md` | 未写入（需授权） |
| DSH | 项目级 `AGENTS.md`；用户级待核查 | AMH 项目已放；用户级待核查 |
| 其他（MCP / Skill） | Phase 4 评估 | 未实施 |

**注意：** 修改任何 Agent 的全局配置是独立操作，必须由用户明确授权；Phase 1 只提供入口文档与已落地的项目级指针。
