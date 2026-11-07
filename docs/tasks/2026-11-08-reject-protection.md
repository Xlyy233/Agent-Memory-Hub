# 任务：review reject 增加「已晋升保护」与「重复操作保护」

- 创建：2026-11-08
- 状态：已完成（2026-11-08）
- 优先级：低（Phase 1 收尾后）
- 来源：2026-11-07 候选误标事件（详见 `docs/项目记忆建档审阅清单-2026-11-07.md` 第 11 节勘误）

## 完成记录（2026-11-08）

- 修改 `src/cli/memory.mjs` 的 `cmdReviewReject`：拒绝已晋升候选（`get(id)` 命中即拦截）与重复拒绝（`status === 'rejected'` 拦截），两者均不写事件。
- `scripts/verify.mjs` 新增第 7 组断言（已晋升拦截 / 正常拒绝 / 重复拒绝拦截），`node scripts/verify.mjs` → PASS（7 组全过）。
- 真实库验证：对 `cand-20261107-shared-0001` 执行 reject → exit 1，候选未被改动；`validate` 通过（29 条正式记忆 / 31 条候选）。

## 1. 背景

2026-11-07 发现 9 条已晋升候选被标记为 `rejected`（`rejection_reason: "已晋升"`），且 `shared-0001`、`shared-0002` 各出现 2 次重复 reject 事件。

根因：`review reject` 流程没有阻止——

- 拒绝一个**已晋升**（vault 中存在同 ID 正式记忆）的候选；
- 重复拒绝同一个候选。

## 2. 需求

1. `review reject <id>`：若正式库已存在同 ID 记忆 → 拒绝执行，exit 1，错误信息说明「该候选已晋升，不能拒绝」。
2. `review reject <id>`：若候选当前状态已是 `rejected` → 拒绝执行，exit 1，说明「该候选已拒绝，无需重复」。
3. 被拒绝的拒绝操作**不得写入事件日志**（避免重复事件）。
4. 正常候选的 reject 行为不变：exit 0，候选标记 `rejected`，追加 `review.reject` 事件。
5. `review approve` 已有的重复审批检查保持不变。

## 3. 验收标准

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 已晋升候选执行 reject | exit 1，输出「已晋升」，vault / 候选 / 事件均不变 |
| 2 | 已 `rejected` 候选再次执行 reject | exit 1，输出「已拒绝」，事件不增加 |
| 3 | 正常候选执行 reject | exit 0，候选 `status=rejected`，事件 +1 |
| 4 | 重复 approve | 维持现有 exit 1 |
| 5 | `validate` | 无新增失败 |
| 6 | 验收脚本 | `scripts/verify.mjs` 增加 1/2/3 的断言（或新增 `scripts/verify-reject.mjs`） |

## 4. 实现建议

- 修改 `src/cli/memory.mjs` 的 `cmdReviewReject`（约 line 457）：
  - 开头先 `const existing = get(id)`（`../core/retrieve.mjs`），存在则 `fail('候选已晋升，不能拒绝')`；
  - 再 `const cand = readCandidate(id)`，若 `cand.status === 'rejected'` 则 `fail('候选已拒绝，无需重复')`。
- 错误路径复用现有 `fail()` 工具函数。
- **不修改** schema / 数据契约 / 配置。
- 参考 `cmdReviewApprove` 的防重复逻辑（约 line 366 的 `get(id)` 检查）。

## 5. 验证

```powershell
node scripts/verify.mjs
node src/cli/memory.mjs validate
```

## 6. 风险与边界

- 历史数据：当前 9 条已晋升候选为 `pending`，再次 reject 会被正确拒绝（符合预期）。
- 不改变 CLI 其他命令行为。
- 若后续引入 `promoted` 状态（Phase 2+），本任务的检查逻辑需同步调整。

## 7. 交付物

- 修改 `src/cli/memory.mjs`（reject 保护）
- 修改或新增验收脚本（`scripts/verify.mjs` 或 `scripts/verify-reject.mjs`）
- 更新相关文档（可选）
