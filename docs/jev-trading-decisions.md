# JEV trading decisions / JEV 交易决策

JEV is an optional TypeSafe System One backend for the trading simulation page. It evaluates a frozen skill, dated market bars, candidate universe and simulated account state. It returns `buy`, `sell` or `hold`, with category probabilities and confidence. It does not generate reports or explanations.

JEV 是交易推演可显式选择的决策模型。输入包括冻结的 Skill、用户交易指令、截至决策日的行情、候选股票与模拟账户现金和持仓。输出仅包含买入、卖出、不动，以及概率和置信度；不要求生成报告，也不补造模型理由。

## Configuration / 配置

In **Settings → Models & runtime**, configure:

| Setting | Meaning | Default |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | TypeSafe API key / API 密钥 | Empty; optional |
| `TYPESAFE_BASE_URL` | HTTPS service root, optionally ending in `/v1` / 服务根地址 | `https://api.typesafe.ai` |
| `TYPESAFE_MODEL` | Alias or fixed model version / 模型名称或固定版本 | `jev-latest` |

Then choose **JEV · Decisions only** in the trading strategy configuration, select a skill, preview and confirm the universe, and save. The saved strategy freezes the model name, skill and allocation step. Existing strategies without `decisionBackend` retain LLM execution. Copy/create a new strategy to change the backend or model for an existing validation.

在 **设置 → 模型与运行时** 保存配置后，在交易策略中选择 **JEV · 仅决策结果**，选择 Skill、预览股票范围并保存。股票范围预览及按日更新范围仍使用现有 LLM，JEV 不加入研究报告、聊天或选股的 LLM fallback 列表。API 失败会明确报错，不自动切换模型。

These settings use the existing configuration persistence and runtime reload mechanism, including Docker environment configuration. API keys stay in server settings and are never stored in strategy definitions or trading call records. The current platform/member model-configuration scope is unchanged. No SDK installation or database migration is required; the existing HTTP client is used.

这些配置复用现有设置保存与重载机制，支持环境变量和 Docker。密钥不进入策略定义或交易调用记录。平台／成员模型配置的权限边界保持现状，不新增独立成员密钥系统。无需安装新 SDK 或执行数据库迁移。

## Customize the decision task / 自定义决策任务

Select JEV in Trade simulation to configure **JEV decision task & inputs**. These settings belong to the strategy, not the global model connection. They are saved as `jevTask`, copied with the strategy and reused for manual, daily and replay runs. Existing strategies without this object retain the defaults.

在交易推演中选择 JEV 后，配置 **JEV 判断任务与输入**。配置属于当前策略，不是全局模型连接设置；以 `jevTask` 保存，复制策略时保留，手动、每日运行及历史回放共用。旧策略不配置时沿用默认行为。

| Field / 字段 | Meaning / 含义 |
| --- | --- |
| `question` | Additional judgment question, up to 4,000 characters / 补充判断问题，最多 4,000 字符 |
| `criteria.buy`, `.sell`, `.hold` | Conditions for each category, up to 2,000 characters each; blank uses defaults / 三类判定条件，各最多 2,000 字符；留空用默认条件 |
| `lookbackDays` | Latest available daily bars, 3–21 trading days, default 21; must cover the configured grid window / 最近可用日线天数，3–21，默认 21；不得少于网格观察周期 |
| `background` | Static supporting material, up to 6,000 characters / 静态补充背景，最多 6,000 字符 |

The question goes into `questions.*.instructions.customQuestion`. Custom criteria supplement the category's fixed action meaning under `criteria.*.conditions`; buy still increases allocation, sell reduces it and hold preserves shares. Background is sent separately as `state.strategyBackground`. The chosen history window changes only the model input, not the execution ledger's price data. Dates, cash, holdings and account constraints remain system-provided. No arbitrary field replacement, executable templates or external URL fetching is supported.

问题进入 `questions.*.instructions.customQuestion`；判定条件进入 `criteria.*.conditions`，与固定的增仓／减仓／不动含义共同提供给模型。背景单独进入 `state.strategyBackground`。观察天数只裁剪模型输入，不改变账本撮合行情。日期、现金、持仓和账户约束始终由系统提供，不支持覆盖任意字段、可执行模板或自动抓取外部网址。

For example, ask “Using the Skill and recent volume/range evidence, which direction applies?” and describe buy as “volume qualifies and price is near the range low,” sell as “price is near the range high or the Skill calls for reducing exposure,” and hold as “neither adjustment is justified.” The Skill remains the method; these descriptions customize its classification task. All category probabilities remain visible and the highest-probability category is selected without a confidence threshold.

例如：问题填写“根据 Skill、近期成交量和区间位置判断调整方向”；买入条件填写“量能满足且价格接近区间低位”，卖出条件填写“接近区间高位或 Skill 要求降低敞口”，不动条件填写“没有足够依据调整”。Skill 仍定义方法，这些说明用于定制分类任务。仍展示全部类别概率，选择最高概率类别，不增加置信度门槛。

Background is frozen text, not a live data feed. Do not enter secrets or future information into historical replay inputs. Saved custom text is not translated when switching UI language. The existing `systemPrompt` is retained as additional strategy instructions for compatibility, while the LLM report/JSON prompt is not sent to JEV.

背景是冻结文本，不会每日自动更新；请勿填入密钥或在回放中加入未来信息。切换界面语言不会翻译已保存的自定义内容。旧 `systemPrompt` 兼容保留为补充策略指令，但不向 JEV 发送 LLM 的报告／JSON 输出 Prompt。

## Decision and execution contract / 决策与执行

The direction adapter explains how a Skill's desired `targetWeight` maps to buy/sell/hold relative to current allocation. A zero target means sell if held, otherwise hold. The request includes arithmetic evidence computed from the frozen inputs: current allocation and, when grid settings are present, the configured window's price range, range position and volume ratio. Insufficient history is marked explicitly; undefined ratios remain null. These facts do not select a trading direction; JEV still interprets the Skill and chooses the category.

方向适配指令将 Skill 的目标仓位要求解释为相对当前仓位的买入、卖出或不动；目标为零时，有持仓应卖出，无持仓应不动。请求补充基于冻结输入计算的当前仓位，以及网格配置窗口内的价格区间、区间位置和量比。历史不足会明确标记，无法计算的比值保留为空。这些是计算事实，交易方向仍由 JEV 根据 Skill 判断，不增加固定价格信号规则。

- `decisionBackend`: `llm` (default) or `jev` on the existing portfolio strategy API.
- `jevWeightStep`: allocation change as a fraction of account equity, default `0.05` (5 percentage points), allowed `0.001–1`.
- Buy increases the current allocation by one step, limited by the single-stock cap. Sell decreases it by one step, floored at zero. Hold preserves the number of shares at the next open.
- Sell changes are considered before buy increments. Available allocation is shared proportionally among permitted buy increments. If new positions exceed available slots, buy probability ranks them; stock code resolves ties. Probability is never treated as an allocation weight or expected return.
- Stocks leaving the candidate universe may not increase their allocation. The common cash, single-stock and position-count validation still applies. An existing overweight hold can therefore reject the plan rather than silently override the model's direction.
- Execution remains next-open simulation with existing lot size, fees and slippage. Price movement must not turn a JEV buy into a sell, a sell into a buy, or a hold into a rebalance. Funding and lot limits may prevent a fill. A decision is not an executed trade.

买入增加一档、卖出减少一档，默认一档为账户权益的 5%。资金和持仓上限可能缩小或阻止调仓；不动保持股数。概率只在新增持仓名额不足时用于排序，不是仓位比例或收益率。模型决定方向，程序负责仓位转换、风控和撮合；这里不新增固定价格信号策略。

The same backend is used by manual runs, daily automatic simulation and AI historical replay. Historical replay uses dated inputs but cannot eliminate knowledge embedded in model training; it retains the existing AI replay designation.

手动运行、每日自动模拟和 AI 历史回放使用同一决策入口。历史回放只输入当时行情，但模型训练知识可能包含未来信息，因此仍标记为 AI 历史回放。

## Results and failures / 结果与失败

The daily opinions view shows the JEV decision, confidence, three category probabilities, and the constrained target allocation. It explicitly identifies the absence of a model explanation. Call records retain the request without credentials, raw structured response, actual model version and token usage. No softmax or invented logits are applied. Existing validations reject a change in the actual returned model version.

每日观点展示分类、置信度、三类概率及受约束后的目标仓位，明确标注无模型解释。调用记录保留不含密钥的输入、原始结构化响应、实际模型版本和用量。不会再次 softmax，不会编造 logits，也不把分类伪装成研究评分。

HTTP calls have a 10-second connect timeout and a 60-second read timeout, with redirects disabled. This integration makes one attempt per decision request (no automatic retry or model fallback). HTTP 401/422/429/529, malformed/incomplete answers, invalid probability distributions, missing token usage or model version, and budget overruns fail without creating a new trading plan. Retry from the existing run control after resolving the cause. No endpoint error body is surfaced as an application error.

## Validation and rollback / 验证与回滚

Deterministic tests mock only the HTTP response and market-data boundaries; they exercise request construction, audit persistence, configuration reload, saved strategy propagation, real five-day simulation accounting, and next-open direction preservation. Frontend tests cover backend/step persistence and probability display. Live TypeSafe inference requires a configured account key and is a separate verification step.

回滚可恢复改动前代码；没有数据库迁移。回滚到不支持 `jevTask` 的版本前，先暂停使用自定义任务的策略，避免旧版本忽略自定义判断条件。停用新 JEV 策略，并新建使用 LLM 的策略；不要直接改写正在运行的历史策略配置。已记录的结构化决策继续保存在原有 JSON 记录中。

Official references: [HTTP API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice). These describe the public structured API, not an OpenAI-compatible chat endpoint.
