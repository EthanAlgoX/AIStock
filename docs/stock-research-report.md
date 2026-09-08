# 个股研究报告 / Stock research report

## 阅读结构

个股研究 `/stock-research` 的正式结构化报告采用“投研备忘录 + 证据对照”。保留网站既有明暗主题与控件，不沿用大号情绪圆环和狙击点位卡片。首屏是股票、历史价格快照、核心判断；随后阅读正反信号、详细正文、观察与行动条件，最后查看来源与运行记录。

宽屏以正文加研究边界侧栏呈现；窄屏证据双栏折成单栏，完整研究边界位于条件章节之后。报告记录阶段、未完成 K 线或数据限制时，标题下显示对应提示及限制链接。目录使用真实锚点，不隐藏章节。原情绪分数保留在辅助信息折叠项，标明不是获利概率或独立市场恐慌指数。

已有历史记录时，默认方案折叠为快速试用入口，不占据报告首屏；首次使用仍直接显示默认方案。已结束任务的上下文可展开，运行中自动展开；后台运行、历史选择、错误与原始结果追溯保留。选股、交易及旧首页报告不切换展示模式。

## 数据契约

`WorkflowArtifact` 仅在个股研究入口向正式 `ReportSummary` 传递 `presentation="memo"`。`ResearchMemo` 读取已持久化的 `meta / summary / strategy / details`，以及 `rawResult.dashboard` 中核心结论、正反信号、催化/风险、阶段数据限制与观察条件。兼容原始字段的 camelCase / snake_case；不调用模型重新生成、分类或补造结论。

没有独立证据清单时显示“未单独列出”，不视为无风险或数据完整。不构造专家发言、共识、收益率、置信度、行情图或来源。研究正文里的原有措辞保持不变；条件点位保留价格与前提，不简化为无条件操作。资料可能来自后续检索的关联资讯明确标注，并放在来源区展开。

英文模式翻译界面标签，历史正文和用户内容不自动翻译。原始数据、运行详情、分享导出链路继续复用；分享图片仍由既有导出服务渲染，不承诺与新阅读版式一致。成功 ResearchReport 且包含非空 meta、summary 时采用备忘录，包括符合结构的历史报告；缺少证据字段时显示缺失提示，不整体回退。未匹配的 Markdown／对象成果保留原兼容渲染；市场复盘、带自选控件和选股内的候选深研保留原展示。

## 验证与回滚

前端测试覆盖结构化正反证据、零值、缺失数据、原文保留、英文标签和目录锚点，并回归工作区历史和其他成果类型。浏览器使用真实历史报告检查桌面与移动阅读，不触发收费分析。仅修改前端，不改变 API、任务配置或报告存储结构。回滚本次代码并重新构建 Web 即可，无数据库迁移。

## English summary

Stock research now uses a memorandum with an evidence comparison: thesis first, recorded supporting/counterarguments next, conditional price references and review questions, then provenance. A compact boundary margin replaces the dominant sentiment gauge. Missing evidence is explicit and never converted into verified findings. Mobile stacks the reading columns.

Existing reports, prices, conditions, and original-language prose are preserved. No model calls, invented claims, expert consensus, or chart data are introduced. Running tasks stay visible; completed task context and repeat-use default setup are expandable. Screening, trading, legacy report rendering, and image-export layouts retain their existing behavior. Revert the frontend change and rebuild to roll back; no data migration is involved.
