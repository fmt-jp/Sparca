import { expect, test, type Page } from '@playwright/test';
import { buildTestFont } from '../src/render/testFont';
import { canvasBox, state } from './helpers';

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

const font = (page: Page) => state<string>(page, 's => s.doc.layers[0].children[0].fontFamily');
const textWidth = (page: Page) => state<number>(page, 's => s.doc.layers[0].children[0].box.width');

async function addText(page: Page) {
  const c = await canvasBox(page);
  await page.keyboard.press('t');
  await page.mouse.click(c.x + 200, c.y + 200);
  await expect(page.locator('textarea.text-editor')).toBeFocused();
  await page.keyboard.type('Hanabi 花火 WWW');
  await page.keyboard.press('Escape');
}

const openPicker = (page: Page) => page.getByRole('button', { name: 'フォント', exact: true }).click();
const list = (page: Page) => page.getByRole('listbox', { name: 'フォント一覧' });

test('the font list shows the fonts on this PC, each in its own typeface, and applies the choice', async ({ page }) => {
  await page.goto('/');
  await addText(page);
  expect(await font(page)).toBe('sans-serif');
  await openPicker(page);
  // Generic families are always there; well-known fonts appear only when installed.
  await expect(list(page).getByRole('option', { name: /明朝体（標準）/ })).toBeVisible();
  const missing = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d')!;
    const w = (f: string) => ((c.font = `72px ${f}`), c.measureText('mmmmmmmmmmlliWW永あア漢字').width);
    return ['Hiragino Sans', 'Yu Gothic', 'Meiryo'].filter((f) => ['monospace', 'serif', 'sans-serif'].every((b) => Math.abs(w(`"${f}", ${b}`) - w(b)) <= 0.5));
  });
  for (const f of missing) await expect(list(page).locator(`[data-family="${f}"]`)).toHaveCount(0);
  // Each option is drawn in its own font.
  await expect(list(page).locator('[data-family="serif"] .font-option-name')).toHaveCSS('font-family', 'serif');

  // Pick the first installed (non-generic) font.
  const first = list(page).locator('[role="group"]').first().getByRole('option').first();
  const family = (await first.getAttribute('data-family'))!;
  await first.click();
  await expect(page.getByRole('dialog', { name: 'フォントの選択' })).toHaveCount(0);
  expect(await font(page)).toBe(family);
  await expect(page.locator('[data-testid=canvas] text')).toHaveAttribute('font-family', `"${family}", sans-serif`);
  await expect(page.getByRole('button', { name: 'フォント', exact: true })).toHaveAttribute('data-font', family);

  // A clearly different font refits the text box.
  const before = await textWidth(page);
  await openPicker(page);
  await list(page).getByRole('option').filter({ hasText: '等幅（標準）' }).click();
  expect(await font(page)).toBe('monospace');
  expect(await textWidth(page)).not.toBe(before);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await font(page)).toBe('sans-serif');
});

test('search, keyboard choice, and a typed name not in the list', async ({ page }) => {
  await page.goto('/');
  await addText(page);
  await openPicker(page);
  const search = page.getByRole('textbox', { name: 'フォントを検索' });
  await expect(search).toBeFocused();
  await search.fill('mono');
  await expect(list(page).getByRole('option').filter({ hasText: '等幅（標準）' })).toBeVisible();
  await expect(list(page).getByRole('option').filter({ hasText: '明朝体（標準）' })).toHaveCount(0);
  // The first entry offers the typed text itself; ↓ moves to the next match.
  await page.keyboard.press('ArrowDown');
  const target = (await list(page).locator('[data-active="true"]').getAttribute('data-family'))!;
  await page.keyboard.press('Enter');
  expect(await font(page)).toBe(target);

  await openPicker(page);
  await page.getByRole('textbox', { name: 'フォントを検索' }).fill('My Special Font');
  await expect(list(page).getByRole('option', { name: '「My Special Font」を使う' })).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await font(page)).toBe('My Special Font');
  // Not installed here: the field warns that a substitute is shown.
  const btn = page.getByRole('button', { name: 'フォント', exact: true });
  await expect(btn).toHaveAttribute('title', /この PC にない/);
  await expect(btn.locator('.font-missing')).toBeVisible();
  // Escape closes without changing.
  await openPicker(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'フォントの選択' })).toHaveCount(0);
  expect(await font(page)).toBe('My Special Font');
});

test('「この PC のすべてのフォントを表示」 lists every installed family, with Japanese names read from the font files', async ({ page }) => {
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  const fonts = {
    // Chrome reports English names only; the Japanese name is inside the file.
    itaitai: b64(buildTestFont([{ id: 1, language: 0x0409, text: 'AR Itaitai E' }, { id: 1, language: 0x0411, text: 'AR板体E' }, { id: 6, language: 0x0409, text: 'ARItaitaiE' }])),
    zebra: b64(buildTestFont([{ id: 1, language: 0x0409, text: 'Zebra Sans' }])),
  };
  await page.addInitScript((f) => {
    const blob = (s: string) => async () => new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))]);
    (window as unknown as { queryLocalFonts: () => Promise<unknown[]> }).queryLocalFonts = async () => [
      { family: 'Zebra Sans', style: 'Bold', postscriptName: 'ZebraSans-Bold', blob: blob(f.zebra) },
      { family: 'Zebra Sans', style: 'Regular', postscriptName: 'ZebraSans', blob: blob(f.zebra) }, // several styles of one family
      { family: 'Aardvark Serif', style: 'Regular', postscriptName: 'Aardvark' },
      { family: 'AR Itaitai E', style: 'Regular', postscriptName: 'ARItaitaiE', blob: blob(f.itaitai) },
    ];
  }, fonts);
  await page.goto('/');
  await addText(page);
  await openPicker(page);
  await page.getByRole('button', { name: 'この PC のすべてのフォントを表示…' }).click();
  const all = list(page).getByRole('group', { name: 'この PC のすべてのフォント' });
  // Shown and sorted by the Japanese name where the font has one.
  await expect(all.getByRole('option')).toHaveText([/Aardvark Serif/, /AR板体E/, /Zebra Sans/]);
  await expect(all.locator('[data-family="AR Itaitai E"]')).toHaveAttribute('title', 'AR板体E（AR Itaitai E）');
  // Searchable by the Japanese name; the text keeps the family name the browser knows.
  await page.getByRole('textbox', { name: 'フォントを検索' }).fill('板体');
  await expect(list(page).getByRole('option', { name: /AR板体E/ })).toBeVisible();
  await list(page).getByRole('option', { name: /AR板体E/ }).click();
  expect(await font(page)).toBe('AR Itaitai E');
  await expect(page.getByRole('button', { name: 'フォント', exact: true })).toContainText('AR板体E');
  // The names are remembered, so the files are read only once.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sparca.fontLabels') ?? '{}'))).toMatchObject({ 'AR Itaitai E': 'AR板体E', 'Zebra Sans': 'Zebra Sans' });
  // The button is not offered again once the list is loaded.
  await openPicker(page);
  await expect(page.getByRole('button', { name: 'この PC のすべてのフォントを表示…' })).toHaveCount(0);
});
