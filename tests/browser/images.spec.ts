import { readFileSync } from 'node:fs';
import { test, expect, type Page } from './console-clean';
import { fakeUser, localAuth, storeFakeSession } from './fake-session';

const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
const PROFILES = [
  { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
  { name: 'tablet', viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2 },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
] as const;

/** Inspect the selected resource, after responsive sources and lazy loading. */
async function imageFindings(page: Page) {
  return page.evaluate(async () => {
    const findings: string[] = [];
    let count = 0;
    for (const image of document.images) {
      const box = image.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(image).visibility === 'hidden') continue;
      count++;
      const name = image.getAttribute('alt') ?? '[missing alt]';
      if (!image.hasAttribute('alt')) findings.push(`${name}: missing alt`);
      const width = Number(image.getAttribute('width'));
      const height = Number(image.getAttribute('height'));
      const ratio = getComputedStyle(image).aspectRatio;
      if (!(width > 0 && height > 0) && (!ratio || ratio === 'auto')) findings.push(`${name}: missing dimensions`);
      if (image.decoding !== 'async') findings.push(`${name}: decoding is not async`);
      await image.decode().catch(() => undefined);
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) {
        findings.push(`${name}: image did not decode`);
        continue;
      }
      const source = image.currentSrc;
      const vector = /^data:image\/svg\+xml[;,]/i.test(source) || /\.svg(?:[?#]|$)/i.test(source);
      if (vector) continue;
      if (!/^data:image\/(?:avif|webp)[;,]/i.test(source) && !/\.(?:avif|webp)(?:[?#]|$)/i.test(source)) {
        findings.push(`${name}: selected raster is not AVIF or WebP`);
      }
      if (image.naturalWidth > box.width * devicePixelRatio * 1.5 || image.naturalHeight > box.height * devicePixelRatio * 1.5) {
        findings.push(`${name}: raster exceeds 1.5x displayed device pixels`);
      }
    }
    return { count, findings };
  });
}

async function settleImages(page: Page) {
  // Images below the fold must enter the viewport before their decode and
  // currentSrc can count as evidence. The app scrolls inside #main-content.
  for (const image of await page.locator('img').all()) {
    if (await image.isVisible()) await image.scrollIntoViewIfNeeded();
  }
}

async function fixtures(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
  });
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
    if (url.pathname === '/api/quiz/roadmap') return route.fulfill({ json: { topics: [], structure: {} } });
    if (url.pathname === '/api/play/join' || url.pathname === '/api/play/state') {
      const match = {
        id: 'images-room', code: 'ABC123', mode: 'multiplayer', host_id: fakeUser.id,
        host_name: 'Test Learner', status: 'lobby', current_index: 0,
        questions: [], question_count: 5, started_at: null,
      };
      return route.fulfill({ json: url.pathname.endsWith('/join') ? match : {
        match, participants: [{ user_id: fakeUser.id, display_name: 'Test Learner', joined_at: '2026-11-18T12:00:00Z' }], scoreboard: [],
      } });
    }
    if (url.pathname === '/api/play/heartbeat') return route.fulfill({ json: { ok: true } });
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'Offline fixture' } } });
  });
}

for (const profile of PROFILES) {
  test.describe(`${profile.name} images at ${profile.viewport.width}px and ${profile.deviceScaleFactor}x`, () => {
    test.use({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor });

    test('home and quiz images reserve space and select vector or efficient raster sources', async ({ page }) => {
      await fixtures(page);
      for (const route of ['/', '/quiz']) {
        await page.goto(route);
        await expect(page.locator('h1')).toBeVisible();
        await expect.poll(() => page.locator('img').count()).toBeGreaterThan(0);
        await settleImages(page);
        const checked = await imageFindings(page);
        expect(checked.count, `${route}: inspected rendered images`).toBeGreaterThan(0);
        expect(checked.findings, route).toEqual([]);
      }
    });

    test('the room invitation stays vector at every device density', async ({ page }) => {
      await fixtures(page);
      await storeFakeSession(page);
      await localAuth(page);
      // Keep the fixture offline, including Supabase's optional socket. The
      // room uses its existing polling fallback when the socket closes.
      await page.routeWebSocket(/\/realtime\/v1\//, socket => socket.close());
      await page.goto('/play/ABC123');
      const qr = page.getByRole('img', { name: 'QR code to join match ABC123' });
      await expect(qr).toBeVisible();
      await expect(qr).toHaveJSProperty('complete', true);
      expect(await qr.evaluate(image => (image as HTMLImageElement).currentSrc)).toMatch(/^data:image\/svg\+xml[;,]/);
      const checked = await imageFindings(page);
      expect(checked.count).toBeGreaterThan(0);
      expect(checked.findings).toEqual([]);
    });
  });
}

test('the image guard detects missing metadata and oversized legacy rasters', async ({ page }) => {
  await page.setContent('<main><h1>Image guard fixture</h1></main>');
  await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1000;
    const image = new Image();
    image.style.width = image.style.height = '10px';
    image.src = canvas.toDataURL('image/png');
    document.querySelector('main')!.append(image);
  });
  const checked = await imageFindings(page);
  expect(checked.count).toBe(1);
  expect(checked.findings).toEqual(expect.arrayContaining([
    '[missing alt]: missing alt',
    '[missing alt]: missing dimensions',
    '[missing alt]: decoding is not async',
    '[missing alt]: selected raster is not AVIF or WebP',
    '[missing alt]: raster exceeds 1.5x displayed device pixels',
  ]));
});
