# 策略实验与模拟交易页面（预览）

> 当前可运行的每日规则组合位于 `/trading`，见 [策略验证与运行](strategy-portfolios.md)。本文以下内容仅描述旧预览工作台。

> 本文记录旧 `/simulation` 预览边界。当前 StrategyVersion 的发布前历史验证已迁移到独立 `/backtests` 工作台和持久化 API，详见 [StrategyVersion 历史验证](strategy-version-validation.md)；旧 `/validation` 路由继续兼容，该能力仍不属于模拟账户或真实交易运行时。

策略实验室的整体目标、阶段和完成度见 [strategy-lab-roadmap.md](strategy-lab-roadmap.md)。

Web 端新增 `/simulation` 页面。它是默认显示在左侧导航中的独立工作台，不受 `SCREENING_ENABLED` 开关控制。

当前第一阶段把“策略”提升为页面的一等对象：用户可在预置策略库中切换趋势突破、回踩质量和题材催化组合，查看候选池来源、策略专家与 Agent 编排模式。点击“记录模拟预览”会为该组合创建独立的策略版本与 `queued` 运行记录；它不会触发订单或 Agent 执行。

官方模板优先继承原项目的选股策略、分析 Skill 与编排模式。首批模板覆盖趋势突破、回踩质量、题材催化、质量价值、超跌修复与红利防御；每个模板显示来源资产和默认风控边界。复制模板后的更改只写入用户自己的策略版本。

复制模板后可编辑策略名称、说明、输入源、Skill、编排模式、风险规则、单标的最大仓位和各 Agent Prompt。保存不会修改官方模板或历史版本，而是追加新的不可变版本；此阶段仍不会执行 Agent 或生成订单。

## 当前关联

- 展示输入、分析、选股、决策、反思五类 Agent 的决策链路。
- 只读读取最近的选股运行、自选股列表和单股分析历史，并在页面中明确显示各输入是否可用；选股关闭、无数据或接口失败不会阻断模拟交易页面。
- 选股结果可作为选股 Agent 的候选池；自选股可补充观察范围；单股分析报告可作为分析 Agent 的研究上下文。
- 可切换输入 Agent 的 K 线、财经新闻、Reddit 与 Twitter/X 数据源演示开关。
- 展示各 Agent 的 system prompt 摘要和交接信息；编辑与版本管理尚未接入。

## 隔离边界

旧 `/simulation` 页面中的资金、收益、仓位、订单、账本与研究输出仍是本地预览数据。`/backtests` 的历史验证实验会持久化冻结行情、回放成交、资金曲线和指标，但这些记录独立于真实持仓、自选股、告警、旧单股分析回测和任何真实交易渠道，且不会触发下单。

后续接入顺序：模拟账户、订单和持仓账本 → Agent 编排与 Prompt 版本 → 用户主动导出的模拟策略回测。真实持仓是否允许以只读形式提供风控参考，需在该阶段另行确认。
# 自定义范围的行业候选与自然语言筛选

范围预览先按市场与所选行业取得真实成分股，再由 LLM 判断市值、波动、成长等自然语言条件。A 股行业使用新浪行业目录及成分股，行业粒度可能较粗，模型需进一步确认匹配；全行业使用已有市场快照。美股使用配置的股票目录或默认目录及其行业字段，港股仍需先指定股票。不把自然语言关键词转成固定交易规则。

行业过滤发生在数量限制之前。输入过大时按行业与市值规模分层取样，最多向模型发送 40 只；预览明确展示来源、过滤后数量和送入模型数量，因此不宣称穷尽全市场。行业分类缺失不会用概念标签代替。市值使用相应市场本币，模型需说明未给明确阈值时的判断口径。

模型返回的范围外代码、重复代码和超量结果均拒绝保存。确认后的名单随范围快照冻结，后续数据刷新不得扩展到未经模型确认的股票；变更自然语言或行业后重新预览。模型仅定义股票范围，具体买卖仍由交易 Agent + Skill 结合账户判断。

范围回答要求简短理由，输出预算上限为 16384 tokens（包含模型推理消耗），避免推理用尽预算后截断 JSON；请求仍受总预算校验，解析失败不保存部分名单。

Custom scope preview discovers real market/industry constituents before sampling, then asks the LLM to apply natural-language criteria. At most 40 industry/size-stratified candidates enter the model, with coverage counts disclosed. Confirmed symbols remain frozen; duplicate, out-of-pool and excess outputs are rejected. US coverage follows its configured/default universe; HK requires explicit symbols.

美股范围预览将最近 20 个交易日视作未指定日期的“过去一个月”，向模型提供日均成交股数、累计成交股数、统计起止日期、样本天数和行情日期。波动率为 20 个日收益率的年化标准差（百分比），并非月涨跌幅。行情拉取窗口为 60 个自然日；不足 20 天有效成交量或 21 个有效收盘价时，相应月度指标为空，不以短样本代替。成交量与波动未指定阈值时，模型可比较当前候选内的相对水平，必须说明口径；不代表全美股排名，也不保证一定有股票入选。预览总 Token 预算为 60000，以容纳新增行情证据和原有回答预算。

For US scope previews, an unspecified “past month” means the latest 20 trading sessions. The model receives average/total share volume, observation dates, sample size and quote date. Volatility is the annualized standard deviation of 20 daily returns (%), not monthly price change. A 60-calendar-day download supplies the window; fewer than 20 valid volume observations or 21 valid closes leave the corresponding metric unavailable. Without explicit thresholds, the model may compare candidates within this bounded sample and must state that basis, never claim a market-wide ranking or guarantee a selection. The preview token budget is 60000 to accommodate this evidence and the existing response allowance.
