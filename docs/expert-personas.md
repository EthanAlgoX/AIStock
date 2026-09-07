# 内置专家研究视角 / Built-in research personas

## 目录与边界

现有巴菲特、芒格、段永平、凯西·伍德、张磊保留原 ID；新增李录、彼得·林奇、朱少醒、谢治宇、吉姆·柯林斯、李国飞、彼得·德鲁克、马克·米勒维尼、杰西·利弗莫尔，合计 14 位。芒格不重复创建。新增专家通过同一专家目录供投研助理、个股、选股、交易及专家圆桌选择；不会自动扩大已选成员、修改默认策略成员或新增命名小组。

这些角色是参考公开方法的产品改编，不是本人、本人授权代理、私有模型复刻或当前投资建议。管理类角色只评价组织与经营，不凭管理口号给目标价；趋势类角色要求真实量价数据和明确风险边界，不保证收益。

## Prompt 契约

`src/services/expert_personas.py` 维护差异化研究视角与共同约束，`workspace_service.py` 继续作为目录与持久化入口。各角色包含专门的核查步骤、反例、失效条件及交付要求；公共部分要求来源/日期/口径、事实与推断分离、授权工具使用、协作独立性、语言与 Schema 兼容。数据不足时先交付支持得住的研究，再说明缺口，不能只返回占位提示。

沿用现有 Agent 调用链的 Persona Prompt 注入方式，不新增 LLM 后端或改变消息角色层级。提示词不授予工具权限；真实权限仍由 Runtime 强制约束。流水线、辩论和投票由现有编排决定，专家不能通过提示词自行变更协议。

## 升级、验证与回滚

首次读取目录或专家时补齐缺少的内置角色。只有 ID、内置身份、key 对应且 Prompt **完全等于旧版默认文本**的记录才自动升级，版本加一并更新时间；重复读取不会反复升级。名称、启用状态及其他用户设置保留。自定义 Prompt 不覆盖，新模板通过现有“恢复默认”显式采用。无需数据库结构迁移或新环境变量。

历史 Run 冻结的专家文本与版本不修改；旧讨论追问沿用冻结成员，想用新版需新开讨论或显式调整下一轮配置。新增角色不改变原五位的目录顺序，避免改变依赖目录顺序的默认选择。

测试覆盖目录去重、旧默认升级、幂等、禁用状态保留、自定义文本保护、恢复默认和现有协作/快照链路。确定性测试不能证明模型输出质量或名人方法有效性，未为验收自动发起收费研究。

回滚代码及 Web 构建可撤回新模板来源，但已保存的 Prompt 和新增目录记录不会自动撤回。若需完全撤销，使用部署前数据库备份或专家编辑入口逐项恢复；不要删除历史 Run。

## English summary

The catalogue now has 14 research personas: the five existing experts plus Li Lu, Peter Lynch, Zhu Shaoxing, Xie Zhiyu, Jim Collins, Li Guofei, Peter Drucker, Mark Minervini, and Jesse Livermore. Charlie Munger is retained, not duplicated. Existing IDs, default members, tool permissions, collaboration protocols, and historical snapshots remain unchanged.

Each persona combines a distinct research lens with evidence, counterexample, uncertainty, language/schema, and execution-boundary requirements. These are product adaptations of public frameworks, not impersonations, endorsements, proprietary-model replicas, or claims about current holdings. Management lenses do not substitute for valuation; trading lenses require actual market data and conditional risk plans.

Only exact legacy default prompts are upgraded automatically, once. Custom prompts and disabled states are preserved; the existing reset-to-default action adopts the new template explicitly. Saved discussion follow-ups continue using frozen personas. A code rollback does not reverse persisted catalogue updates; restore a pre-deployment database backup or edit affected personas if needed. No paid model quality evaluation is implied by deterministic tests.

## 公开参考 / Public references

以下资料用于核对方法主题，Prompt 均为原创改编；共同证据/安全/协作约束是本项目的设计，并非归于人物的原话。未将人物历史业绩或旧持仓作为选股证据。

- 巴菲特：[Berkshire Owner's Manual](https://www.berkshirehathaway.com/ownman.pdf)。企业所有者与资本配置视角。
- 李录：[Himalaya Capital](https://www.himcap.com/)。价值投资及长期企业研究。
- 林奇：[Fidelity strategy profile](https://research2.fidelity.com/fidelity/screeners/commonstock/strategy.asp?simpleStrategy=%7BF61E8D5C-32C9-499B-8F6D-DD6DAF53EB78%7D)。成长与价格约束。
- 朱少醒：[富国基金历史产品说明](https://www.fullgoal.com.cn/UserFiles/sxfxs/thcz-201505.pdf)。自下而上、成长、估值和管理质量；不是当前持仓信息。
- 谢治宇：[兴证全球对话基金经理](https://cloud.xqfunds.com/index.php/Xqmdm/list2)。官方访谈入口；均衡、相关性和情景清单是本项目的研究化设计。
- 柯林斯：[Concepts](https://www.jimcollins.com/concepts.html)、[Flywheel](https://jimcollins.com/concepts/the-flywheel.html)。组织研究而非股票交易系统。
- 德鲁克：[Five Questions](https://hesselbeininstitute.org/tools/sat/questions.html)。原始自评框架面向组织，本项目将其用于企业诊断。
- 李国飞：[公开演讲转载](https://finance.sina.com.cn/stock/jhzx/2019-11-25/doc-iihnzahi3312694.shtml)。属于转载而非已核验的本人官网，仅参考商业系统与演化主题。
- 凯西·伍德：[ARK research process](https://assets.arkinvest.com/media-8e522a83-1b23-4d58-a202-792712f8d2d3/719a680b-34b1-4b8b-a394-561c4edc6377/ARK-Invest-Summary.pdf)。自上而下与自下而上结合研究。
- 米勒维尼：公开著作 *Trade Like a Stock Market Wizard*；本次官网访问不可用，未声称核验专有参数，不编码固定交易阈值。
- 利弗莫尔：[历史方法研究](https://arxiv.org/abs/1407.2642)。为后人分析而非本人官网，历史方法需按现代市场条件重新验证。
- 芒格、段永平、张磊保留已有公开框架定位，本次新增核查步骤为项目设计，不添加未经核实的引语、人物现任职务或私有策略声明。
