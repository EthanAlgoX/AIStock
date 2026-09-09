# 用户用量与审计 / User usage and audit

## 入口和身份

管理员进入设置 → 访客与试用额度 → 用户行为与 Token 分析。受邀成员不能访问这些跨用户 API。成员使用不可变随机内部 ID；单管理员系统使用保留内部身份 `owner`，邮箱和用户名不是主键。改邮箱不会拆散历史记录。现有管理员凭证仍由认证模块保存，成员凭证在 `trial_users`；不复制密码或密码哈希到审计记录。

## 用量口径

- 成员：`trial_calls` 是唯一扣费真源，`user_call_details` 一对一附加功能、模型、追踪 ID、输入/输出 Token、耗时、错误码。预留及归因同事务写入，结算幂等，跨午夜结算归属原调用 UTC 日期。
- 管理员：沿用主库 `llm_usage`，`owner_call_attribution` 同事务附加功能、追踪 ID 和 UTC 时间。工作区的 `llm_usage` 不叠加到成员扣费，避免重复计数。管理员后台定时调用计入管理员；无请求上下文时以原调用类型归类。
- 每日按 UTC（北京时间 08:00 分界），与成员额度一致。计费用量 = 已确认用量 + 未确认预留。供应商未返回有效用量时，成员保留预留，不能当成精确实际用量。管理员原链路不预留额度，失败且无 usage 的调用不能推断 Token；可能只有错误记录。外部后端的 usage 粒度沿用原有后端契约，不保证每行都对应一次物理模型请求。
- 新任务按实际执行的 task kind 归类；普通请求按后端入口归类，不信任浏览器传入的功能扣费标签。一个任务内专家/工具/压缩调用归入该任务，避免一个调用分摊到多个功能。遗失上下文的调用标为 other 或原调用类型，不猜测。
- 历史没有归因的记录标为 `legacy_unknown`，不伪造功能；管理员旧记录日期沿用原服务器时间约定。原有管理员 `/usage` 页面保留其北京时间统计口径，新管理员跨用户审计统一 UTC。

## 行为和问答

`user_activity` 保存用户 ID、追踪 ID、功能、事件、资源、状态、耗时和 UTC 时间。问答保存可见用户问题/助手答案，工作区任务保存目标及终态报告/错误。分页明细每页 50 条，日期筛选最多 366 天，汇总在数据库按全范围聚合，不受明细分页影响。

页面计数来自已登录前端的主要页面导航（不含 query 参数），客户端上报存在关闭页面/网络失败导致丢失的可能，不用于扣费。操作计数是已认证的非只读请求提交次数，含失败、重试，不等于业务成功次数；GET 轮询不算操作。后台任务以 task_started/task_result 记录；前端渲染错误和浏览器离线失败不是服务器可完整观察的事件。

标准聊天写入点复制可见问答至审计表；任务终态收集文本报告。尚未到达持久化写入点就失败的输入、未经过这些入口的扩展/外部后端不保证有完整问答。原试用页历史仍保存于 trial_runs，管理员可在数据库查 request_json/events_json；新试用问答同步写入审计表，新版审计不自动复制既有聊天内容。

新问答审计独立于用户可删除的聊天历史；删除聊天不删除审计副本。当前不自动清理审计表，应纳入服务器数据库备份及管理员的数据保留/删除管理；日志文件仍按原规则轮转。审计故障写入服务器错误日志，不回滚已完成的业务操作；不能承诺磁盘损坏等情况下零丢失。

不采集密码、Cookie、请求头、API Key、工具协议或隐藏推理；用户自己输入到问答中的内容会被保存。登录页说明记录用途与管理员可查阅范围。跨用户明细只向管理员授权，公开注册/登录接口不会暴露这些数据。

请求返回 `X-Request-ID`，服务器日志包含 trace；后台任务以 run ID 关联。HTTP 状态只代表请求响应，流式输出与后台最终结果应结合问答/task_result/call error 查阅。

## API

- `GET /api/v1/trial/admin/analytics?start=YYYY-MM-DD&end=YYYY-MM-DD&user_id=...&feature=...`：daily、usage、activity 汇总。
- `GET /api/v1/trial/admin/activity`：相同日期/用户/功能筛选，追加可选 request_id、offset。
- `GET /api/v1/trial/admin/calls`：同上，单次用量及追踪编号。
- `POST /api/v1/usage/activity`：已认证页面事件，body `{ "page": "/screening" }`，仅接受固定页面白名单，不接受用户 ID。

## 部署与回滚

无新环境变量。新增三张表由既有建表机制创建，旧表及额度不重写。部署前备份全部 data 目录及旧镜像。回滚旧镜像可保留新表及数据（旧版本忽略），无需恢复旧数据库覆盖上线后的用户数据。恢复旧镜像后不再采集新增审计字段。

## English contract

Settings → Visitors & trial access → User activity and token analysis includes the administrator (`owner`, a reserved immutable identity) and invited members (immutable random IDs). Email is a searchable attribute, never the primary key. Passwords remain in the existing authentication store as hashes and are not copied into audit records.

Member accounting joins the existing quota ledger to one-to-one attribution in the same transaction. Owner accounting uses the main database's existing LLM usage with a transactional attribution sidecar; member workspace telemetry is not double-counted. UTC dates match member quotas, including settlement across midnight. Confirmed tokens and unverified reservations are separate. Owner calls without reported usage cannot be reconstructed; external backend granularity follows its existing usage contract. Historical missing attribution remains explicitly unclassified; old owner timestamps retain their original server convention.

Authenticated page navigation and mutation requests are counted separately; polling is excluded. Counts are not proof of successful task completion. Chat persistence and task completion capture visible questions, answers and task errors. Early failures, client-side errors, external paths and network loss can leave gaps. Trace IDs correlate HTTP responses, logs and model calls; durable tasks use run IDs. Administrator-only detail APIs support pagination and up to 366 days per query; totals aggregate the whole range.

Audit copies survive user chat deletion and currently have no automatic purge. Include them in database backups and administrator retention/deletion management. The login page discloses collection and administrator access. No passwords, cookies, headers or hidden model/tool protocol are collected; user-entered question content is retained. Audit write failures are logged without undoing successful business operations. Existing trial run history is not retroactively copied. Roll back by restoring the previous image while retaining databases and additive tables; no new environment variables are required.
