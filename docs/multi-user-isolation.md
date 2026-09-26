# 多用户独立工作区 / Private user workspaces

## 部署模式

- 本地单人：`ADMIN_ACCESS_MODE=local`（默认），无需注册或登录，直接进入投研助理。仅允许直接回环地址访问，服务请绑定 `127.0.0.1`；局域网、代理转发和跨站变更请求被拒绝。已有管理员凭据保留但本地模式不要求使用。
- 服务器多人：`ADMIN_ACCESS_MODE=server`、`MULTI_USER_ENABLED=true`，要求 HTTPS 和邮箱账户。先按 [实例账户](instance-account.md) 初始化唯一平台管理员，再在设置中批量生成一次性邀请码。用户从登录页“没有账户？立即注册”注册，并自行填写登录邮箱。
- 注册支持**邀请码领取每日额度**，或**无邀请码注册后填写个人 LLM API**；邮箱由用户自行填写，不发送验证邮件。邀请码是 7 天有效的 bearer credential，管理员必须私下交付给预期用户。当前仍无邮件验证和自助恢复，公网部署需配置反向代理限流。不同部署不会同步账户。

Docker 桥接端口转发不是直接回环访问：当前请使用服务器模式和 HTTPS 代理，不要放宽本地访问校验。免登录本地体验使用源码或桌面端直连回环服务；Docker 桥接免登录部署不在当前支持范围。

## 隔离契约

服务端从有效会话解析不可猜测的用户 ID，选取控制数据库目录下 `workspaces/<user-id>/workspace.db`，不接受客户端指定数据库、用户或工作区。原数据库及历史数据保留给部署管理员，不复制给新用户。私有数据库复用现有 Schema 和业务服务，不是仅前端过滤。

对话、专家圆桌、研究报告、持仓成本、自选股、策略偏好、自定义专家/Skill、任务、调度和通知偏好隔离。报告文件写入所属工作区。相同对话 ID、任务 ID 或运行请求 ID 不授予其他用户访问、修改、删除、下载或取消权限。登录身份变化会清除旧的浏览器私有草稿和内存状态；其他标签页重新载入。

公开行情与内置模板可以共享。平台密钥、全局配置、用户邀请管理、任意外部 MCP 配置和可执行策略代码上传仅管理员可用。普通用户设置页提供本人邮箱、额度、个人 LLM API、密码和本人邮箱通知开关。选股/交易为研究或模拟提案，不提供真实券商自动下单。

后台任务和专家线程继承服务器确定的工作区；线程池复用不复用用户身份。到期计划从各自数据库恢复，执行前检查用户是否启用；停用账户停止新任务。服务重启会将中断运行标记为中断，不重放付费调用；持久化的下一次计划继续调度。

私人告警可以使用平台 SMTP 发件配置，但接收地址强制为当前注册邮箱，且默认关闭。不会继承管理员的收件人、群机器人或旧告警规则。其他个人通知渠道、持仓文件导入、报告图片分享与平台高级执行能力目前未向普通用户开放。

## 额度与资源

每个受邀身份默认每日 **200,000 输入＋输出 Token**（管理员可动态调整），与原访客试用共享同一账本；重新登录、进入完整工作区不会补发额度。未配置个人 API 的受邀用户通过官方 DeepSeek 的统一预扣/结算入口调用 Agent、专家与报告模型。先预留额度再请求，未知用量或超时保留预扣并阻止当前运行后续调用；没有自动重试或不计费的备用模型路径。

平台额度调用需要设置 `TRIAL_ENABLED=true`，默认关闭；`TRIAL_MODEL` 可指定已配置路由，留空使用主 Agent 路由；只支持官方 HTTPS DeepSeek 端点。全站另受 `TRIAL_DAILY_TOKEN_LIMIT` 限制（默认 UTC 每日 2,000,000）。额度不足会停止新的模型调用，而非无限等待。实际已发出的调用可能在停用后完成。

当前为单进程 SQLite 方案：模型物理并发 2，共享分析线程池 3，单用户分析队列及工作区运行各最多 5 个待处理/运行任务，最多缓存 256 个工作区数据库。适合受邀小规模试运行，不是多节点 SaaS 架构；不要开启多个 Uvicorn/Gunicorn worker。公共行情网络故障与模型额度不足仍可能使分析失败，报告不保证每天成功。

## 上线与恢复

1. 备份原数据库、整个工作区目录、账户/会话凭据和配置；使用持久化数据目录，限制 OS 文件权限。
2. 设置服务器模式和模型配置，初始化管理员并验证受邀账户。
3. 执行只读预检：`python -m src.services.member_preflight`。它不调用模型、不发邮件、不改账户；通过不等于完成公网验收。
4. 反向代理配置 HTTPS、受控域名、请求限流和大小限制；后端端口不得暴露公网。只有可信代理覆盖转发头且后端不可直连时，才配置 `TRUST_X_FORWARDED_FOR=true`，同时限制服务的受信代理 IP。
5. 在实际服务器验证两个独立浏览器账户、HTTPS Cookie、注销、计划重启恢复、邮件实际送达以及离机备份恢复。模型、SMTP 和云主机验收需要真实部署环境，不能用离线测试替代。

管理员恢复：`python -m src.auth reset_password`。
成员恢复：`python -m src.services.member_service reset-password --email <member-email>`，在部署主机交互输入密码。保留数据和额度、撤销旧会话，不提供未经验证的网页邮箱变更或密码找回。

回滚：先停止公网入口和后台服务，保留完整备份，再恢复兼容代码/配置。可暂设 `MULTI_USER_ENABLED=false` 关闭成员访问（服务器管理员仍须登录）；不要切为本地模式后继续使用公网代理，也不要删除工作区或账本来重置额度。旧认证代码不识别邮箱凭据格式，降级前必须恢复匹配版本的备份。

## English

Local single-user deployments use `ADMIN_ACCESS_MODE=local` by default: no signup or login, direct loopback access only. Bind to `127.0.0.1`. Remote hosts, forwarded requests and cross-site writes are rejected. Existing owner credentials are retained but not required in local mode.

Docker bridge forwarding is not direct loopback access. Use server mode and an HTTPS proxy for bridge deployments; do not weaken the local guard. No-login local use currently targets source/desktop deployments, not Docker bridge networking.

Shared servers use `ADMIN_ACCESS_MODE=server` and `MULTI_USER_ENABLED=true`, with HTTPS and email accounts. Bootstrap the owner using [Instance account](instance-account.md), generate one or more single-use codes in Settings, then let recipients choose their login email on the registration page. Registration supports **an invitation with daily platform allowance or no invitation with a personal LLM API**; each code is a seven-day bearer credential and must be shared privately. There is no automatic email verification or self-service recovery. Apply reverse-proxy rate limits for public registration. Separate installations do not synchronize accounts.

Authenticated identity selects a private SQLite database at `workspaces/<user-id>/workspace.db` beside the control database. Client workspace/user selectors are not trusted. Existing data stays with the owner. Chats, roundtables, reports/files, holdings, watchlists, custom experts/Skills, preferences, tasks, schedules and notification preferences are isolated. Matching IDs do not authorize cross-account reads, changes, downloads or cancellation. Identity changes clear browser drafts and runtime state, including other tabs.

Public market data and built-in templates may be shared. Platform secrets, global configuration, user administration, external MCP setup and executable uploads are administrator-only. Member settings expose personal account, quota, personal LLM API, password and email notifications. Notifications are opt-in and forced to the registered email, using platform SMTP without inheriting owner recipients or legacy alert rules. Other personal channels, portfolio file imports and report image sharing are not exposed to members. Trading remains research/paper proposals, not live brokerage execution.

Workers preserve identity and recheck account status; reused threads do not reuse a previous user's scope. Durable schedules load from each private database. Restart marks interrupted runs instead of replaying paid calls, while future schedules continue.

Each invited identity shares an adjustable daily **200,000-token default input/output allowance** across limited trials and full workspaces. Without personal API settings, invited members reserve and settle Agent/expert/report calls through the official DeepSeek endpoint. Unknown usage/timeouts retain the reservation and stop follow-up calls in that run; no automatic retries or unmetered fallback. Platform-funded calls require `TRIAL_ENABLED=true` (default false). `TRIAL_MODEL` optionally selects an existing route; otherwise the main Agent route is used. The shared daily limit defaults to 2,000,000 tokens UTC. Already dispatched calls may still complete after suspension.

Use one application process. Model concurrency is 2, shared analysis workers 3, each member has at most 5 active/queued analysis tasks and 5 workspace runs, and the process caches up to 256 workspace databases. This is a small invited deployment, not distributed SaaS. Data-provider failure or quota exhaustion may interrupt research.

Before deployment, back up the control database, workspaces, credential/session files and configuration; use private persistent storage. Run `python -m src.services.member_preflight` for read-only checks. Then validate real HTTPS/proxy trust, request limits, independent sessions, restart recovery, SMTP delivery and off-host backup restoration on the target server. Preflight does not prove public deployment safety.

Owner recovery: `python -m src.auth reset_password`. Member recovery: `python -m src.services.member_service reset-password --email <member-email>`; interactive host-only recovery preserves data/quota and revokes sessions. No unverified browser email changes or password reset.

For rollback, close public access and stop workers first, preserve backups, then restore matching code/configuration. `MULTI_USER_ENABLED=false` disables member access while keeping server-owner authentication. Never proxy local mode publicly, delete workspaces to reset quotas, or downgrade credential formats without matching backups.


每日额度在 UTC 00:00（北京时间 08:00）重置。管理员可在设置中查看近 7 天用量并调整每个邀请码的上限，保存后对下一次调用生效。旧成员的累计账本保留，Web/API 额度字段改为按日语义，详见 [邀请码额度管理与 API 契约](guest-trial.md)。

Daily limits reset at 00:00 UTC. Administrators can inspect seven days of usage and adjust each invitation's limit for the next call. Lifetime records are retained; Web/API quota fields now describe daily usage. See [invitation quota management and API contracts](guest-trial.md).

## 用户行为与用量审计 / User activity and usage audit

管理员设置页「访客与试用额度 → 用户行为与 Token 分析」包含管理员自己和受邀成员，可按日期、用户、功能筛选每日用量、每日功能用量、页面/操作次数、单次模型调用以及问答记录。详细契约和边界见 [用户用量与审计](user-activity-audit.md)。

The administrator's Settings → Visitors & trial access → User activity and token analysis includes the administrator and invited members, with date/user/feature filters, daily totals, feature totals, page/operation counts, individual model calls and questions/answers. See [the audit contract](user-activity-audit.md) for accounting and coverage limits.

## 个人 API 与额度来源 / Personal API and allowance

- 无邀请码注册创建平台每日额度为 **0** 的普通成员，仍使用相同私有工作区；注册后进入“我的账户”。填错、过期或已使用的邀请码会报错，不会静默转为无邀请码注册。旧受邀账户的额度和数据不变。
- “个人 LLM API”支持 OpenAI、DeepSeek、Anthropic、Google Gemini 官方接口。选择服务商、填写控制台模型 ID（不加服务商前缀）与 API Key；一次启用一套配置。相同服务商密钥留空保留原值，更换服务商必须提交新密钥。不支持自定义代理地址或云厂商 IAM 凭据。
- 保存个人 API 后，工作区的 Agent、专家、报告与选股模型调用统一走个人配置。无个人配置的受邀用户继续使用平台额度；无邀请码用户会收到配置提示。失败、限流或余额不足均不回退到平台密钥。`TRIAL_ENABLED=false` 不阻止个人 API 调用。
- 个人调用保存用量记录，使用 `personal:<UTC日期>` 来源；不扣用户平台额度、累计平台用量或全站试用额度。限额试用页仍使用平台试用契约，不读取个人 API。免费注册不会继承平台 JEV 密钥；个人设置目前配置的是生成式 LLM，规则回测不需要模型密钥。
- 密钥通过已有原子私有文件写入机制保存在 `workspaces/<用户ID>/.model-credentials.json`（目录 0700、文件 0600），不回显、不写入全局环境或其他用户配置。文件**未加密**，部署管理员和备份管理员可读取；备份应包含整个私有数据目录。删除配置后停止后续个人调用，已经发送的请求不取消。
- 成员 API：`GET/PUT/DELETE /api/v1/workspace/model-settings`。PUT 为 `{provider, model, apiKey}`；GET 只返回 provider/model/configured/providers。认证状态 `registrationMode` 新增 `open`，旧 `invite/closed` 客户端类型保留兼容；前后端应一起升级。
- 回滚到上一镜像即可恢复邀请码注册；已注册无邀请码账户仍可登录但无平台额度，旧代码不读取个人配置文件。保留文件及用量账本，勿用删除数据库来回滚。

Users without an invitation receive **zero platform allowance** and go to My account to configure their own LLM API. Invalid invitation codes are rejected. Existing invited accounts retain their data and allowance.

Personal settings accept official OpenAI, DeepSeek, Anthropic and Google Gemini APIs, one active provider/model/key at a time. Enter the provider's model ID without a prefix. Blank keys preserve the existing key only for the same provider. Custom proxy endpoints and cloud IAM credentials are not supported. Personal settings take priority across workspace Agent, expert, report and screening calls, never fall back to platform keys, and work independently of `TRIAL_ENABLED`. Without personal settings, funded members use platform allowance; unfunded members must configure their API. Limited trials retain their platform-only contract. Unfunded members do not inherit the platform JEV key; this settings form covers generative LLMs. Rule backtests need no model key.

Personal calls have a `personal:<UTC date>` usage source and do not debit personal or global platform budgets. Credentials are stored in `workspaces/<user ID>/.model-credentials.json` using private atomic writes (0700 directory, 0600 file), never returned in API responses or shared across accounts. They are **not encrypted**; server/backup administrators can read them. Include the private data directory in protected backups. Removing settings affects future calls, not requests already sent.

The member-only `GET/PUT/DELETE /api/v1/workspace/model-settings` API accepts `{provider, model, apiKey}` and returns only provider/model/configured/providers. Auth status adds registration mode `open`; deploy client and server together. Reverting the image restores invitation-only signup; unfunded accounts remain unfunded and the older code ignores their personal credentials. Preserve credentials and usage records when rolling back.
