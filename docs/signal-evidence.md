# 新闻、社交与量价规则证据

[English](signal-evidence_EN.md)

参考 `market-radar` 的新闻采集、帖子出处和 K 线规则事件，本次优化优先让已有分析输入可核查，并明确数据不足时的限制。继续复用 DSA 的 SearchService、社交聚合服务、StockTrendAnalyzer、pipeline 和 AnalysisContextPack，没有复制一套交易信号服务。

## 借鉴取舍

| 参考做法 | 本项目本次落地 | 暂不引入 |
| --- | --- | --- |
| 新闻保留来源、时间与稳定身份 | 按需检索跨维度保守 URL 去重；重复命中引用同一证据；明确未知时间、失败与空结果 | 修改资讯库去重键，或自动合并检索与本地资讯池 |
| 社交帖子保留作者和原文 | 已有聚合接口在字段提供时保留作者、合法链接和上游时间；社交内容作为独立辅助输入 | Reddit / X 新连接器、账号登录或 OAuth |
| K 线事件保留规则参数和数值 | 在既有趋势结果中补充可用性、窗口告警、日期/来源与 20 根量价观察事件 | 独立事件数据库、事件修订/撤回生命周期、交易执行器 |
| 信号消费区分事实与推断 | 新闻、社交和技术证据分开解释；复用固定六块的数据质量与 Prompt 限制 | 新交易 action、独立信号评分或盈利承诺 |

## 新闻与社交

`SearchService.count_unique_intel_results(intel_results)` 统计成功响应中已取得的独立检索结果；`format_intel_report()` 使用相同 URL 身份，只去掉普通 fragment 锚点及主 URL 查询中的 `utm_*`、`fbclid`、`gclid`、`mc_cid`、`mc_eid`。`/` 或 `!` 开头的 hash 路由及其内部查询原样保留，避免把不同单页应用文章合并。业务查询参数的值、顺序、编码和路径大小写保持原样，无 URL 不按标题合并。此身份只用于按需检索报告与计数，不修改 `intelligence_items` / 搜索结果持久化身份，也不推断不同 URL 的转载属于同一新闻。

报告每维度最多展示 4 条，重复命中只保留证据引用与出处，不重复摘要。检索计数不能解释为全部进入模型。展示条目保留发布方、合法原文链接与上游发布时间；未知或不可解析时间明确标注，不能证明近期催化。失败响应不计证据；失败诊断与筛选后空结果分开说明，都不证明没有相关事件。失败文本和敏感链接复用现有脱敏，原文链接只接受不含凭据的绝对 HTTP(S) 地址。

社交评论未经核实。帖子字段提供时保留作者、合法原文链接和 `published_at` / `created_at` 原始时间，时间缺失明确未知，不补造时间。热度、提及数、投票或情绪分是平台统计，不能当作新闻事实、新闻因果或交易方向置信度；不同平台分数不直接相加。

## 技术输入

`TrendAnalysisResult.to_dict()` 在既有结果上追加以下可选补充字段，旧消费方仍可使用原字段：

| 字段 | 含义 |
| --- | --- |
| `indicator_availability` | 均线、量比、MACD、各周期 RSI 及 `rule_events` 的可用性；空事件列表本身不说明是否已预热 |
| `analysis_warnings` | 有效窗口、预热、显式未闭合/估算日线、缺口和来源口径限制 |
| `analysis_date` / `analysis_source` / `valid_bars` | 分析末根日线日期、已有来源及当前窗口条数；缺失来源保持未知 |
| `rule_events` | 观察事件，含 `rule_id`、`rule_version`、`parameters`、`evidence`、`bar_date`、`source`、`reference_start` / `reference_end`、`direction`、`summary` |

`range20` 比较末根收盘与此前 20 根日线最高/最低价；`volume20` 比较末根成交量与此前 20 根均量，达到 2 倍时记录观察。当前日线不参与参考窗口；成交量观察不表示上涨或下跌方向。这些事件不生成新的交易 action，也不计入既有 `signal_score`。

MA60 不足 60 根有效样本时保持不可用，不以 MA20 替代。MACD 需要 35 根连续样本；各周期 RSI 需要周期加 1 根，完整 RSI 需要 25 根。不可用的 MACD / RSI / 量比不凭默认状态加分；仍沿用现有评分框架，短窗口的结果可能因此变化。

末段显式未闭合或估算日线保留用于既有盘中 `current_price`、均线、MACD / RSI 估算，`analysis_warnings` 说明限制；该末根不生成确认规则事件，`indicator_availability.rule_events=false`。历史中间的未闭合、估算或无效记录，以及识别到的缺口、来源或复权/单位口径变化会截断窗口并重新预热。无闭合标记的既有日线保持兼容，不宣称完成交易所闭合校验、完整交易日历或供应商复权验证。

必要日线字段先经 BaseFetcher 整批校验，再进入指标与保存；自动路由遇到无效批次会继续现有备用链。显式或冻结历史截止日同时约束数据库和网络返回，不接受截止日之后的数据。零成交量与竞价口径保留兼容，旧库存中已丢失的坏行不能补回；详见 [数据源稳定性](data-source-stability.md)。

## 上下文与兼容

`PipelineAnalysisArtifacts` 继续保留合并的 `news_context`，增加可选 `news_evidence_context` 与 `social_context`。pipeline 设置 `metadata.news_channels_separated=true` 后，builder 分别构造 `news` 和 `social`；旧 caller 未提供标记时保留原 `news_context` 读取方式。仅有社交内容或检索诊断文本不填补新闻证据。本地资讯仍 best-effort 追加到新闻输入，但不计入独立检索结果数。

`social` 附 `social_sentiment_unverified` 告警和 `metadata={"auxiliary": true, "quality_weighted": false}`，不参与固定六块 `quote`、`daily_bars`、`technical`、`news`、`fundamentals`、`chip` 的质量分。`indicator_availability.ma20=false` 时基础趋势历史不足，`technical` 为 `missing`，原因码为 `technical_history_insufficient`，该块状态质量分为 35；已有 MA20 但其它指标未预热，或有实时估算覆盖时为 `partial`。这些限制进入既有 Prompt / overview。Agent overview 仅描述初始输入，不包括后续工具取回的新闻或指标。

本次没有新增配置、依赖、数据库迁移、公开 API 参数或真实下单能力。未新增报告输出 action / score 契约。详见 [上下文包](analysis-context-pack.md) 与 [资讯源](intelligence-sources.md)。

公开 overview 使用稳定的 `technical_input_limited` 告警码表示技术输入限制，由界面按语言解释；完整窗口诊断仍保留在技术输入的 `analysis_warnings` 中供分析使用。

## 验证与回滚

以下确定性命令用于验证实际搜索、社交、技术与上下文联动；最终执行结果见交付记录，不把命令列表当作通过证据：

```bash
python -m pytest -q tests/test_search_intel_evidence.py tests/test_search_news_freshness.py tests/test_news_strategy_config.py
python -m pytest -q tests/test_social_sentiment_service.py tests/test_stock_analyzer_evidence.py tests/test_stock_analyzer_rsi.py tests/test_stock_analyzer_bias.py
python -m pytest -q tests/test_analysis_context_builder.py tests/test_analysis_context_pack_prompt.py tests/test_analysis_context_pack_overview.py tests/test_intelligence_analysis_integration.py tests/test_agent_pipeline.py tests/test_pipeline_realtime_indicators.py tests/test_analysis_context_pack_docs.py
python -m pytest -q tests/test_agent_analysis_evidence.py tests/test_analyzer_news_prompt.py tests/test_agent_executor.py
./scripts/ci_gate.sh
```

这些检查不等于在线平台/LLM 验证、完整交易所闭合验证或回测验收，也不能证明盈利提升。临时页面/报告验收截图应保留在交付证据或 PR 附件，不提交到仓库。

回滚时按 `git diff` 逐个撤销本次涉及的搜索、社交、趋势、pipeline、builder、Prompt、测试和文档变更；工作区如有用户其它改动，应只反向应用本次补丁，不整文件覆盖。发布后可回退包含本次变更的版本。无需数据库或配置迁移回滚。
