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

范围预览先按市场与所选行业取得真实成分股，再由 LLM 判断市值、波动、成长等自然语言条件。A 股行业使用新浪行业目录及成分股，行业粒度可能较粗，模型需进一步确认匹配；全行业读取行业目录中的全部板块及分页成分股，并核对成分股接口声明的总数。美股、港股通过 Yahoo 股票筛选接口按交易所及行业查询，逐页读取数据源匹配的普通股票目录，不再依赖默认 50 只名单，也不要求港股先指定股票。不把自然语言关键词转成固定交易规则。

行业过滤发生在数量限制之前。新建策略默认量价全池排序，旧策略保留行业与市值抽样；两种方式最多向模型发送 40 只；预览明确展示来源、过滤后数量和送入模型数量，因此不宣称穷尽全市场。行业分类缺失不会用概念标签代替。市值使用相应市场本币，模型需说明未给明确阈值时的判断口径。

模型返回的范围外代码、重复代码和超量结果均拒绝保存。确认后的名单随范围快照冻结，后续数据刷新不得扩展到未经模型确认的股票；变更自然语言或行业后重新预览。模型仅定义股票范围，具体买卖仍由交易 Agent + Skill 结合账户判断。

范围回答要求简短理由，输出预算上限为 16384 tokens（包含模型推理消耗），避免推理用尽预算后截断 JSON；请求仍受总预算校验，解析失败不保存部分名单。

Custom scope preview discovers real market/industry constituents before sampling, then asks the LLM to apply natural-language criteria. At most 40 candidates enter the model after full-pool volume/volatility ranking or legacy industry/size sampling, with coverage counts disclosed. Confirmed symbols remain frozen; duplicate, out-of-pool and excess outputs are rejected. US/HK discovery paginates provider-classified equity directories by exchange and industry instead of using a default ticker list. CN discovery reads all matching Sina industry boards, including all boards for unrestricted queries, and validates their membership-endpoint counts.

美股范围预览将最近 20 个交易日视作未指定日期的“过去一个月”，向模型提供日均成交股数、累计成交股数、统计起止日期、样本天数和行情日期。波动率为 20 个日收益率的年化标准差（百分比），并非月涨跌幅。行情拉取窗口为 60 个自然日；不足 20 天有效成交量或 21 个有效收盘价时，相应月度指标为空，不以短样本代替。成交量与波动未指定阈值时，模型可比较当前候选内的相对水平，必须说明口径；不代表全美股排名，也不保证一定有股票入选。预览总 Token 预算为 60000，以容纳新增行情证据和原有回答预算。

For US scope previews, an unspecified “past month” means the latest 20 trading sessions. The model receives average/total share volume, observation dates, sample size and quote date. Volatility is the annualized standard deviation of 20 daily returns (%), not monthly price change. A 60-calendar-day download supplies the window; fewer than 20 valid volume observations or 21 valid closes leave the corresponding metric unavailable. Without explicit thresholds, the model may compare candidates within this bounded sample and must state that basis, never claim a market-wide ranking or guarantee a selection. The preview token budget is 60000 to accommodate this evidence and the existing response allowance.

## 行业目录覆盖与抽样 / Industry directory coverage and sampling

- 目录完整指已读完**该数据源、交易所和行业查询**返回的所有页，不保证数据源收录全部上市证券或行业分类绝对准确。美股覆盖 NYSE、Nasdaq 各板及 NYSE American、Arca、BATS 等所选交易所，港股覆盖 HKG；均为普通股票查询，不扩展至 OTC、ETF 或杠杆产品。多个行业取并集；信息技术对应 Technology，半导体对应 Semiconductors 和 Semiconductor Equipment & Materials。不同提供商的分类可能不同。
- Yahoo 目录按代码分页，校验页偏移、总数、重复代码、交易所和产品类型；重复、缺页、数量变化或达到分页保护上限时直接报错，不拿部分目录冒充完整目录。成功的目录缓存 15 分钟。A 股使用新浪成分股接口的总数核验分页结果（板块概览的公司家数可能截断为 100，不作校验依据）；源数据更新不同步也会要求重试。
- 候选排序方式可选全池量价排序或行业与市值分层抽样；两种方式均最多 40 只进入模型判断。`coverageStats` 分别记录 `directoryCount`、`eligibleCount`、`modelCount`、`monthlyEvidenceCount` 和 `sampled`。缺少行情的样本保留，但对应指标为空，不隐式视为符合条件。模型筛选不是对整个目录的全量排名，因此目录里存在智谱不保证其被抽中或入选。
- 当前仅支持最新行情的范围预览，行业目录也是当前分类；在描述里写历史日期不能回到历史时点。历史成分股、历史分类及杠杆产品映射尚未接入。此前已确认的名单仍冻结，刷新不会加入未经确认的股票。原 `SCREENING_US_TICKERS` 继续服务其原有行情/雷达入口，交易推演自动行业发现不再使用它；需要限制本次范围时填写指定股票。
- 复用已有 Yahoo 日线快照为抽样股票提供最近 20 个交易日的量价证据，包括 A 股的交易所后缀转换。目录有 90 秒等待上限；抽样行情为 90 秒，全池行情为 180 秒；模型调用为 60 秒，Web 预览为 360 秒。第三方失败明确报错，不回退到小名单。生产反向代理若有更短的超时，也应同步核对。

“Complete directory” means every page of the provider's requested exchange/industry query, not guaranteed coverage of every listed security. US/HK use ordinary-equity queries on the selected exchanges; OTC, ETFs and leveraged products are outside this directory. Industry choices are unioned using the provider taxonomy. Successful directories are cached for 15 minutes. Missing/repeated pages, changing totals, wrong exchanges/types and pagination limits fail explicitly. CN board membership is checked against membership-endpoint counts.

The discovered pool can use full-pool volume/volatility ranking or legacy industry/market-cap sampling; at most 40 shortlisted stocks enter the model. `coverageStats` discloses directory, eligible, sampled and complete-evidence counts. Missing observations remain visible as null metrics. This is not exhaustive market ranking, and directory inclusion does not guarantee selection. Only current classifications and latest-data previews are supported; typing historical dates does not create historical screening. Approved universes remain frozen. `SCREENING_US_TICKERS` retains its existing uses outside automatic trading-scope discovery; explicit symbols restrict a trading preview.

Directory requests are bounded at 90 seconds; sampled history at 90 seconds and full-pool history at 180 seconds; model inference at 60 seconds; Web preview at 360 seconds. Check shorter reverse-proxy timeouts before deployment. No schema migration or new environment variables are required. Rollback restores the previous discovery code and UI; existing saved previews remain readable.

### 全池量价排序 / Full-pool volume and volatility ranking

`scope.candidateRanking` 支持 `balanced`（原分层抽样）和 `volume_volatility`。API 未传时保留 `balanced`，避免改变既有调用；新建 Web 策略默认选择 `volume_volatility`，已保存策略的缺省仍显示原抽样方式，可暂停后修改并重新预览。

量价方式对行业过滤后全部候选分批读取日线（每批最多 200 只），不逐股请求公司简介或估值。以所选市场最后已收盘交易日为截止日；数据日期必须吻合、至少具备 20 日成交量与 21 个收盘价，且日均成交量与波动率为有限正值，才参与排名。计算 20 日平均成交股数及年化日收益率波动率，在有效子集中求平均秩分位，再取两项分位的等权平均作为 `screeningScore`，并列按代码排序，取前 40 只交给 LLM 依据自然语言复核。分数不是投资建议、收益预测或交易信号。

`coverageStats` 新增 `ranking`、`evaluatedCount`、`validCount`、`missingCount`、`asOf`，区分全部尝试、可排名和缺失/过期数量。缺失者不补零、不冒充符合；整个数据批次失败或总等待超时则报错，不悄悄降为原抽样。最终确认名单仍被冻结，每日刷新不会扩大名单或重新执行全池选股。回滚前可将新策略排序改为 `balanced` 并重新预览；无需数据库迁移。

`scope.candidateRanking` accepts `balanced` (legacy stratified sampling) or `volume_volatility`. Omitted API fields retain `balanced`; new Web forms default to the new mode while saved legacy scopes retain their original behavior. Pause, edit and re-preview to change an existing strategy.

The new mode reads daily bars for every eligible directory candidate in batches of up to 200, without per-symbol company-info requests. Only finite positive volume/volatility metrics with 20 volume sessions, 21 closes and the market's last completed session date qualify. Average-rank percentiles of 20-session mean share volume and annualized daily-return volatility receive equal weights; ties sort by symbol. The top 40 enter LLM review. Scores are screening metrics, not trade signals or return forecasts. Coverage reports attempted, valid and missing/stale counts and the cutoff date. Whole-batch failure or timeout fails explicitly; it never silently reverts to sampling. Confirmed universes remain frozen. For rollback, switch new scopes to `balanced` and re-preview; no schema migration is needed.
