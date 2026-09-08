# 个股研究报告 / Stock research report

## 阅读结构

个股研究 `/stock-research` 的正式结构化报告采用“研究结论 + 可视化决策面板 + 证据对照”。借鉴 daily_stock_analysis 的评分仪表与四类策略条件组织方式，使用网站既有明暗主题、钴蓝与语义色，去除霓虹渐变和光晕。阅读顺序为股票与历史快照、核心判断、量价面板、观察与行动条件、正反信号及详细正文，最后查看研究边界与来源。

报告前部展示双弧形仪表：情绪与趋势评分共用 0–100 刻度，配合量比、换手率及 MA5 乖离。纵向价格地图对照报告价格、支撑阻力和 MA5/10/20，高价在上；引线将密集点位连接到不重叠的标签，数值仍按真实价格映射。四类行动条件以双栏图标面板展示，完整保留原文，不自动拆分或猜测价格。正文使用完整宽度；正向信号和风险以双色双栏呈现，窄屏折成单栏。报告记录阶段、未完成 K 线或数据限制时，标题下显示提示及限制链接。目录使用真实锚点，不隐藏章节。评分不是获利概率或独立市场指数。

已有历史记录时，默认方案折叠为快速试用入口，不占据报告首屏；首次使用仍直接显示默认方案。已结束任务的上下文可展开，运行中自动展开；后台运行、历史选择、错误与原始结果追溯保留。选股、交易及旧首页报告不切换展示模式。

## 数据契约

`WorkflowArtifact` 仅在个股研究入口向正式 `ReportSummary` 传递 `presentation="memo"`。`ResearchMemo` 读取已持久化的 `meta / summary / strategy / details`，以及 `rawResult.dashboard` 中核心结论、正反信号、催化/风险、阶段数据限制与观察条件。兼容原始字段的 camelCase / snake_case；不调用模型重新生成、分类或补造结论。

没有独立证据清单时显示“未单独列出”，不视为无风险或数据完整。不构造专家发言、共识、收益率、置信度、历史行情或来源。`ResearchVisuals` 读取 `dataPerspective.pricePosition / trendStatus / volumeAnalysis` 的有限数值，兼容 camelCase 和 snake_case。价格优先使用 meta.currentPrice，缺失时使用 pricePosition.currentPrice；至少两个正数点位才绘图，各行共享价格刻度而非时间轴。评分仅接受 0–100，缺失或无效值显示未记录，零分保留；不从文字中提取价格补画图表。研究正文里的原有措辞保持不变；条件点位保留价格与前提，不简化为无条件操作。资料可能来自后续检索的关联资讯明确标注，并放在来源区展开。

英文模式翻译界面标签，历史正文和用户内容不自动翻译。原始数据、运行详情、分享导出链路继续复用；分享图片仍由既有导出服务渲染，不承诺与新阅读版式一致。成功 ResearchReport 且包含非空 meta、summary 时采用备忘录，包括符合结构的历史报告；缺少证据字段时显示缺失提示，不整体回退。未匹配的 Markdown／对象成果保留原兼容渲染；市场复盘、带自选控件和选股内的候选深研保留原展示。

## 验证与回滚

### 专家评审 / Expert review

个股研究将 `ExpertOpinion` 与 `ExpertReview` 聚合为同一评审阅读区，先展示主持人汇总，再通过专家立场面板选择独立意见。汇总的冲突矩阵按“原报告 / 专家意见 / 主持人处理”展开；每份独立意见以“观点 / 支持依据 / 反证与限制”阅读，风险、分歧、待核实问题、后续研究与完整原始记录可单独展开。只读取持久化的 `structured` 和 `structuredConclusion`，不重新调用模型、生成摘要或推断共识；命名专家明确标注为 AI 框架模拟，非本人发言。

汇总内与独立成果重复的专家快照按完整载荷（不含展示标题，顶层字段排序后比较）去重；不同版本、错误内容和扩展字段保留。自评信心只接受 0–1 的有限数值（含零），按百分比绘条；不接受 45 等不明单位数值，也不计算平均信心。未识别扩展字段保留于完整原始记录。无结构化意见时展示原始说明。独立专家讨论页面不变；选股与交易工作区也复用这一评审视图，见[工作区报告](workspace-decision-reports.md)。

The stock reader groups expert opinions and host reviews into one dedicated section. Readers compare recorded positions and self-rated confidence, select an expert, and inspect claims against supporting evidence and counterevidence. Host conflict topics expand into original-report / expert-view / host-resolution columns. Identical aggregate snapshots are deduplicated; distinct revisions, failures and raw extensions remain available. Confidence accepts finite values within 0–1 only and is not a success probability or an averaged consensus score. No new model calls or inferred conclusions are introduced. UI labels follow language selection; historical prose is preserved. Screening and trading workspaces now reuse this expert view; standalone discussion remains unchanged.

前端测试覆盖结构化正反证据、零值、缺失数据、原文保留、英文标签和目录锚点，并回归工作区历史和其他成果类型。浏览器使用真实历史报告检查桌面与移动阅读，不触发收费分析。仅修改前端，不改变 API、任务配置或报告存储结构。回滚本次代码并重新构建 Web 即可，无数据库迁移。

## English summary

Stock research pairs two arc gauges with a vertical price map and volume metrics. Inspired by daily_stock_analysis’s score-and-strategy structure, it uses the existing neutral/cobalt identity without glow or gradients. Price marks share a vertical numeric scale, highest first; leader lines separate crowded labels, not historical observations. Four conditional reference panels precede the detailed evidence and narrative, preserving all original prerequisites. Only recorded finite values are used; at least two positive price levels are required to plot, scores must be within 0–100, and missing values remain unavailable. No prices are extracted from prose. Mobile stacks the panels. Scores are not profit probabilities. Missing evidence is explicit and never converted into verified findings.

Existing reports, prices, conditions, and original-language prose are preserved. No model calls, invented claims, expert consensus, or chart data are introduced. Running tasks stay visible; completed task context and repeat-use default setup are expandable. Screening, trading, legacy report rendering, and image-export layouts retain their existing behavior. Revert the frontend change and rebuild to roll back; no data migration is involved.
