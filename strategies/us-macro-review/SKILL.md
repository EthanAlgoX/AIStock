---
name: us-macro-review
display_name: 美股增长—通胀—Fed 分析
description: 分开评估美股的利率估值链与增长盈利链。
category: framework
required-tools:
  - get_macro_indicators
allowed-tools:
  - get_macro_indicators
user-invocable: true
default-active: false
---

# 美股增长—通胀—Fed 分析

并行分析两条链路：通胀 → Fed → 实际利率 → 估值；增长 → 企业盈利 → 股价。

- 2Y 反映政策路径，10Y 反映长期折现率，10Y 实际利率用于判断成长估值压力。
- CPI、就业和 PMI 等低频发布只与自身前值比较，不把发布时间差异当成同步信号。
- 经济数据偏强可能通过更鹰的利率路径压制估值，必须说明正负两条传导。
- 高收益债利差和 VIX 用于复核股票风险偏好；若信号冲突，保留分歧。
- 输出基准、偏鹰和衰退三个情景的观察条件，不虚构 Fed Funds Futures 数据。
