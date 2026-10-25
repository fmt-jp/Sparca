// The built app runs under a strict Content Security Policy: everything it needs keeps
// working (no violations), and injected inline scripts do not run.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addEffect, canvasBox, disableNativePickers, drag, makePng, placePng, state } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto('/');
});

const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

test('the page carries the policy, and inline scripts are blocked', async ({ page }) => {
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  const ran = await page.evaluate(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__injected = true';
    document.body.appendChild(s);
    await new Promise((r) => setTimeout(r, 50));
    return (window as unknown as { __injected?: boolean }).__injected === true;
  });
  expect(ran).toBe(false);
  expect((await violations(page)).some((v) => v.startsWith('script-src'))).toBe(true);
});

test('editing, effects, gradients, image processing, eyedropper, help and export work without violations', async ({ page }) => {
  await placePng(page, 'g.png', makePng(120, 80, (x) => [x * 2, 100, 200, 255]));
  await page.keyboard.press('v');
  const props = page.getByRole('region', { name: 'プロパティ' });
  const b = props.locator('input[type="text"][aria-label="明るさ"]');
  await b.fill('30');
  await b.press('Enter');
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 20, y: c.y + 20 }, { x: c.x + 120, y: c.y + 120 });
  await addEffect(page, 'シャドウとグロー', 'ドロップシャドウ');
  await addEffect(page, 'ぼかしとシャープ', 'ぼかし（ズーム）');
  // Conic gradient (drawn into a data: URL image).
  await props.getByLabel('塗りの種類').selectOption('conic');
  expect(await state<string>(page, 's => s.doc.layers[0].children[1].fill.kind')).toBe('conic');
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 300, c.y + 400);
  await page.keyboard.type('CSP');
  await page.keyboard.press('Escape');
  // Eyedropper (renders the document through a blob: SVG image).
  await page.keyboard.press('i');
  await page.mouse.click(c.x + 400, c.y + 300);
  await expect(page.getByTestId('picked-color')).toBeVisible();
  // Help with the logo.
  await page.keyboard.press('F1');
  await expect(page.getByRole('img', { name: '花火 HANABI' })).toBeVisible();
  await page.keyboard.press('Escape');
  // PNG and SVG export.
  for (const format of ['PNG', 'SVG']) {
    await page.keyboard.press('Control+Shift+E');
    const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
    await dialog.getByLabel(format, { exact: true }).check();
    const dl = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '書き出し' }).click();
    expect(readFileSync((await (await dl).path())!).length).toBeGreaterThan(100);
  }
  expect(await state<number>(page, 's => s.doc.layers[0].children.length')).toBe(3);
  await expect(page.locator('.notice.error')).toHaveCount(0);
  expect(await violations(page)).toEqual([]);
});
