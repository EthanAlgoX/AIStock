# InvestCrew 策略包规范

本规范定义自定义策略包与平台之间的稳定边界。平台已开放 ZIP 包上传、结构解析、数据依赖核对、不可变归档和受限函数调用。API 进程不会导入用户代码；代码只在独立子进程中通过统一 `run(context)` 入口执行。内核与运行配置是两个独立对象：用户从内核创建 StrategyVersion 配置草稿，配置市场、股票范围、数据源、周期、参数和风险边界后，才形成可检查、发布和运行的完整策略。

## 1. 策略类型

策略必须且只能声明一种 `purpose`：

| purpose | 输出契约 | 产品入口 |
| --- | --- | --- |
| `research_report` | `ResearchReport` | 单股研究 |
| `candidate_screening` | `CandidateList` | 选股扫描 |
| `trading_decision` | `DecisionProposal` | 回测中心、运行中心 |

`DecisionProposal` 只表示研究决策意图，不是订单，也不得声称已经成交或产生收益。

## 2. 建议目录

```text
strategy-package/
├── strategy.yaml
├── strategy.py
├── STRATEGY.md
├── schemas/
│   ├── input.json
│   └── output.json
├── tests/
├── README.md
└── requirements.lock
```

## 3. Manifest 示例

```yaml
strategyId: cn-mean-reversion
name: A股均值回归研究策略
version: 1.0.0
purpose: trading_decision
runtime: python
entrypoint: strategy:run
markets: [cn]
configurable:
  markets: [cn, hk, us]
  timeframes: [1d, 1w]
  runIntervals: [1d, 1w]
inputs:
  schema: schemas/input.json
outputs:
  contract: DecisionProposal
  schema: schemas/output.json
documentation:
  file: STRATEGY.md
dataRequirements:
  - id: primary_ohlcv
    type: market.ohlcv
    kind: kline
    sourceIds: [system_market_data]
    markets: [cn]
    frequency: 1d
    lookback: 120
    required: true
    usage: 计算均线、波动率与研究信号
    onMissing: fail
parameters:
  - name: moving_average_days
    type: integer
    default: 20
```

`sourceIds` 必须引用策略生成指南复制时从当前数据中心动态写入的、状态为 `available` 的真实来源。每项依赖还必须声明唯一 `id`、类型、适用市场、频率、回看范围、用途、`required` 和 `onMissing`。必需依赖使用 `onMissing: fail`，可选依赖使用 `onMissing: degrade`；尚未配置的来源不能冒充已满足依赖。

`configurable` 声明策略内核允许网站调整的市场、数据周期和运行频率。上传后，网站先把策略包保存为可复用内核；从内核创建的独立 StrategyVersion 再保存市场、股票范围、数据源、周期、参数和风险边界。一个内核可以派生多套配置，策略代码不得把这些最终运行值写死。

## 4. 通用执行边界

唯一入口为：

```python
def run(context: StrategyContext) -> StrategyResult:
    ...
```

真实 JSON context 包含 `runId`、`strategyId`、`strategyVersion`、`mode`、`asOf`、`inputs`、`parameters`、`configuration`、`data`、`dataCoverage` 和 `warnings`。`configuration` 包含 market、universe、timeframe、dataSources、risk 与 screeningPolicy；`data` 只包含平台按依赖声明授予的快照。策略不得读取未声明数据、平台文件、数据库、环境变量或网络，也不得把密钥写入包内。

输出必须是 JSON 对象，且输出 Schema 必须把 `status`、`contract`、`dataCoverage`、`warnings` 声明为 required。`contract` 固定为策略类型对应契约，`result` 承载业务结果。缺少必需数据时返回 `status: failed`、`reasonCode: REQUIRED_DATA_MISSING`、`message` 和 `missingInputs`；缺少可选数据时在覆盖信息和警告中明确降级，不得补造数据。

## 5. 输出最低字段

### ResearchReport

至少包含证券标识、截止时间、摘要、研究维度、风险、证据引用和数据覆盖情况。

### CandidateList

至少包含市场、截止时间、候选列表、排名分数、入选理由、风险、筛选统计和数据降级说明。

### DecisionProposal

至少包含截止时间、研究动作、证券标识、目标权重或方向、置信度、依据、风险、失效条件和有效期。它不能直接创建订单。

## 6. 策略说明

每个策略包必须包含独立的 `STRATEGY.md`。它面向使用策略的普通用户，不是开发 README，至少说明：策略目标和类型、核心思想、适用市场与周期、完整处理步骤、参数及调整影响、输出解读、缺失数据时的行为、已知限制与风险边界，以及建议的回测方法和通过条件。

策略说明必须包含数据依赖表，逐项列出数据名称、类型、必需/可选、真实 `sourceId`、适用市场、频率或回看范围、用途，以及缺失时的失败或降级行为。该表必须与 `strategy.yaml.dataRequirements` 一一对应。

说明不得声称尚未实际验证的收益、胜率或有效性。包含 LLM 的策略还必须说明 LLM 的使用位置、上下文、输出校验和失败降级方式。`README.md` 只负责开发、测试和调用方法，不能替代策略说明。

## 7. 生成提示词

优先在网站打开“策略生成指南”并复制动态指南；页面会把当前数据中心目录一并写入提示词。然后交给 Claude Code 或 Codex，并补充：

```text
请按照 InvestCrew 策略包规范生成一个完整策略包。
我的策略想法：A 股日线均值回归研究策略。
请提供 strategy.yaml、实现代码、输入输出 Schema、STRATEGY.md、依赖锁文件、README 和可重复运行测试。strategy.yaml 与 STRATEGY.md 必须使用指南中当前可用的真实 sourceId 声明一致的数据依赖。
不得包含密钥，不得补造行情、收益、订单或成交。
```

## 8. 当前受限执行边界

上传时会检查路径穿越、文件数量与体积、Manifest、输入输出 Schema、依赖说明一致性、唯一 `run(context)` 入口、顶层副作用、导入范围和危险反射/文件函数。`requirements.lock` 当前必须为空或只含注释，运行时只允许受控 Python 标准库。

执行时使用 `python -I` 独立子进程，清除平台敏感环境变量，并限制墙钟时间、CPU、打开文件数、子进程数、文件/输出大小；Linux 额外限制地址空间。该边界不是通用容器沙箱，因此平台同时依赖严格静态白名单，不允许用户代码直接联网或读取平台文件。当前完整策略自动授予的数据只覆盖平台本地 OHLCV；其他类型可由明确调用输入提供，否则必需依赖按契约失败、可选依赖降级。它不会创建订单、成交、持仓或收益。

可通过 `POST /api/v1/simulation/definition/strategy-versions/{versionId}/execute-kernel` 进行受限调用。正式产品页面只接受已发布、已绑定 `executionStatus: ready` 内核的完整 StrategyVersion；内核草稿本身不等于完整策略。
