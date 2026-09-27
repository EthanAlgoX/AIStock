# Public homepage / 公开首页

`/` is the public AI Stock website. It loads independently of authentication status, including when the status request fails. `/overview` remains the research workspace; private module APIs and routes retain their existing authentication requirements.

`/` 是无需登录的官方网站首页，即使认证状态暂时不可用也能浏览。`/overview` 仍为投研工作区，内部模块与 API 的认证保护不变。

## Product tour / 产品导览

The five keyboard-accessible tabs introduce market radar, stock research, screening, trade simulation and review. All visible tour material is scripted illustration, clearly labelled; no private account APIs, live returns or model calls are used. Historical backtests and paper simulation have separate illustrations. The public tour does not promise live brokerage execution or investment returns.

五个支持键盘操作的标签介绍市场雷达、个股研究、策略选股、交易推演与复盘优化。全部预设示意均明确标注，不读取私人账户，不展示真实收益，不调用模型。历史回测与持续模拟分开呈现，不承诺实盘执行或投资回报。

## Entry points / 使用入口

- `/try`: existing public demonstration; the homepage links to it without requiring registration.
- `/login?redirect=%2Foverview`: sign in and enter the workspace. Login without a valid redirect defaults to `/overview`.
- `/login?mode=register&redirect=%2Foverview`: opens member registration only when registration is enabled and the instance has a ready account. Setup and migration keep their existing flows.
- Invitation requests use `mailto:` and the user's configured mail application. The open-source link provides self-hosting documentation.

- `/try`：现有免注册体验入口。
- `/login?redirect=%2Foverview`：登录后进入工作区；未指定有效目标时也默认进入 `/overview`。
- `/login?mode=register&redirect=%2Foverview`：仅在允许注册且实例账户已初始化时直接进入普通用户注册；保留初始化与迁移流程。
- 邀请码申请使用 `mailto:` 打开用户配置的邮件应用。开源链接提供自行部署说明。

Home and demo logos return to `/`; the login logo also links home. The page uses the existing language preference for Simplified Chinese, Traditional Chinese, English, Korean and Japanese. New copy is maintained in `apps/dsa-web/src/i18n/homeCopy.ts`, without Chinese fallback for non-Chinese locales.

首页、体验页和登录页的品牌链接均返回 `/`。沿用现有语言偏好，支持简体中文、繁体中文、英文、韩文及日文。新文案集中在 `apps/dsa-web/src/i18n/homeCopy.ts`，非中文语言不回退到中文。

## Deployment and rollback / 部署与回滚

This change is frontend-only. Deploy the built static bundle on the current backend image; preserve mounted data and the private simulation runtime. Keep the previous production image and compose override to roll back. Design previews and acceptance screenshots stay outside version control.

本次仅更新前端。静态产物在现有后端镜像上发布，保留挂载数据与私有模拟运行服务。保留旧生产镜像与 compose 覆盖配置以便回滚。设计预览及验收截图不提交版本控制。
