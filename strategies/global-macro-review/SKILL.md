---
name: global-macro-review
display_name: 全球宏观共同变量
description: 用统一的资金价格、流动性、风险偏好与增长框架解释跨市场环境。
category: framework
required-tools:
  - get_macro_indicators
allowed-tools:
  - get_macro_indicators
user-invocable: true
default-active: false
---

# 全球宏观共同变量

此 Skill 的序列读取方法改造自 MIT 许可的 `gauss314/skills` 中 `fred-macro`，执行层已替换为平台只读 Tool。

按以下顺序分析，不得用常识补写快照中缺失的数值：

1. 资金价格：美国 2Y、10Y 与 10Y 实际利率，区分政策预期、期限溢价和成长股折现压力。
2. 全球流动性：DXY、USD/CNH、USD/JPY，观察美元金融条件与套息交易风险。
3. 风险偏好：VIX 与高收益债利差，优先识别变化速度和跨资产背离。
4. 全球周期：原油、铜、PMI、通胀和就业，区分增长、通胀及供给冲击。

输出必须区分事实观测、机制推断和策略含义。低频数据使用“较前值”，不得描述成“日涨跌”。
