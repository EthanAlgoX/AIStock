# 提交与本地文件边界 / Versioned and local-only files

`AGENTS.md`、`CLAUDE.md`、`.claude/`、`.codex/`、`.agents/`、`.impeccable/`、`.github/copilot-instructions.md` 和 `.github/instructions/` 仅用于本地开发，不纳入 Git，也不作为 CI 的必备输入。现有工作区保留这些文件；新克隆不包含它们，开发者可按需自行配置。

These AI development instructions and tool directories are local-only. They are neither versioned nor required by CI. Existing local copies remain available; fresh clones can work without them.

产品功能使用的根目录 `SKILL.md`、`strategies/`、`PRODUCT.md`、`DESIGN.md` 和配置模板 `.env.example` 继续纳入版本控制。CI 和 PR 审查脚本也保留，公开审查标准由 PR 模板和审查脚本提供。

Product Skills, strategy packages, product/design documentation, `.env.example`, CI workflows and PR review scripts remain versioned. Public review criteria are maintained in the PR template and review script.

真实环境变量、运行数据、数据库及旁路文件、日志、私钥、证书容器、备份和 `longbridge_tokens/` 不应提交，也应排除在 Docker 构建上下文之外。不要用 `git add -f` 提交这些内容。忽略规则按文件名防止误提交，不替代内容级密钥扫描。

Real environment settings, runtime data, database sidecars, logs, private keys, credential bundles, backups and broker token directories must stay out of Git and Docker build contexts. Filename exclusions prevent accidental inclusion; they do not replace secret-content scanning.

验证 / Verify:

```bash
python scripts/check_ai_assets.py
git ls-files -ci --exclude-standard
git diff --cached --name-status
```

CI 保留 `ai-governance` 检查名称以兼容既有分支保护；现在检查本地专用文件未被跟踪、关键忽略规则有效、产品资产没有被误忽略。无需本地 AI 配置文件即可通过。

The `ai-governance` check name remains compatible with existing branch protection. It now checks exclusion of local AI files, key ignore rules and publishability of product assets, without requiring local AI configuration.

注意：`git rm --cached` 仅取消当前工作区的跟踪，不删除本地文件；但提交后其他已有克隆拉取此变更时，Git 可能删除那些原本受跟踪的文件，需要的开发者应先备份自己的副本。历史提交中的旧文件也不会自动清除。本次不重写 Git 历史。

`git rm --cached` preserves files in the current working directory. Other existing clones may remove formerly tracked files when pulling the eventual commit; developers should back up any local copies they want to keep. Old commits still contain these files. This change does not rewrite history.

回滚应恢复对应的 Git 跟踪、忽略规则和检查脚本，三者一起回退；不涉及应用数据库或线上服务。

Rollback must restore tracking, ignore rules and the checker together. No application database or deployed service changes are involved.
