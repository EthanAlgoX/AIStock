# 网站功能与业务逻辑核查

## 功能主线

| 功能 | 输入与执行 | 结果与边界 |
| --- | --- | --- |
| 个股研究 | 股票、市场、正式策略版本、Skill；命中持仓后冻结实际账户数据 | 正式研究报告、当次评分、证据与持仓建议；历史评分不作为每日独立判断输入 |
| 持仓管理 | 交易账本提供数量与成本；保存跟踪计划到数据库 | 手动或后台定时研究；每日曲线按交易日汇总，手动结果优先；多账户成本分开 |
| 关注股票 | 股票与市场，显式使用空持仓上下文 | 保留研究评分和证据，不输出持仓操作字段；与持仓相同的每日曲线替换规则 |
| 策略选股 | 正式版本产生真实候选池，LLM 比较与解释；可追加候选个股研究 | 排名和匹配分保留原始结果；自然语言未验证条件列出，不等同于交易订单 |
| 交易推演 | 确认范围、冻结 Skill、模拟账户和截至决策日行情 | Agent 输出目标权益比例，程序校验并模拟后续成交；行情缺失拒绝运行，不补造收益 |
| 任务与运行 | 后端保存任务快照、执行状态、成果、调度记录 | 页面查询后端账本；浏览器关闭不会关闭服务器调度；失败不能伪装成空的成功结果 |
| 通知与告警 | 使用已配置的通知渠道和路由；跟踪任务可启用每日研究通知 | 通知失败不改变已完成研究状态；发送与研究分别核查 |
| 能力与设置 | 模型、工具、MCP、Skill、专家配置提供运行能力 | 配置可用不代表当次数据抓取成功，以运行证据与错误为准 |

## 本轮确认并修复

1. 关注曲线缺少手动优先规则：后来自动结果可能覆盖同日手动结果。统一为手动优先、同类型取较新结果，输出不泄漏内部优先级。
2. 关注报告仅删除摘要操作字段：策略买卖价位及原始报告副本仍可能包含操作建议。正式关注成果移除这些字段，保留摘要评分及技术、基本面、新闻、风险内容；不修改共享对象。
3. 持仓研究接受空字典：缺少持仓也可能进入模型。空持仓立即报错，禁止静默当作普通研究继续。
4. 股票档案重复查询不触发请求：同一股票查询失败后无法重试。提交查询显式刷新，并区分加载与错误状态。
5. 股票档案未接入语言上下文：英语界面仍显示中文固定文案。补充双语、响应语言切换。
6. 前端测试漂移：选股字段已明确改为分析关注点，运行账本已切换分页接口；测试仍依赖旧文案、旧接口及非行为性的 CSS 类。同步测试并保留提交、分页查询和按钮可操作性检查。
7. 浏览器截图发现窄桌面宽度下英文主导航溢出、覆盖品牌和辅助导航：导航区域改为可横向滚动，保持按钮可访问。

## 已确认的范围规则

已确认采用先按市场/行业取得真实候选，再由 LLM 按自然语言筛选。具体数据源、分层取样和冻结名单边界见 `simulation-trading.md`。

## UI 设计逻辑后续方向

采用 impeccable 对持仓、范围配置、导航与报告操作进行独立源码审查和静态扫描。先修复范围旧文案、预览/确认语义和持仓筛选空结果操作；保持现有主题。持仓与关注已改为独立简报分区，分别保留搜索和市场筛选；持仓搜索包含展示名称。新增研究运行状态、历史结果说明和关注空状态，关注研究运行中每 5 秒刷新。定时跟踪总数包含持仓与关注。下一阶段再统一结果页追问与讨论入口及导航权重。静态检测无发现不代表完整可用性验收。此轮 19 项相关测试、lint 和构建通过；使用只读模拟数据检查桌面与 390px 手机宽度的持仓空结果页面，并验证清除筛选可恢复股票显示。未完成真实数据全流程或读屏验收。

UI refinement preserves the existing visual system while clarifying scope preview versus save, natural-language criteria and recovery from empty holding filters. Holdings and watch briefs now have separate views and filters, explicit research states, and watch-only empty states. Active watch research also triggers prompt polling. Navigation changes remain a separate step.

## 验证范围

检查覆盖后端研究、选股、交易、调度、通知诊断与 API 回归，以及前端全量测试、lint 和构建。浏览器视觉检查使用模拟只读接口，仅验证页面渲染，不作为真实模型、登录或通知投递验证。线上只读检查确认调度存在最近执行时间及下一次计划；历史行情不完整导致的交易拒绝保留。

旧分析历史原文不重写；关注成果的结构化过滤不等同于对全部历史自由文本完成审查。未实际向外部通知渠道发消息，未对未来交易日作收益或调度成功保证。接口结构向后兼容，无数据库迁移；回滚本次代码并恢复上一镜像即可。

## English summary

Research, holdings/watch tracking, screening and simulated trading retain distinct input and output contracts. This audit fixes watch-history precedence, execution-field leakage in watch artifacts, empty holding inputs, same-stock archive retry and archive localization. Tests now follow current labels and the paginated run-history API. Candidate discovery now filters by market and industry before LLM selection, as confirmed by the user. Historical prose is unchanged; browser checks use read-only fixtures, and no external notifications are sent during validation.
