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

  test('chat page allows entering a question and starts a request', async ({ page }) => {
    await login(page);

    await expect(page.getByTestId('chat-workspace')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('chat-message-scroll')).toBeVisible();

    const input = page.getByPlaceholder('输入目标，例如：分析 600519');
    await expect(input).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: '打开本次会话能力' })).toBeVisible();

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

    // Try to open navigation menu
    const menuButton = page.getByRole('button', { name: /打开导航|菜单/i });
    if (await menuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await menuButton.click();
    }

    // Check if navigation is visible
    await expect(page.getByRole('link', { name: '能力总览' })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('link', { name: '任务与运行' })).toBeVisible();

    await captureSmokeScreenshot(page, testInfo, 'smoke-mobile-shell-nav');
  });

  test('settings page renders title and save actions after login', async ({ page }, testInfo) => {
    await login(page);

    // Navigate to settings page by clicking the link
    await page.getByRole('link', { name: '平台设置' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Use heading role for more precise selection
    await expect(page.getByRole('heading', { name: '平台设置' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: '重置' })).toBeVisible();
    await expect(page.getByRole('button', { name: /保存配置/ })).toBeVisible();

    await captureSmokeScreenshot(page, testInfo, 'smoke-settings-page-zh');
  });

  test('language switch updates UI copy and persists after page refresh', async ({ page }, testInfo) => {
    await login(page);

    const languageToggle = page.getByRole('button', { name: '切换界面语言' });
    await expect(languageToggle).toBeVisible();
    await expect(page.getByRole('link', { name: '平台设置' })).toBeVisible();
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

    await expect(englishLanguageToggle).toBeVisible();
    await expect(page.getByRole('link', { name: 'Platform settings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Primary Agent' })).toBeVisible();

    await page.getByRole('link', { name: 'Platform settings' }).click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    await expect(page.getByRole('heading', { name: 'System settings' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Send test' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('DSA notification test');

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
