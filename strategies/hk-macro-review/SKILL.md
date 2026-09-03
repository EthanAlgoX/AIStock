---
name: hk-macro-review
display_name: 港股双周期宏观分析
description: 同时评估中国增长周期和美元金融周期对港股估值与盈利的影响。
category: framework
required-tools:
  - get_macro_indicators
allowed-tools:
  - get_macro_indicators
user-invocable: true
default-active: false
---

# 港股双周期宏观分析

核心关系：港股环境 = 中国增长预期 × 美国利率环境 × 人民币汇率。

- 美国 10Y 与实际利率解释估值压力，尤其关注互联网和高久期成长资产。
- 中国 PMI、通胀、信用和房地产解释盈利预期；不可把 A 股行情强弱当作基本面数据。
- DXY 与 USD/CNH 共同判断国际资金条件，USD/JPY 用于识别套息去杠杆风险。
- VIX、信用利差与指数走势出现背离时，明确列为未解决风险。
- 分别给出中国侧、美元侧和汇率侧结论，再汇总为风险偏好与失效条件。
