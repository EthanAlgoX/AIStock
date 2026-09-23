# 投研助理中的策略创建

投研助理在现有对话输入区提供「创建策略」。支持个股研究方法、选股策略、交易推演策略。每个策略使用独立会话，顶部和历史列表标记策略用途；这与执行交易分析的对话不同。

## 使用流程

1. 选择策略类型，点击「开始创建」。已经有讨论时，可以点击「将当前讨论转为策略」，将最近六条消息及输入框内容带入新会话的输入框，用户检查后发送。携带文本最多 12,000 字符。
2. 描述需求并继续讨论。助理每轮输出完整的 `strategy-draft` JSON，页面展示目标、股票范围、方法、风险、所需数据、运行与输出、待确认项。原始输出可展开查看。需要改名或修改参数时直接继续发消息。
3. 展开草稿，点击「检查策略完整性」。此检查验证结构、必填内容和待确认项，**不代表真实数据可用、策略收益有效或交易输出已经验证**。待确认项须先通过讨论解决。
4. 点击「保存为 Skill」，写入现有工作区技能库。个股研究点击「配置个股研究工作流」，选择股票及同市场已发布研究版本；保存任务时冻结所选方法的正文，正式报告使用该方法。选股点击「配置选股工作流」，选择同市场已发布筛选版本；Skill 仅用于结果解读，不改变该版本的股票池、硬筛和排名。讨论中的自然语言不能自动编译为可执行筛选规则。
5. 交易策略点击「配置交易推演」，将 Skill、名称和范围描述带入现有配置页。检查市场、行业、资金和风险配置，预览真实股票范围后保存策略；交易策略沿用保存时的 Skill 快照。
6. 在交易推演中选择运行一次、历史验证或持续模拟。保存 Skill 或保存策略定义均不等于已经启动自动运行。持续模拟沿用服务器调度；每日评估不等于盘中触价网格。

## 保存与版本边界

- 草稿、会话类型、版本、完整性检查状态和 Skill 引用存储在当前工作区数据库的 `assistant_strategy_drafts` 表；刷新或其他设备打开同一工作区会话可以恢复。
- 新一轮回答不完整、缺少结构化草稿或有新的用户消息时，旧草稿仅供查看，不能沿用其检查状态保存。
- 同一版本重复保存复用同一 Skill；内容修改后生成新的 Skill，已配置的交易推演保留原 Skill 快照。
- 个股和选股正式任务在保存时冻结所选 Skill 内容；修改原 Skill 不会悄悄改变已保存任务，显式重新保存任务配置才会更新方法快照。正式结果生成后的模型解读只使用该次结果，不能再次搜索或改写原始候选、分数。运行记录保留策略版本及方法快照。
- 查询到实际引用该 Skill 的交易策略定义后，显示「已发布到交易推演」及对应链接。此状态表示定义存在，不表示模拟已运行或验证已通过。
- 删除会话同时清除草稿状态，已保存的 Skill 和交易策略保留。
- 新表由现有数据库初始化流程创建；不新增环境配置，不改变已有 API 字段或交易执行规则。

## 接口与实现约定

接口位于 `/api/v1/workspace/strategy-drafts/{session_id}`：GET 读取，POST 创建；`/sync` 从服务器最新会话消息同步草稿，`/validate` 检查完整性，`/save` 保存 Skill。后两者要求整数 `revision`，旧版本返回冲突。会话遵循现有认证及工作区数据库隔离。

策略创建指令由服务端读取会话状态后注入共享的聊天准备流程，适用于现有 LiteLLM、Codex 和 external runtime 后端。客户端不能通过同名上下文字段伪造创建指令。草稿仅为自然语言方法，不执行生成的代码，不增加发布或交易工具权限。

## 验证与回滚

回归测试覆盖真实 SQLite 存储、重复及并发保存、版本失效、截断回答、工作区隔离、HTTP 输入约束、三种后端共享 Prompt 和前端交易配置转入。模型内容质量和真实行情试运行仍需在配置好的环境验证。UI 验收使用明确标记的演示数据，截图仅作为本地验收产物。

回滚代码即可恢复旧入口；新增表可保留。已保存 Skill 使用原有格式，可继续由旧版模块读取。已启动模拟需在交易推演中单独暂停，回滚 UI 不会停止服务器任务。

## English summary

The assistant can create dedicated research, screening, and trading strategy conversations. Drafts persist in the workspace database. Users discuss revisions, check required content, explicitly save a versioned Skill, then configure a formal research or screening task with a published workflow, or a trading simulation through the existing form and stock-universe preview. Research tasks freeze the selected method text and apply it to the report. Screening Skills interpret the published screening result; they do not change the screening rules. Completeness checks are not market-data, execution, or performance validation. Saving a Skill does not start a scheduled simulation. Incomplete turns invalidate earlier checks; existing simulations retain their original Skill snapshot. Rollback restores the old UI while retaining compatible Skills and the additive draft table.

### 紧凑入口

“创建策略”位于投研助理标题旁。点击展开策略类型、新建或沿用讨论操作；进入策略对话后，同一入口查看草稿、检查完整性及保存 Skill。面板悬浮显示，点击外部或按 Escape 收起，收起时不占用消息或输入区高度。
