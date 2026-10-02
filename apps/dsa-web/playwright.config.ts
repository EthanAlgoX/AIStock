import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');
const shouldRunWebSmoke = !!process.env.DSA_WEB_SMOKE_PASSWORD;
const shouldRunStrategyE2E = process.env.DSA_STRATEGY_E2E === '1';
const strategyE2ERunId = process.env.DSA_STRATEGY_E2E_RUN_ID || crypto.randomUUID();
// Playwright evaluates this config again in worker processes. Persist the
// generated id so every worker derives the same isolated ports and database.
process.env.DSA_STRATEGY_E2E_RUN_ID ||= strategyE2ERunId;
const strategyE2ERoot = path.join(repoRoot, '.artifacts', 'strategy-definition-e2e', strategyE2ERunId);
const strategyE2EDatabase = path.join(strategyE2ERoot, 'strategy-definition-e2e.sqlite');
const strategyE2EEnv = path.join(strategyE2ERoot, 'e2e.env');
const backendLog = path.join(strategyE2ERoot, 'backend.log');
const frontendLog = path.join(strategyE2ERoot, 'frontend.log');
// A run-specific pair avoids a just-terminated uvicorn being mistaken for an
// existing development service by the application's conservative port probe.
const e2ePortOffset = parseInt(crypto.createHash('sha256').update(strategyE2ERunId).digest('hex').slice(0, 4), 16) % 1_000;
const backendPort = shouldRunStrategyE2E ? 18_000 + e2ePortOffset : 8000;
const frontendPort = shouldRunStrategyE2E ? 14_000 + e2ePortOffset : 4173;

if (shouldRunStrategyE2E) {
  fs.mkdirSync(strategyE2ERoot, { recursive: true });
  // The password is generated per runner and deliberately never committed.  The
  // application still uses its production login endpoint and signed cookie.
  process.env.DSA_STRATEGY_E2E_PASSWORD ||= crypto.randomBytes(24).toString('base64url');
  // Vite serves source in this acceptance run; backend startup must not reinstall
  // or rebuild the same node_modules while frontend checks are running.
  fs.writeFileSync(strategyE2EEnv, `ADMIN_ACCESS_MODE=legacy\nADMIN_AUTH_ENABLED=true\nWEBUI_AUTO_BUILD=false\nDATABASE_PATH=${strategyE2EDatabase}\n`, { mode: 0o600 });
}

function resolveBackendCommand() {
  if (process.env.DSA_WEB_SMOKE_BACKEND_CMD) {
    return process.env.DSA_WEB_SMOKE_BACKEND_CMD;
  }

  const unixVenvPython = path.join(repoRoot, '.venv', 'bin', 'python');
  if (fs.existsSync(unixVenvPython)) {
    return `${unixVenvPython} main.py --webui-only --host 127.0.0.1 --port ${backendPort}`;
  }

  const windowsVenvPython = path.join(repoRoot, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(windowsVenvPython)) {
    return `"${windowsVenvPython}" main.py --webui-only --host 127.0.0.1 --port ${backendPort}`;
  }

  return `python main.py --webui-only --host 127.0.0.1 --port ${backendPort}`;
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Strategy acceptance uses one isolated SQLite database. Serial workers keep
  // bootstrap and revision-conflict scenarios deterministic across spec files.
  workers: shouldRunStrategyE2E ? 1 : undefined,
  // Formal strategy-definition acceptance never hides instability behind retry.
  retries: shouldRunStrategyE2E ? 0 : (process.env.CI ? 2 : 0),
  reporter: 'list',
  use: {
    ...(process.env.DSA_PLAYWRIGHT_CHANNEL ? { channel: process.env.DSA_PLAYWRIGHT_CHANNEL } : {}),
    baseURL: `http://127.0.0.1:${frontendPort}`,
    locale: 'zh-CN',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: shouldRunWebSmoke || shouldRunStrategyE2E
    ? [
        {
          command: shouldRunStrategyE2E ? `${resolveBackendCommand()} > "${backendLog}" 2>&1` : resolveBackendCommand(),
          cwd: repoRoot,
          env: shouldRunStrategyE2E ? {
            ...process.env,
            ENV_FILE: strategyE2EEnv,
            DATABASE_PATH: strategyE2EDatabase,
          } : process.env,
          url: `http://127.0.0.1:${backendPort}/api/v1/auth/status`,
          reuseExistingServer: !process.env.CI && !shouldRunStrategyE2E,
          timeout: 120_000,
        },
        {
          command: shouldRunStrategyE2E ? `npm run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort > "${frontendLog}" 2>&1` : `npm run dev -- --host 127.0.0.1 --port ${frontendPort}`,
          cwd: currentDir,
          env: shouldRunStrategyE2E ? {
            ...process.env,
            DSA_WEB_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}`,
          } : process.env,
          url: `http://127.0.0.1:${frontendPort}`,
          reuseExistingServer: !process.env.CI && !shouldRunStrategyE2E,
          timeout: 120_000,
        },
      ]
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
