import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const TEST_DIR = join(__dirname, 'tests/browser');

// Every spec takes `test` and `expect` from tests/browser/console-clean.ts,
// which fails a test on a console.error or an unhandled rejection. Playwright
// cannot inject a fixture from the config, so the config refuses to start
// while a spec imports a value from '@playwright/test' (types may come from
// either module).

/** True when an import clause binds a value, not only types. */
function bindsValue(clause: string): boolean {
  const text = clause.trim();
  if (/^type\s/.test(text)) return false;
  const named = text.match(/\{([^}]*)\}/)?.[1] ?? '';
  // A default or namespace import (`pw`, `* as pw`) outside the braces.
  if (text.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim()) return true;
  return named.split(',').map((name) => name.trim()).some((name) => name && !/^type\s/.test(name));
}

const PLAYWRIGHT_IMPORT = /\bimport\s+([^'";]+?)\s+from\s+['"]@playwright\/test['"]/g;
const outsideConsoleClean = readdirSync(TEST_DIR)
  .filter((file) => file.endsWith('.spec.ts'))
  .filter((file) => [...readFileSync(join(TEST_DIR, file), 'utf8').matchAll(PLAYWRIGHT_IMPORT)].some(([, clause]) => bindsValue(clause)));
if (outsideConsoleClean.length > 0) {
  throw new Error(`Import test and expect from './console-clean', not '@playwright/test', in tests/browser/${outsideConsoleClean.join(', tests/browser/')}`);
}

export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1,
  use: { baseURL: process.env.TEST_BASE_URL || 'http://localhost:4173',
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', launchOptions: { executablePath: process.env.CHROME_BIN } },
    },
    {
      name: 'webkit',
      testMatch: /(?:first-load|navigation|coding-workbench|mobile-safari|consent-reflow)\.spec\.ts$/,
      use: { ...devices['iPhone 13'], browserName: 'webkit' },
    },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});
