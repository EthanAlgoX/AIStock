import { expect, test, type Page } from '@playwright/test';

const smokePassword = process.env.DSA_WEB_SMOKE_PASSWORD;

if (!smokePassword) {
  test.skip(true, 'Set DSA_WEB_SMOKE_PASSWORD to run authenticated smoke tests.');
}


async function captureSmokeScreenshot(page: Page, testInfo: { outputPath: (name: string) => string }, name: string, options: { fullPage?: boolean } = {}) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({
    path,
    fullPage: options.fullPage ?? true,
  });
  await testInfo.attach(name, {
    path,
    contentType: 'image/png',
  });
}

async function login(page: Page) {
  test.skip(!smokePassword, 'Set DSA_WEB_SMOKE_PASSWORD to run authenticated smoke tests.');

  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  const passwordInput = page.locator('#password');
  const submitButton = page.getByRole('button', { name: /授权进入工作台|完成设置并登录/ });
  const homeLink = page.getByRole('link', { name: '主 Agent' });

  const isAlreadyAuthenticated =
    page.url().endsWith('/overview') ||
    await homeLink.isVisible({ timeout: 2_000 }).catch(() => false);

  if (isAlreadyAuthenticated) {
    await page.waitForLoadState('domcontentloaded');
    return;
  }

  await expect(passwordInput).toBeVisible({ timeout: 10_000 });
  await passwordInput.fill(smokePassword!);
  const passwordConfirmInput = page.locator('#passwordConfirm');
  if (await passwordConfirmInput.isVisible().catch(() => false)) {
    await passwordConfirmInput.fill(smokePassword!);
  }
  await expect(submitButton).toBeVisible();

  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/v1/auth/login') && response.status() === 200,
      { timeout: 15_000 }
    ),
    submitButton.click(),
  ]);

  await page.waitForURL(/\/overview$/, { timeout: 15_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
}

async function openWorkspaceDrawer(page: Page, language: 'zh' | 'en' = 'zh') {
  const triggerName = language === 'zh'
    ? '打开工作区与设置'
    : 'Open workspace and settings';
  const drawerName = language === 'zh'
    ? '工作区与设置'
    : 'Workspace and settings';

  await page.getByRole('button', { name: triggerName }).click();
  const drawer = page.getByRole('dialog', { name: drawerName });
  await expect(drawer).toBeVisible();
  return drawer;
}

test.describe('web smoke', () => {
  test.use({ locale: 'zh-CN' });

  test('login page renders password form', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    // Check for branding
    await expect(page.getByText('DAILY STOCK').first()).toBeVisible();
    await expect(page.getByText('Analysis Engine')).toBeVisible();

    // Check for password input
    await expect(page.locator('#password')).toBeVisible();

    // Check for submit button
    await expect(page.getByRole('button', { name: /授权进入工作台|完成设置并登录/ })).toBeVisible();

    await captureSmokeScreenshot(page, testInfo, 'smoke-login-page-zh');
  });

  test('primary Agent is the authenticated home workspace', async ({ page }, testInfo) => {
    await login(page);

    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByTestId('chat-workspace')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: '主 Agent' })).toBeVisible();
    await expect(page.getByRole('link', { name: '市场情报' })).toBeVisible();
    await expect(page.getByRole('link', { name: '个股分析' })).toBeVisible();
    await expect(page.getByRole('link', { name: '能力总览' })).toBeVisible();

    await captureSmokeScreenshot(page, testInfo, 'smoke-primary-agent-page-zh', { fullPage: true });
  });

  test('chat page exposes an executable composer or an explicit unavailable state', async ({ page }) => {
    await login(page);

    await expect(page.getByTestId('chat-workspace')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('chat-message-scroll')).toBeVisible();

    const input = page.getByPlaceholder('输入目标，例如：分析 600519');
    await expect(input).toBeVisible({ timeout: 5000 });

    if (await input.isDisabled()) {
      await expect(page.getByText('当前问股方式不可用')).toBeVisible();
      await expect(page.getByRole('button', { name: '发送' })).toBeDisabled();
      return;
    }

    await expect(page.getByRole('button', { name: /打开本次会话能力|调整/ })).toBeVisible();

    const prompt = '请简要分析 600519';
    await input.fill(prompt);
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.locator('p').filter({ hasText: prompt }).last()).toBeVisible({ timeout: 5000 });
  });

  test('chat page uses accessible labels instead of native title attributes for key actions', async ({ page }) => {
    await login(page);

    const sendButton = page.getByRole('button', { name: '发送' });
    const composer = page.getByPlaceholder('输入目标，例如：分析 600519');

    await expect(page.getByTestId('chat-workspace')).toBeVisible({ timeout: 10_000 });
    await expect(sendButton).toBeVisible({ timeout: 10_000 });
    await expect(composer).toBeVisible({ timeout: 10_000 });

    await expect(sendButton).not.toHaveAttribute('title', /.+/);
    await expect(composer).not.toHaveAttribute('title', /.+/);
  });

  test('mobile shell opens navigation drawer after login', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);

    const drawer = await openWorkspaceDrawer(page);
    await expect(drawer.getByRole('link', { name: '能力总览' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: '任务与运行' })).toBeVisible();

    await captureSmokeScreenshot(page, testInfo, 'smoke-mobile-shell-nav');
  });

  test('settings page renders title and save actions after login', async ({ page }, testInfo) => {
    await login(page);

    const drawer = await openWorkspaceDrawer(page);
    await drawer.getByRole('link', { name: '平台设置' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    await expect(page.getByRole('heading', { name: '平台设置' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /模型与运行时/ })).toBeVisible();
    await page.getByRole('button', { name: /安全与部署/ }).click();
    await expect(page.getByRole('button', { name: '撤销修改' })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible();

    await captureSmokeScreenshot(page, testInfo, 'smoke-settings-page-zh');
  });

  test('language switch updates UI copy and persists after page refresh', async ({ page }, testInfo) => {
    await login(page);

    const drawer = await openWorkspaceDrawer(page);
    const languageToggle = drawer.getByRole('button', { name: '切换界面语言' });
    await expect(languageToggle).toBeVisible();
    await expect(drawer.getByRole('link', { name: '平台设置' })).toBeVisible();
    await expect(page.getByRole('link', { name: '主 Agent' })).toBeVisible();

    await languageToggle.click();

    const englishLanguageToggle = page.getByRole('button', { name: 'Switch UI language' });
    await expect(englishLanguageToggle).toBeVisible();
    await expect(page.getByRole('link', { name: 'Platform settings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Primary Agent' })).toBeVisible();
    await captureSmokeScreenshot(page, testInfo, 'smoke-home-page-en');

    expect(await page.evaluate(() => localStorage.getItem('dsa.uiLanguage'))).toBe('en');

    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('link', { name: 'Primary Agent' })).toBeVisible();

    const englishDrawer = await openWorkspaceDrawer(page, 'en');
    await expect(englishDrawer.getByRole('button', { name: 'Switch UI language' })).toBeVisible();
    await englishDrawer.getByRole('link', { name: 'Platform settings' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    await expect(page.getByRole('heading', { name: 'Platform settings' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Models & runtime/ })).toBeVisible();
    await page.getByRole('button', { name: /Security & deployment/ }).click();
    await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();

    await captureSmokeScreenshot(page, testInfo, 'smoke-settings-page-en');
  });

  test('capability overview separates tools, MCP, data, and experts', async ({ page }, testInfo) => {
    await login(page);

    await page.getByRole('link', { name: '能力总览' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    await expect(page.getByRole('heading', { name: '能力中心' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('工作区可用')).toBeVisible();
    await expect(page.getByText('本次任务使用')).toBeVisible();
    await expect(page.getByRole('link', { name: /内置工具/ }).last()).toBeVisible();
    await expect(page.getByRole('link', { name: /MCP 服务/ }).last()).toBeVisible();

    await captureSmokeScreenshot(page, testInfo, 'smoke-capability-overview-zh', { fullPage: true });
  });
});
