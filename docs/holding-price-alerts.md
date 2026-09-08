# 持仓价格告警与通知 / Holding price alerts

## 中文

### 用户流程

1. 在平台设置的“通知与告警”配置渠道凭据、`NOTIFICATION_ALERT_CHANNELS` 路由与检查间隔。空路由沿用全部可用渠道；非空路由限制允许发送的渠道。测试面板可以主动发送测试消息，测试草稿不等于保存凭据。
2. 在持仓页录入股票后，页面提示按需设置告警。每只股票的“设置价格告警”直接展开配置，不跳转；也可从导航打开 `/alerts` 管理独立股票规则。
3. 上限与下限分别添加为 `price_cross` 规则，填写绝对价格（股票报价币种）和冷却小时数。上限 `价格 >= 阈值`，下限 `价格 <= 阈值`。这不是必须发生一次穿越才触发的边缘规则；保存时条件已满足，下次检查就可能发送。
4. 接收渠道可多选；未选择沿用全局 alert 路由。规则选择只能缩小全局允许范围，不能绕过路由或把消息发到未配置的渠道。保存规则不发送测试消息；渠道未就绪也允许保存，但明确提示不会送达。
5. 显式开启“后台告警”。总开关作用于全部告警，不是仅当前股票。默认检查间隔 5 分钟，默认业务冷却 24 小时。实际发送成功后才进入业务冷却；原有去重、通知降噪和投递记录保持。

### 简报与持仓边界

- 发送确定性的 Markdown 事实简报：股票、方向、观察价、阈值、行情来源/时点、生成时点；持仓页创建的绑定规则还包含该账户的平均成本和相对成本变化（未计费用），不发送账户名、股数或全账户资产。
- 成本属于用户敏感信息，界面会提示仅选择可信渠道；渠道受众由用户配置决定。独立股票规则不自动附带全部账户持仓。
- 简报不调用 LLM，不假装新的 AI 研究报告，不自动下单。日常持仓研究与告警为独立机制；原“每日跟踪”里的成本复核标签不会自动创建通知规则。
- 持仓绑定保存在 `notification_policy.holding_account_id`。每轮读取当前该账户持仓；清仓后跳过，不删除规则，重新买入同一股票后恢复评估。阈值是固定价格，不随成本变动自动重算。
- 价格被 provider 标记 `is_stale=true` 或非有限/无效时跳过；优先记录真实 `provider_timestamp`，不拿拉取时间冒充行情时间。缺少真实时间时简报明确标注无法核实时效，不保证数据是实时行情。
- 全局告警中心显示最近 10 条触发/异常和通知结果，规则列表分页；持仓快捷区显示该标的最近触发并链接完整中心。触发、冷却抑制、无渠道和发送失败不能混为发送成功。

### 运行、API 与兼容

- Web poller 每轮使用最新检查间隔（从上次完成时间起计算）；配置读取或轮询异常后等待 60 秒重试，避免每秒反复报错。等待期间不继续评估规则。

- `api/app.py` 生命周期启动独立 `AlertPollingService`，仅在 Web 拥有调度且未设置 suppress-start 时启动。每日研究调度的 API 实例不再另外注册告警 background task，避免同进程重复检查。CLI 作为调度 owner 时仍由原 `main.py --schedule` 负责告警。
- 本地服务需常驻；部署只运行一个告警 owner 进程。不要同时启动独立 CLI 调度进程和多 worker Web。没有新增跨进程租约或 exactly-once 保证，默认 GitHub Actions 一次性分析不是持续告警服务。
- 新增 `GET /api/v1/alerts/status` 返回开关、间隔、当前 Web worker 状态及渠道标识，不返回凭据。外部/CLI owner 无法从该 API 证明运行正常，显示外部或未启动，而非虚报健康。
- 复用已有规则 POST/PATCH、启停、dry-run、触发与通知查询 API。`notification_policy` 新解释 `channels`（非空渠道标识列表）、`report=price_brief`、`language=zh|en`、`holding_account_id`（可选正整数，仅单股票价格规则）。未指定这些字段的旧规则保留旧通知形式。
- `cooldown_policy.cooldown_seconds` 显式提供时要求非负整数；0 关闭业务冷却，Web 表单限制为 1–8760 小时。价格必须是有限正数。没有新环境变量、表或迁移；复用既有鉴权和共享实例账户边界，不新增多租户隔离。

### 部署、验证与回滚

构建 Web 并重启后端，先检查 `/alerts` 的后台和渠道状态。测试使用隔离数据库与模拟行情/发送器，覆盖上下阈值底层规则、持仓绑定、清仓跳过、冷却、路由交集、无效行情、Web 配置序列化和生命周期。没有实际向用户渠道发消息，也没有付费模型调用。在线行情质量与真实渠道凭据需部署者通过显式测试确认。

回滚前关闭 `AGENT_EVENT_MONITOR_ENABLED` 并重启服务，再回退代码和 Web 构建产物。规则与历史保留。**旧 worker 忽略新的规则级渠道/持仓绑定语义，可能沿用全局渠道发送且不在清仓后跳过，因此不要直接用旧 worker 启用这些新规则**；先停用新规则或重新配置全局路由。无需删除用户数据库。

## English

The Web poller applies the latest interval measured from the last completed cycle. Configuration or polling exceptions cause a 60-second retry delay with no rule evaluation during that delay, rather than repeated errors every second.

Use **Settings → Notifications & alerts** to save channel credentials, the `NOTIFICATION_ALERT_CHANNELS` allow-list and polling interval. An empty route uses all configured channels; per-rule selection only narrows that set. The explicit channel test may send a real test message; testing a draft does not save credentials.

After recording a holding, choose **Set price alerts** inline, or open `/alerts` for independent stock rules. Add upper and lower limits separately as fixed-price `price_cross` rules (`>=` / `<=`, in the stock’s quote currency). These are level conditions: an already-met threshold may trigger at the next poll. Limits do not automatically track cost changes. Saving sends no test notification. Missing channels are shown as not ready, rather than blocking draft rule creation.

Explicitly enable the global monitor; this affects every rule. Default polling is 5 minutes and default business cooldown is 24 hours. A successful channel delivery starts cooldown. Existing event deduplication, delivery diagnostics and notification noise controls remain. The center shows the latest 10 events and delivery attempts, with paginated rules; the inline holding view shows symbol events and links to delivery results.

Reports are deterministic Markdown briefs, not new AI research: symbol, threshold direction, observed price, threshold, data source/timestamp and generation time. Holding-bound rules also disclose that account’s average cost and change relative to cost before fees, but not account name, share count or account assets. Select trusted channels. Independent stock rules do not automatically disclose portfolio data. No model calls or orders occur. Daily research and its cost-review labels remain separate from notification rules.

Each bound rule reads the current account position. A closed holding skips evaluation without deleting the rule; buying the same stock again resumes monitoring. Stale-flagged or invalid/nonfinite prices do not trigger. Real provider timestamps are preferred; retrieval time is never substituted. Missing quote timestamps are explicitly marked unverified, not represented as real-time evidence.

Web/API runs an independent lifecycle-owned poller even when daily model schedules are off. Its daily scheduler does not also register an alert task. When CLI owns scheduling, the existing CLI worker remains responsible. Keep one long-lived owner process; there is no distributed lease or exactly-once guarantee. Do not run multiple Web workers or a separate CLI alert scheduler concurrently. One-shot GitHub Actions analysis does not provide continuous monitoring.

`GET /api/v1/alerts/status` exposes readiness and channel identifiers, never credentials. External/CLI ownership is not reported as verified running. Existing authenticated rule/history endpoints are reused. `notification_policy` additionally supports `channels`, `report=price_brief`, `language=zh|en` and optional positive `holding_account_id` for single-symbol price rules. Explicit `cooldown_seconds` must be a nonnegative integer (0 disables business cooldown); the Web form allows 1–8760 hours. No new environment variables, tables or migrations; existing shared-instance access boundaries remain.

Build Web and restart the backend for deployment. Isolated tests use simulated quotes and senders; no live user notifications or paid model runs are made. Verify actual credentials and online quotes explicitly. Before rollback, disable the monitor and restart, then revert code/assets. Keep rule/history data, but disable new rules before restarting an old worker: older code ignores per-rule channel selection and holding binding and may deliver through the global route after a position closes.
