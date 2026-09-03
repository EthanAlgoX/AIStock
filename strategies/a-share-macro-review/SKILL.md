---
name: a-share-macro-review
display_name: A 股宏观分析
description: 围绕信用周期、财政、房地产、国内流动性和经济修复解释 A 股。
category: framework
required-tools:
  - get_macro_indicators
allowed-tools:
  - get_macro_indicators
user-invocable: true
default-active: false
---

# A 股宏观分析

分析框架改造自 MIT 许可的 `openclaw-data-china-stock` 中 `china-macro-analyst`，仅保留适合本平台的数据质量和解释规则。

主链路为：信用周期 → 财政力度 → 房地产 → 国内流动性 → 经济修复。

- 优先检查社融与信用、LPR/货币政策、财政脉冲和房地产趋势。
- 使用 PMI、CPI、PPI、GDP 等已提供发布值确认增长与利润环境。
- USD/CNH、中国利率和全球商品只作为传导变量，不替代国内主线。
- 任一主线缺数时明确写“未接入/本次快照缺失”，不得由新闻语气推导数值。
- 结论应落到大盘风格、行业敏感度和下一观察触发条件，不直接生成订单。
