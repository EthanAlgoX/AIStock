# 单股上下文采集模式

`StockAnalysisPipeline(context_only=True)` 通过 `process_single_stock` 返回
`PipelineAnalysisArtifacts`，供外部分类器复用单股分析输入。

```python
pipeline = StockAnalysisPipeline(context_only=True, portfolio_context={})
artifacts = pipeline.process_single_stock("600519", single_stock_notify=False)
```

此模式保留历史数据获取、实时行情、筹码、基本面、技术指标、新闻和增强上下文。
不初始化报告分析器和通知器，不进入 Agent 分支，不生成或保存分析报告，也不从报告抽取信号。
大盘上下文只复用已有结果，不生成新的大盘报告。

`AnalysisContextBuilder.build(artifacts)` 可生成标准数据包；完整增强上下文仍在
`artifacts.enhanced_context`。daily_bars 包含 today / yesterday，不是完整历史序列。

接口返回 None 表示采集流水线失败；返回 artifacts 仍可能含降级或缺失数据，消费方必须校验。
`context_only` 不支持报告批处理 `run()`，调用会显式报错。

默认 `context_only=False`，现有报告流程保持原语义。本扩展无新增环境变量。

验证：`python -m pytest tests/test_pipeline_context_only.py tests/test_pipeline_market_phase_context.py tests/test_analysis_context_builder.py tests/test_pipeline_fetch_error.py -q`。

回滚：移除 context_only 参数、相应返回分支及配套测试/文档；外部消费方需要同步停止使用该入口。
