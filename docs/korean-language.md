# 韩文界面与输出

网站语言选择器提供中文、English、한국어。选择保存到浏览器的 `dsa.uiLanguage`；没有有效保存值时按浏览器首个受支持的语言选择，识别 `ko-KR`。切换不重挂载页面，不清空未保存表单；HTML `lang` 随之更新，韩文日期使用 `ko-KR`。

## 范围

共享 UI 词条、工作区词条、已有分语言组件文案、设置帮助和配置标签均加入韩文。旧页面中直接写在 JSX 中的产品文案通过 `UiLiteral` / `useUiLiteral` 接入；传给后端的枚举、市场及行业值不翻译。韩文界面不意味着新增韩国证券市场，数据市场仍为 A 股、港股和美股。

韩文界面的投研助理请求显式传递 `context.report_language=ko`。中英文请求保持原有报告语言继承规则。共享聊天 Prompt 和体验请求也接受韩文。其他分析和预约报告继续使用已有 `REPORT_LANGUAGE=ko` 配置，不添加独立开关。

历史报告、用户命名、输入内容、股票代码和名称、新闻原文不会自动翻译。外部工具或模型返回的原始错误可能保留原语言。

## 维护

- 韩文静态词条保存在 `apps/dsa-web/src/i18n/ko.json`，键是源代码中的中文产品文案。
- `withKorean` 从明确的 `zh` / `en` 静态语言表扩展 `ko`；只翻译值，不改对象键或 API 枚举。
- `translateKorean` 优先精确匹配；注册模板保留 `{count}`、`{0}` 等占位符及动态插入值。不要将该函数用于用户输入、报告正文或任意 DOM 文本。
- 新增或修改产品文案时同步补齐韩文词条。词条测试检查共享目录覆盖和占位符一致性。
- 翻译为构建期静态资源，浏览网站或切换语言不会请求翻译服务。

README 的英文、简体和繁体版本提供韩文入口，`README_KO.md` 提供韩文功能说明和快速开始。

## 验证与回滚

验证覆盖语言检测与保存、三语言切换、未保存输入及历史文本保留、占位符、设置帮助、枚举值和韩文 Prompt。页面截图仅作为本地验收产物，不纳入仓库。

回滚代码即可恢复原来的语言入口，无数据库迁移。保存的 `ko` 偏好在旧版中会按原有非法值回退逻辑处理；已有韩文报告仍按原报告契约读取。

## English summary

The web UI adds Korean alongside Chinese and English, with browser-language detection, persistent selection and Korean date formatting. Static product copy is translated; user content, reports, news, stock names and API values are preserved. Korean assistant requests explicitly request Korean output, while Chinese and English retain their existing report-language inheritance. Other workflows continue to use `REPORT_LANGUAGE=ko`. Korean UI support does not add Korean stock-market data. Rollback requires no schema change.
