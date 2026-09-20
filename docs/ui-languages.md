# 网站语言 / UI languages

README 默认入口 `README.md` 使用英文，并链接简体中文、繁体中文、日文、韩文版本。

| 语言 | 界面与报告标识 | README |
| --- | --- | --- |
| English | `en` | `../README.md` |
| 简体中文 | `zh` | `README_ZH.md` |
| 繁體中文 | `zh-TW` | `README_CHT.md` |
| 日本語 | `ja` | `README_JA.md` |
| 한국어 | `ko` | `README_KO.md` |

## 默认与持久化

网站首次访问、存储不可用或保存值不受支持时使用英文。浏览器语言不会覆盖英文默认值。用户在顶部选择语言后，偏好保存到 `dsa.uiLanguage`；已有的中文、英文和韩文偏好继续有效。HTML `lang`、日期、数值格式跟随选择。

切换不重挂载页面，不清空未保存输入。静态界面文案、注册配置标签和帮助支持五种语言；用户命名、股票名称、历史报告、新闻原文和外部错误不自动翻译。界面语言不新增日本或韩国市场数据。

## 分析输出

报告 API 接受 `en`、`zh`、`zh-TW`、`ja`、`ko`。英文、日文、繁体中文和韩文投研助理请求显式传递所选语言；简体中文保留原来的报告语言继承规则。定期分析、CLI 等仍使用已有 `REPORT_LANGUAGE`，界面英文默认值不会覆盖服务器已配置的报告语言。设置中可选择全部五种报告语言。

繁体中文和日文输出指令保留 JSON 字段名、股票代码、工具名和交易枚举值。已有历史记录不重写。

## 翻译维护

`apps/dsa-web/src/i18n/localize.ts` 为明确注册的产品文案提供翻译。现有中英文语言表通过 `withUiLanguages` 补充日文、繁体中文和韩文；已有的人工编写版本优先。旧页面的静态 JSX 通过 `UiLiteral` 或 `useUiLiteral` 接入。

静态目录为 `en.json`、`zh-TW.json`、`ja.json`、`ko.json`。新增或更改源文案时同步词条，并保留占位符、URL、环境变量及接口枚举。不得对用户输入、报告正文或任意 DOM 应用翻译。浏览或切换语言不调用翻译服务。

任务列表、能力目录和系统提示在渲染时翻译，保证切换语言后立即更新。聊天导出的标题、角色标签和时间使用导出时选择的语言，正文保持原文。词条匹配兼容旧文案两端的排版空格。

四份翻译词典必须覆盖所有词典键的并集，不能只以某一语言作为覆盖检查的基准。

语言测试覆盖英文默认、五种切换与保存、词条覆盖、占位符、报告接口及输出指令。页面验收截图放在本地忽略目录，不提交仓库。现有组件测试显式采用简体中文偏好；默认语言测试删除该偏好后验证英文。

回滚本次代码无需数据库迁移。旧版不识别的新语言偏好会走旧版默认逻辑；若已配置新的报告语言，回滚时将报告语言切换为旧版支持值。

## English summary

The default README and first-visit UI are English. Five languages are available: English, Simplified Chinese, Traditional Chinese, Japanese and Korean. Explicit preferences persist; browser language does not change the default. Static UI copy is localized while user content and historical reports retain their original text. Report APIs accept all five language codes; existing server report-language settings remain separate from the UI default. No runtime translation service or database migration is required.

Catalogue tests compare the union of all locale keys and check placeholders. Task filters, capability descriptions and system messages translate at render time. Export headings and timestamps follow the selected language while message bodies remain unchanged. Legacy whitespace around registered labels is supported.
