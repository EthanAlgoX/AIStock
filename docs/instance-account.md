# 实例账户 / Instance account

## 中文

### 本地与服务器

默认 `ADMIN_ACCESS_MODE=local` 为本地单人模式，**无需邮箱注册或登录**，直接进入网站。仅接受直接回环访问，启动时绑定 `127.0.0.1`。不用于局域网、公网或反向代理。已有账户文件仍保留，切回服务器模式后继续使用，不删除原数据。

服务器设置 `ADMIN_ACCESS_MODE=server` 并重启，强制 HTTPS 与邮箱账户；旧 `ADMIN_AUTH_ENABLED=false` 不能关闭保护。`MULTI_USER_ENABLED=true` 开启受邀成员私有工作区，详细隔离、额度和部署说明见 [多用户工作区](multi-user-isolation.md)。邮箱是登录标识，当前不自动发验证邮件；管理员通过邀请码控制注册。

### 初始化管理员

1. 备份实际服务的数据目录与配置。账户位于 `DATABASE_PATH` 同目录的 `.admin_password_hash`，保存邮箱和密码哈希，不保存明文密码；目录需要持久化且仅部署者可访问。
2. 在部署主机、同一虚拟环境、相同 `ENV_FILE` / `DATABASE_PATH` 下运行 `python -m src.auth setup_token`。初始化凭证 30 分钟有效，重新生成使旧凭证失效；不要放入 URL、公共日志或 Git。
3. 服务器网页填写邮箱、8–128 位密码、确认密码及凭证。管理员只能初始化一次；后续成员注册使用独立邀请，不继承管理员数据。
4. 旧安装已有管理员密码时，使用原密码补全邮箱，不要求初始化凭证，不重新分配历史数据。原密码遗忘时使用主机恢复命令。
5. 管理员修改邮箱或密码须验证当前密码，更新使旧会话失效；当前浏览器获得新会话。成员修改密码后须重新登录，成员邮箱修改暂不开放。

服务器需配置 HTTPS 反向代理、受控域名、准确的 CORS 来源及请求限流。仅可信代理覆盖转发头且后端不可公网直连时启用 `TRUST_X_FORWARDED_FOR=true`，并限制 Uvicorn 受信代理 IP。Cookie 为 HttpOnly、SameSite=Lax，HTTPS 下为 Secure；变更请求验证 Origin / Sec-Fetch-Site。

`legacy` 仅保留旧可选密码兼容，不用于公开部署。已有邮箱账户在 legacy 下仍受保护；本地免登录仅由显式 local 模式提供。CLI 分析不要求交互登录；服务器 API 脚本须保留登录 Cookie。

### 恢复、桌面与回滚

管理员恢复：`python -m src.auth reset_password`。在部署主机交互输入新密码，保留邮箱和数据，撤销旧会话；不要删除凭据文件来重新注册。成员恢复见多用户文档。

打包后端支持 `stock_analysis --account-action setup-token` / `--account-action reset-password`（Windows 为 `.exe`）；源码也可使用 `python main.py --account-action ...`。Docker 中应在后端容器的真实持久化目录执行。桌面端默认本地免登录；只有主动改为服务器模式才需要上述账户流程。

服务器退出：右侧“工作区与设置”→“退出”，在前景确认弹窗确认。Escape 仅取消确认。本地模式不显示登录或退出入口。

状态 API 保留既有字段并增加 `accountMode/accountState/email/role/userId/multiUserEnabled/registrationMode/quota`；匿名不返回账户邮箱，状态不缓存。成员身份来自服务端会话而非请求字段。

回滚前停止公网服务并备份。旧版本不认识邮箱凭据 JSON 格式，须恢复匹配版本的账户、会话和配置备份，不能直接降级。注册本身不改写原持仓与报告归属。

## English

`ADMIN_ACCESS_MODE=local` is the default single-user mode: **no signup or login**. Bind directly to loopback (`127.0.0.1`); LAN/public/proxied access is rejected. Existing credentials and data remain available when switching back to server mode.

Set `ADMIN_ACCESS_MODE=server` and restart for a shared deployment. HTTPS and email accounts are mandatory regardless of `ADMIN_AUTH_ENABLED`. `MULTI_USER_ENABLED=true` enables invited private members; see [Private workspaces](multi-user-isolation.md) for isolation, quotas and deployment limits. Email verification is not automated; registration is invitation-controlled.

Back up the actual service data/configuration. Credentials live in `.admin_password_hash` beside `DATABASE_PATH`, storing email and password hash, never plaintext. Use private persistent storage.

Run `python -m src.auth setup_token` on the deployment host with the same environment, `ENV_FILE` and `DATABASE_PATH`. The token expires after 30 minutes and regeneration revokes the previous token. Do not put it in URLs, public logs or Git. Enter email, an 8–128 character password, confirmation and token to create the owner once. Existing password-only installations migrate using their current password plus an email, preserving data. Members register separately with invitations.

Owner password/email changes verify the current password and rotate sessions. Members must sign in again after password changes; member email changes are not enabled. Use HTTPS, controlled proxy hosts, exact CORS origins and request limits. Trust forwarding headers only from a locked-down proxy with a non-public backend and restricted trusted proxy IPs. Cookies are HttpOnly, SameSite=Lax and Secure on HTTPS; mutation requests validate origin.

Owner host recovery: `python -m src.auth reset_password`, preserving email/data and revoking sessions. Packaged equivalents are `stock_analysis --account-action setup-token` and `--account-action reset-password` (`.exe` on Windows); source equivalents use `python main.py --account-action ...`. In Docker, run inside the actual backend environment and persistent volume. Desktop defaults to local no-login mode.

Legacy mode preserves old optional-password compatibility, not public deployment; registered accounts remain protected there. CLI analysis does not require login; server API clients retain a login cookie. Server logout uses the foreground confirmation under Workspace and settings; local mode hides account entry/exit actions.

Status adds account mode/state, authenticated email/role/user ID, multi-user flag, registration mode and quota, with no-store caching. Workspace identity comes from the validated session. Before rollback, stop public access and restore matching credential/session/config backups: old versions cannot parse the newer account format. Do not delete credentials to register again.
