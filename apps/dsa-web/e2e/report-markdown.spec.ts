import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const smokePassword = process.env.DSA_WEB_SMOKE_PASSWORD;
const isolatedRunId = process.env.DSA_STRATEGY_E2E === '1' ? process.env.DSA_STRATEGY_E2E_RUN_ID : undefined;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureRunId = 'e2e-markdown-report';

test.skip(!smokePassword || !isolatedRunId, 'Report acceptance requires the isolated DSA_STRATEGY_E2E database and a smoke password.');
test.use({ locale: 'zh-CN' });

test.beforeAll(() => {
  // Seed a completed fixture directly into the isolated ledger. No task is
  // enqueued, no provider is called, and no model or notification is invoked.
  const fixtureRoot = path.join(repoRoot, '.artifacts', 'strategy-definition-e2e', isolatedRunId!);
  const database = path.join(fixtureRoot, 'strategy-definition-e2e.sqlite');
  const unixPython = path.join(repoRoot, '.venv', 'bin', 'python');
  const windowsPython = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
  const python = fs.existsSync(unixPython) ? unixPython : fs.existsSync(windowsPython) ? windowsPython : 'python';
  execFileSync(python, ['-c', `
import json
from datetime import datetime
from src.storage import DatabaseManager, WorkspaceTaskRecord, WorkspaceRunRecord, WorkspaceArtifactRecord

db = DatabaseManager()
now = datetime(2026, 10, 1, 12, 0)
chart = {'version': 1, 'type': 'line', 'title': '验收图表', 'source': '本地测试样本', 'basis': 'observed', 'series': [{'key': 'v0', 'name': '样本'}], 'data': [{'label': 'A', 'v0': -2}, {'label': 'B', 'v0': 0}, {'label': 'C', 'v0': 4}]}
markdown = '## 已保存的研究依据\\n\\n**保留原文与风险。**\\n\\n| 证据 | 状态 |\\n| --- | --- |\\n| 本地样本 | 待核实 |\\n\\n[来源链接](https://example.com/evidence)\\n\\n<script>window.e2eUnsafeScript = true</script>\\n\\n[不安全链接](javascript:alert(1))'
report = {'meta': {'stockCode': '600519', 'stockName': '验收报告样本', 'reportLanguage': 'zh', 'currentPrice': 100, 'createdAt': now.isoformat()}, 'summary': {'analysisSummary': markdown, 'operationAdvice': '观察', 'trendPrediction': '条件未确认', 'sentimentScore': 50}, 'strategy': {}, 'details': {'technicalAnalysis': '\\x60\\x60\\x60analysis-chart\\n' + json.dumps(chart, ensure_ascii=False) + '\\n\\x60\\x60\\x60\\n\\n\\x60\\x60\\x60analysis-chart\\n{"version":1\\n\\x60\\x60\\x60'}}
task = {'id': 'e2e-markdown-task', 'kind': 'research', 'name': '已保存的验收研究', 'market': 'CN', 'objective': '只读报告验收', 'subject': {'stock': '600519'}, 'config': {'reportLanguage': 'zh'}, 'capabilities': {}, 'version': 1, 'enabled': False, 'createdAt': now.isoformat(), 'updatedAt': now.isoformat()}
with db.get_session() as session:
    session.merge(WorkspaceTaskRecord(id=task['id'], task_kind='research', name=task['name'], market='CN', objective=task['objective'], subject_json=json.dumps(task['subject']), config_json=json.dumps(task['config']), capability_bindings_json='{}', enabled=False))
    session.flush()
    session.merge(WorkspaceRunRecord(id='${fixtureRunId}', task_id=task['id'], task_kind='research', status='completed', trigger_type='manual', task_snapshot_json=json.dumps(task), result_summary_json='{}', created_at=now, started_at=now, completed_at=now))
    session.flush()
    session.merge(WorkspaceArtifactRecord(id='e2e-markdown-artifact', run_id='${fixtureRunId}', artifact_type='ResearchReport', title='已保存的验收报告', content_json=json.dumps({'status': 'success', 'result': {'report': report}}, ensure_ascii=False)))
    session.commit()
`], { cwd: repoRoot, env: { ...process.env, ENV_FILE: path.join(fixtureRoot, 'e2e.env'), DATABASE_PATH: database }, stdio: 'pipe' });
});

async function openSavedReport(page: Page) {
  page.on('pageerror', (error) => console.error('Report browser error:', error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error('Report console error:', message.text()); });
  await page.addInitScript(() => localStorage.setItem('dsa.uiLanguage', 'zh'));
  await page.goto(`/login?redirect=${encodeURIComponent(`/stock-research?run=${fixtureRunId}`)}`);
  await page.getByLabel('密码', { exact: true }).fill(smokePassword!);
  const confirm = page.getByLabel('确认密码', { exact: true });
  if (await confirm.isVisible()) await confirm.fill(smokePassword!);
  await page.getByRole('button', { name: /^(登录|创建账户并进入)$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/stock-research\\?run=${fixtureRunId}$`));
  await expect(page.getByRole('article', { name: '投研备忘录' })).toBeVisible({ timeout: 15_000 });
}

test.describe('stored research report Markdown and charts', () => {
  test('renders stored Markdown and validated charts without executing report HTML', async ({ page }, testInfo) => {
    await openSavedReport(page);
    await expect(page.getByRole('heading', { name: '已保存的研究依据' })).toBeVisible();
    await expect(page.getByRole('table').filter({ hasText: '本地样本' })).toBeVisible();
    await expect(page.getByRole('link', { name: '来源链接' })).toHaveAttribute('href', 'https://example.com/evidence');
    await expect(page.getByRole('link', { name: '不安全链接' })).not.toHaveAttribute('href', /^javascript:/);
    expect(await page.evaluate(() => 'e2eUnsafeScript' in window)).toBe(false);
    await expect(page.getByRole('heading', { name: '验收图表', exact: true })).toBeVisible();
    await expect(page.getByText(/图表数据尚未完整或格式无效/)).toBeVisible();
    await page.getByText(/图表数据尚未完整或格式无效/).click();
    await expect(page.locator('pre').filter({ hasText: '{"version":1' })).toBeVisible();
    const screenshot = testInfo.outputPath('stored-report-desktop.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach('stored-report-desktop', { path: screenshot, contentType: 'image/png' });
  });

  test('reads the same stored report on narrow screens without horizontal overflow', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSavedReport(page);
    await expect(page.getByRole('heading', { name: '验收报告样本' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '报告阅读目录' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const screenshot = testInfo.outputPath('stored-report-mobile.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach('stored-report-mobile', { path: screenshot, contentType: 'image/png' });
  });

  test('opens task provenance and links to the real run detail route', async ({ page }) => {
    await openSavedReport(page);
    await page.getByText(/研究任务与溯源/).click();
    await page.getByRole('link', { name: '运行详情与数据来源' }).click();
    await expect(page).toHaveURL(new RegExp(`/runs/${fixtureRunId}$`));
    await expect(page.getByRole('heading', { name: '已保存的验收研究' })).toBeVisible();
  });
});
