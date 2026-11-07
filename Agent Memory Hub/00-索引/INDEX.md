# AMH 记忆索引

> 自动生成，请勿手工编辑。内容以 vault 内正式记忆的 frontmatter 为准，
> 本文件与 `state/index.json` 均可用 `node src/cli/memory.mjs index rebuild` 重建。
> 生成时间：2026-11-07T13:15:40.576Z ｜ 记录数：9

| ID | 项目 | 类型 | 标题 | 状态 | 有效性 | 范围 | 文件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cand-20261107-EQDM-0001 | EQDM | 项目事实（fact） | EQDM 仓库位置与 Git 基线（2026-11-07） | approved | current | EQDM 项目基线；HEAD 变化或提交未提交文件后复核。 | [cand-20261107-EQDM-0001.md](../20-项目/EQDM/architecture/cand-20261107-EQDM-0001.md) |
| cand-20261107-EQDM-0002 | EQDM | 架构事实（architecture） | EQDM 技术栈 | approved | current | EQDM 项目；依赖升级或模块拆分后复核。 | [cand-20261107-EQDM-0002.md](../20-项目/EQDM/architecture/cand-20261107-EQDM-0002.md) |
| cand-20261107-EQDM-0003 | EQDM | 待确认问题（question） | EQDM 未提交修改与未跟踪文件待处置 | approved | current | EQDM 采集白名单决策；确认前不采集。 | [cand-20261107-EQDM-0003.md](../20-项目/EQDM/questions/cand-20261107-EQDM-0003.md) |
| cand-20261107-shared-0001 | shared | 项目事实（fact） | AMH 本机运行环境基线 | approved | current | AMH 项目全部本地运行；Node 大版本升级或迁移工具目录时复核。 | [cand-20261107-shared-0001.md](../10-通用/architecture/cand-20261107-shared-0001.md) |
| cand-20261107-shared-0002 | shared | 架构决策（decision） | AMH 项目根与 Obsidian Vault 根分离 | approved | current | AMH 全项目；迁移 Vault 或改 Obsidian 配置前复核。 | [cand-20261107-shared-0002.md](../10-通用/decisions/cand-20261107-shared-0002.md) |
| cand-20261107-shared-0003 | shared | 项目事实（fact） | 本机 AI Agent 共同工作约定（任务评估/授权/Loop/验收） | approved | current | 本机全部 AI agent；新 agent 接入时引用指针而非复制正文。 | [cand-20261107-shared-0003.md](../10-通用/architecture/cand-20261107-shared-0003.md) |
| cand-20261107-shared-0004 | shared | 项目事实（fact） | Node.js 运行时路径依附 Claude 工具目录 | approved | current | 本机全部依赖 Node 的 Agent；移动 Claude 工具目录前复核。 | [cand-20261107-shared-0004.md](../10-通用/architecture/cand-20261107-shared-0004.md) |
| cand-20261107-shared-0005 | shared | 架构决策（decision） | AMH 入口指针策略：项目级优先 + 防注入硬约束 | approved | current | AMH 全部入口指针；换 agent 或迁移项目根时复核。 | [cand-20261107-shared-0005.md](../10-通用/decisions/cand-20261107-shared-0005.md) |
| cand-20261107-shared-0006 | shared | 验证方法（verification） | 入口指针首次验证：Codex 新会话通过检索，但需区分只读命令授权 | approved | current | AMH 入口指针与检索方式；修改指针文本后需重新验证。 | [cand-20261107-shared-0006.md](../10-通用/verification/cand-20261107-shared-0006.md) |
