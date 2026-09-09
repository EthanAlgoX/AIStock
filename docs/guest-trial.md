# 访客演示与限额试用 / Visitor demos and capped trials

## 中文

服务器开启 `MULTI_USER_ENABLED=true` 后，邀请码领取者也可在主登录页自行填写邮箱并进入完整的私有工作区，额度沿用不补发，详见 [私有工作区](multi-user-isolation.md)。下文的只读能力限制专指 `/try` 入口，不代表成员完整工作区；本地单人模式直接进入网站，不开放试用账户 API。成员密码可由部署主机恢复，不重置额度。

### 入口与身份

登录页的“先体验一下”进入 `/try`，无需注册。助理、圆桌、个股、选股、交易、持仓均有交互演示；公司、行情、排序和报告明确标注为虚构，不调用模型或读写真实持仓。

真实试用采用**独立受邀用户账户**，不是管理员账户。管理员在设置的“访客与试用额度”一次生成 1–20 个邀请码并分别私下发给用户。用户在 `/try` 自行填写邮箱，并用邀请码和 8–128 位密码领取。邀请码 7 天有效且只能使用一次；已注册邮箱不能再次获得额度。

不开放未验证邮箱自助注册，不自动发邮件或验证邮箱归属，部署管理员负责确认邀请对象。暂不提供试用密码找回。试用会话 7 天有效，重新登录替换旧会话；管理员可以停用/恢复身份，但不重置额度。试用 Cookie 不能进入管理员、持仓或配置 API。

### 开启真实模型调用

默认只开放免费演示，真实调用关闭。配置已有 Agent 的官方 DeepSeek 路由和密钥后，设置部署环境并重启：

```dotenv
TRIAL_ENABLED=true
TRIAL_MODEL=
TRIAL_DAILY_TOKEN_LIMIT=2000000
```

`TRIAL_MODEL` 留空使用主 Agent 模型，也可指定现有路由别名。仅支持官方 DeepSeek HTTPS 接口，不允许任意代理、供应商或自动 fallback。密钥复用服务端配置，不返回浏览器。全站每日上限按 UTC 日期累计，默认 200 万 Token；它不是个人额度重置周期。容器部署需传入上述变量，并持久化数据库。

### 20 万 Token 如何计算

- 每个领取邀请码的账户默认每日 **200,000 输入 + 输出 Token**，管理员可独立调整为 0–10,000,000；每天 UTC 00:00（北京时间 08:00）重置。缓存命中的输入也计入；所有专家、交叉评审和主持总结调用共享额度。
- 每次物理调用先在数据库事务中预扣输入的保守 UTF-8 字节上界、协议余量和最多 2,048 输出 Token，再按供应商完整用量退回差额。个人与全站预算原子检查；失败不发请求。小额余额也可能不足以预留下一次调用。
- 超时、断连或用量无效时保留预扣并停止后续调用，不自动重试。因此“已用”包含未确认的保守预扣，不一定等于供应商账单。供应商意外超出预留时记录实际用量并停用身份，需管理员检查供应商契约；无法保证供应商违约情况下的账单上限。
- 单个身份同时一个任务，请求 ID 幂等。切页/刷新不取消后台运行。服务重启不自动重跑；超过 15 分钟的未完成任务在下次查询时标记中断，保留预扣和部分成果。
- 报告存入独立表，按身份过滤，返回最近 50 条。没有自动清理或账户删除流程；部署方需制定备份及留存政策。管理员列表仅返回邮箱、领取/停用状态、用量，不返回密码、邀请码摘要或报告。

### 能力边界与回滚

真实试用是受限只读研究，支持可选公开历史行情、最多两位预设专家视角、独立汇总或一轮交叉评审。专家为模拟视角，不代表本人。**不开放**私人持仓/聊天数据、任意 Skill/MCP/工具配置、全市场扫描、回测、订单、通知或定时任务。持仓演示输入不持久化。报告不是已执行交易或收益保证。

新增界面与演示文案支持完整中英文；真实报告按请求语言生成，历史报告不自动翻译。设 `TRIAL_ENABLED=false` 并重启可停止新调用，已发出的请求可能完成并结算。回滚代码前备份数据库，保留 trial 表用于审计，不要通过删库重置额度。

## English

With server mode and `MULTI_USER_ENABLED=true`, the same invited identity can register/sign in from the main login page and enter a [full private workspace](multi-user-isolation.md), sharing the existing quota without a new allowance. Restrictions below describe `/try` only. Local mode needs no account and disables trial APIs. Members have host-only password recovery, preserving quota.

### Access and identity

The login page links to `/try`, a public interactive demo covering Assistant, Roundtable, Stock research, Screening, Trade simulation and Portfolio. Companies, prices, rankings and reports are explicitly fictional. Demos make no model calls and never access real portfolios.

Live research requires a **separate invited trial account**, not an administrator account. Settings → Visitors & trial access lets administrators generate 1–20 codes at a time and share each one privately. Users claim a code at `/try`, choosing their own email and an 8–128 character password. Invitations expire after 7 days and are single-use; enrolled emails cannot receive another grant.

There is no unverified public self-registration, automatic email delivery, email verification or trial password recovery. Administrators must identify invitees. Trial sessions last 7 days; signing in rotates the session. Suspension blocks access and future calls. Restoration and login do not reset usage. Trial cookies cannot authorize administrator, configuration or portfolio APIs.

### Deployment and accounting

Live calls are disabled by default. Configure an existing official DeepSeek Agent route, set `TRIAL_ENABLED=true`, and restart. `TRIAL_MODEL` optionally selects an existing route alias; blank uses the primary Agent model. Only the official DeepSeek HTTPS endpoint is allowed, with no arbitrary proxies/providers or automatic fallbacks. Credentials remain server-side. Pass these variables into container deployments and persist the database.

Each account that claims an invitation defaults to **200,000 daily input + output tokens**, including cached input and every expert, cross-review and moderator call. Personal limits reset at 00:00 UTC and administrators can adjust each limit from 0 to 10,000,000. `TRIAL_DAILY_TOKEN_LIMIT` separately limits all trial users combined per UTC day (default 2,000,000).

Each physical call reserves a conservative UTF-8 input bound, framing margin and up to 2,048 output tokens in a database transaction against both budgets. Verified provider usage refunds the difference once. Insufficient reservation capacity blocks the call even with a small remaining balance. Timeouts or unverifiable usage retain the reservation and stop subsequent calls without retry, so displayed usage can exceed confirmed provider billing. A provider exceeding the reservation is accounted at actual usage and the identity is suspended; no billing cap can guarantee against provider contract violations.

One task per identity may run at once. Request IDs are idempotent; navigation does not cancel background work. Restarts do not replay tasks. Unfinished tasks older than 15 minutes are marked interrupted on the next query, retaining reservations and partial reports. Reports are stored separately, filtered by identity, with the latest 50 returned. No automatic purge or account deletion exists; operators must establish retention and backup policies. The admin list exposes email, enrollment/suspension status and usage, not passwords, invitation hashes or reports.

### Capability boundaries and rollback

Live trials provide limited read-only research with optional public price history, up to two preset expert lenses, independent summaries or one cross-review. These are simulated perspectives, not the real individuals. Trials do **not** expose private holdings/chat data, arbitrary Skills/MCP/tools, full-market scans, backtests, orders, notifications or schedules. Demo portfolio inputs are not persisted. Reports are not executed trades or return guarantees.

All new controls and demo text support English. Live reports request the selected language; historical reports are not translated automatically. To stop new calls, set `TRIAL_ENABLED=false` and restart. Already dispatched calls may finish and settle. Back up the database before reverting code and preserve trial tables for audit; deleting the database is not a supported quota reset.


管理员在设置 → 安全与部署 → 邀请码用量与每日上限，查看各邀请码今日用量、累计消耗与近 7 天逐日记录（UTC）。未领取的邀请码也可预设额度；旧邀请码默认 20 万/日，旧成员保留历史账本并按日计费。编号用于识别邀请码，原始邀请码仍只在生成时展示。页面每 30 秒刷新，支持滑杆与精确数字输入，点击“保存上限”后对下一次预扣生效，无需重启。降低上限不删除已用额度，也不取消在途调用；0 阻止新调用。未确认用量保留预扣并在每日记录标为待核实调用；跨日结算归属原始调用日。全站每日总上限仍独立生效。

API: `GET /api/v1/trial/admin/invitations` 返回逐邀请码记录；`POST` 同路径支持 `count` 与 `dailyLimit`；`PATCH /api/v1/trial/admin/invitations/{id}` 接收 `{ "dailyLimit": 300000 }`。全部要求管理员会话及现有 CSRF 校验。成员状态中的 `used/limit/remaining` 现在表示当天额度，追加 `lifetimeUsed/period/timezone`；管理员 `/admin/users` 同样返回每日用量，并通过 `lifetimeUsed` 保留累计值。Web 与后端需要一起部署，桌面旧客户端的终身额度文案需升级 Web 资源。

Administrators can inspect today's usage, lifetime totals and the last seven UTC days under Settings → Security & deployment. Limits can be set before claiming an invitation and edited with a slider or exact numeric input. Save applies to the next reservation without restarting. A lower limit preserves usage and in-flight calls; zero blocks new calls. Unverified usage retains its reservation; late settlement belongs to the original day. Existing records are retained, and the shared site limit remains independent. The admin invitation GET/POST/PATCH APIs above require an admin session and CSRF validation. Member `used/limit/remaining` now describe daily quota, with additive `lifetimeUsed/period/timezone` fields. Deploy backend and Web together; older desktop wording requires updated Web assets.


回滚：保留升级前镜像与配置，必要时切回旧镜像并保留当前数据库，避免丢失注册及消耗记录。旧镜像会恢复原有终身 20 万限制，累计超过该值的成员将被阻止继续调用，动态每日上限管理也不再可用。

Rollback: retain the previous image and configuration and switch back while preserving the current database. The older image restores its lifetime 200,000-token cap, blocking members above that total and removing daily-limit management.
