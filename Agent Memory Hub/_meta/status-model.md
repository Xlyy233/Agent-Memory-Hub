# 四维状态模型（Phase 1 冻结）

> 对齐 2026-11-07 Codex 回应：`verified` 不能同时表示「有证据」和「人工批准」，拆成四个独立维度。

## 1. 审核状态 `status`

| 值 | 含义 | 是否进默认检索 |
| --- | --- | --- |
| `pending` | 候选，等待人工审核 | 否 |
| `approved` | 人工批准，可作为正式记忆 | 是（还需 validity/archived 满足） |
| `rejected` | 人工驳回，保留记录供追溯 | 否 |

## 2. 有效性 `validity`

| 值 | 含义 | 是否进默认检索 |
| --- | --- | --- |
| `current` | 当前适用 | 是 |
| `stale` | 可能过期，待复核 | 否（可由显式历史查询返回） |
| `superseded` | 已被新记忆取代（`supersedes` 指明替代者） | 否 |
| `revoked` | 已撤销 | 否 |

## 3. 证据与验证结果 `evidence_kind` / `evidence_result`

- `evidence_kind`：`user-confirmed`（用户明确确认）、`static-check`（静态核对）、`runtime-verified`（运行验证）、`none`
- `evidence_result`：`passed` / `failed` / `not-run`

**注意：** 证据不排高低等级。用户确认能证明「选择了某种设计」，不能证明「程序运行正常」；测试通过不能证明用户批准了某项产品决策。

## 4. 归档 `archived`

`archived: true` 表示退出日常使用（保留文件与历史），默认检索排除。

## 状态流转

```
候选(pending)
 ├─ 人工 approve ──> 正式记忆(status=approved, validity=current)
 └─ 人工 reject  ──> rejected（保留，不删除）

正式记忆(approved, current)
 ├─ 相关文件/代码变化或复核 ──> stale
 ├─ 新记忆取代 ──> 旧记忆 superseded（supersedes 指向新记忆）
 ├─ 撤销 ──> revoked
 └─ 归档 ──> archived=true
```

## 检索默认条件

```
status = approved && validity = current && archived = false
```

`stale` 默认排除，但可由显式历史查询返回。正式记忆被手工改动后，内容哈希变化应使旧批准失效并触发复核——Phase 1 记录此约定，自动检测在后续阶段实现。
