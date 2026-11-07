# 记忆记录结构（schema v1）

> 机器可读契约以 `src/core/schema.mjs` 为准；本文件是给人看的中文说明。

## 正式记忆文件位置

```
vault/<项目 vault_dir>/<type 子目录>/<id>.md
```

例：`20-项目/EQDM/decisions/mem-20261107-EQDM-0001.md`

## frontmatter 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | `mem-YYYYMMDD-<项目>-<序号>` |
| `schema_version` | number | 是 | 当前为 `1` |
| `project_id` | string | 是 | `shared` 或 `projects.json` 注册的项目 ID |
| `type` | enum | 是 | 见下方类型表 |
| `title` | string | 是 | ≤120 字，检索会优先命中 |
| `status` | enum | 是 | 审核状态：`pending / approved / rejected`。正式记忆必须为 `approved` |
| `evidence_kind` | enum | 是 | `user-confirmed / static-check / runtime-verified / none` |
| `evidence_result` | enum | 是 | `passed / failed / not-run` |
| `validity` | enum | 是 | `current / stale / superseded / revoked` |
| `archived` | boolean | 是 | `true` 时退出日常使用 |
| `scope` | string | 是 | 适用范围（项目/模块/版本），≤500 字 |
| `tags` | string[] | 是 | ≤20 个 |
| `sources` | object[] | 是 | 至少 1 个，多态来源（见下） |
| `supersedes` | string[] | 否 | 被本条取代的旧记忆 ID（`validity=superseded` 时必填） |
| `created_at` / `updated_at` | ISO 时间 | 是 | |
| `last_verified_at` | ISO 时间 | 否 | 最近一次复核时间 |

## 记忆类型

| type | 写入目录 | 说明 |
| --- | --- | --- |
| `architecture` | `architecture/` | 架构事实（结构、模块职责、数据流） |
| `decision` | `decisions/` | 架构决策（含原因与替代方案） |
| `fact` | `architecture/` | 项目事实（版本、配置、路径等） |
| `pitfall` | `pitfalls/` | 故障经验（现象、根因、修复） |
| `verification` | `verification/` | 验证方法（怎么证明某件事成立） |
| `constraint` | `constraints/` | 兼容约束（版本、平台、数据格式） |
| `question` | `questions/` | 待确认问题（尚未验证的假设） |

## 来源类型（sources[].kind）

| kind | 最低核验字段 | 说明 |
| --- | --- | --- |
| `git` | `repo, path, hash` + (`commit` 或 `snapshot`) | 代码来源，绑定提交或快照 |
| `command` | `command, cwd, executed_at, exit_code` | 命令输出，记录执行环境 |
| `file` | `path, hash` | 文件内容来源 |
| `user-statement` | `statement, confirmed_at` | 用户明确确认 |
| `doc` | `locator, fetched_at` | 文档来源（含抓取时间） |

`doc` 与 `file/git` 可组合：前者表示「证据语义」是文档，后者说明「保存与定位方式」。

## 正文结构（模板约定）

```markdown
## 主张
（一句话能被检索命中，正文可展开）

## 证据
（每个来源支持哪一部分；区分「文档曾这样写」和「当前已验证」）

## 适用范围
（哪些项目/模块/版本适用；何时应复核）
```

## 校验命令

```powershell
node src/cli/memory.mjs validate
```
