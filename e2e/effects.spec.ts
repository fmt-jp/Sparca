import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addEffect, canvasBox, decodePixels, disableNativePickers, drag, makePng, placePng, setColor, state } from './helpers';

test.beforeEach(async ({ page }) => {
  await disableNativePickers(page);
  await page.goto('/');
});

test.afterEach(async ({ page }) => {
  await expect(page.locator('.notice.error')).toHaveCount(0);
});

type Fx = { kind: string; enabled: boolean; strength: number } & Record<string, unknown>;
const effects = (page: Page) => state<Fx[]>(page, 's => s.doc.layers[0].children[0].effects');
const props = (page: Page) => page.getByRole('region', { name: 'プロパティ' });

async function exportPixels(page: Page, points: [number, number][]) {
  await page.keyboard.press('Control+Shift+E');
  const dialog = page.getByRole('dialog', { name: '画像として書き出し' });
  await dialog.getByLabel('PNG', { exact: true }).check();
  const dl = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '書き出し' }).click();
  const bytes = readFileSync((await (await dl).path())!);
  return (await decodePixels(page, bytes, 'image/png', points)).px;
}

async function setNum(page: Page, label: string, v: string) {
  const i = props(page).locator(`input[type="text"][aria-label="${label}"]`);
  await i.fill(v);
  await i.press('Enter');
}

/** Blue (#4a90e2) rectangle (100,100)–(300,300) on the white canvas, selected. */
async function rect(page: Page) {
  const c = await canvasBox(page);
  await page.keyboard.press('r');
  await drag(page, { x: c.x + 100, y: c.y + 100 }, { x: c.x + 300, y: c.y + 300 });
  return c;
}

const BLUE = [74, 144, 226];
const lum = (p: number[]) => p[0] + p[1] + p[2];

test('several effects: listed in order, applied top to bottom, reorderable, undoable', async ({ page }) => {
  await rect(page);
  await addEffect(page, '色の調整', 'カラーオーバーレイ'); // red
  await addEffect(page, '色の調整', '反転');
  expect((await effects(page)).map((e) => e.kind)).toEqual(['color-overlay', 'invert']);
  await expect(props(page).locator('.effect-name')).toHaveText(['▾カラーオーバーレイ', '反転']);
  // Red, then inverted → cyan.
  let [px] = await exportPixels(page, [[200, 200]]);
  expect(px.slice(0, 3)).toEqual([0, 255, 255]);

  // Move 反転 up: inverted first, then painted red → red.
  await props(page).getByRole('button', { name: '反転を上へ' }).click();
  expect((await effects(page)).map((e) => e.kind)).toEqual(['invert', 'color-overlay']);
  [px] = await exportPixels(page, [[200, 200]]);
  expect(px.slice(0, 3)).toEqual([255, 0, 0]);
  await expect(props(page).getByRole('button', { name: '反転を上へ' })).toBeDisabled();

  await page.keyboard.press('Control+z');
  expect((await effects(page)).map((e) => e.kind)).toEqual(['color-overlay', 'invert']);
  await props(page).getByRole('button', { name: 'カラーオーバーレイを削除', exact: true }).click();
  expect((await effects(page)).map((e) => e.kind)).toEqual(['invert']);
});

test('on/off and strength: off removes the effect without losing its settings; strength blends', async ({ page }) => {
  await rect(page);
  await addEffect(page, '色の調整', 'カラーオーバーレイ');
  await props(page).getByLabel('カラーオーバーレイを有効にする').uncheck();
  expect((await effects(page))[0]).toMatchObject({ enabled: false, color: '#ff0000' });
  await expect(page.locator('[data-testid=canvas] filter')).toHaveCount(0);
  let [px] = await exportPixels(page, [[200, 200]]);
  expect(px.slice(0, 3)).toEqual(BLUE);

  await props(page).getByLabel('カラーオーバーレイを有効にする').check();
  await setNum(page, 'カラーオーバーレイの強さ', '50');
  expect((await effects(page))[0].strength).toBeCloseTo(0.5, 5);
  [px] = await exportPixels(page, [[200, 200]]);
  // Halfway between blue and red.
  expect(px[0]).toBeGreaterThan(155);
  expect(px[0]).toBeLessThan(175);
  expect(px[2]).toBeGreaterThan(103);
  expect(px[2]).toBeLessThan(123);
});

test('the same kind can be added twice and is numbered; each has its own settings', async ({ page }) => {
  await rect(page);
  await addEffect(page, 'シャドウとグロー', 'ドロップシャドウ');
  await addEffect(page, 'シャドウとグロー', 'ドロップシャドウ');
  await setNum(page, 'ドロップシャドウ 1の距離', '0');
  await setNum(page, 'ドロップシャドウ 1のぼかし', '0');
  await setNum(page, 'ドロップシャドウ 2の角度', '-90'); // up
  await setNum(page, 'ドロップシャドウ 2の距離', '30');
  await setNum(page, 'ドロップシャドウ 2のぼかし', '0');
  await setNum(page, 'ドロップシャドウ 2の不透明度', '100');
  const fx = await effects(page);
  expect(fx.map((e) => [e.kind, e.distance])).toEqual([
    ['drop-shadow', 0],
    ['drop-shadow', 30],
  ]);
  // Shadow 2 shows above the rectangle.
  const [above, below] = await exportPixels(page, [[200, 85], [200, 315]]);
  expect(above.slice(0, 3)).toEqual([0, 0, 0]);
  expect(below.slice(0, 3)).toEqual([255, 255, 255]);
});

test('shadow, glow, bevel and emboss effects change the right pixels', async ({ page }) => {
  // Inner shadow (down-right): dark band inside the top-left edges.
  await rect(page);
  await addEffect(page, 'シャドウとグロー', '内側シャドウ');
  let px = await exportPixels(page, [[103, 200], [200, 200], [297, 200]]);
  expect(lum(px[0])).toBeLessThan(lum(BLUE) - 60);
  expect(px[1].slice(0, 3)).toEqual(BLUE);
  expect(px[2].slice(0, 3)).toEqual(BLUE);
  await props(page).getByRole('button', { name: '内側シャドウを削除', exact: true }).click();

  // Inner glow inside the edge, then glow outside (in that order, so the inner glow
  // is not also applied to the outer glow).
  await addEffect(page, 'シャドウとグロー', '内側グロー');
  await addEffect(page, 'シャドウとグロー', 'グロー');
  px = await exportPixels(page, [[98, 200], [102, 200], [200, 200]]);
  expect(px[0][2]).toBeLessThan(180); // yellow glow outside (less blue than white)
  expect(lum(px[1])).toBeGreaterThan(lum(BLUE) + 60); // white inner glow
  expect(px[2].slice(0, 3)).toEqual(BLUE);
  await props(page).getByRole('button', { name: 'グローを削除', exact: true }).click();
  await props(page).getByRole('button', { name: '内側グローを削除', exact: true }).click();

  // Inner bevel lit from the top-left.
  await addEffect(page, 'ベベルとエンボス', '内側ベベル');
  px = await exportPixels(page, [[102, 200], [298, 200], [200, 200]]);
  expect(lum(px[0])).toBeGreaterThan(lum(BLUE) + 60);
  expect(lum(px[1])).toBeLessThan(lum(BLUE) - 60);
  expect(px[2].slice(0, 3)).toEqual(BLUE);
  await props(page).getByRole('button', { name: '内側ベベルを削除', exact: true }).click();

  // Outer bevel (Fireworks-style): a red rim with rounded corners, lit at the top
  // (lighter than the rim color) and shaded at the bottom (darker).
  await addEffect(page, 'ベベルとエンボス', '外側ベベル');
  await setColor(page, props(page), '外側ベベルの縁の色', '#ff0000');
  px = await exportPixels(page, [[200, 95], [200, 305], [200, 120], [93, 93], [95, 200]]);
  const [top, bottom, inside, corner, left] = px;
  expect(top[0]).toBe(255);
  expect(top[1]).toBeGreaterThan(40); // highlight: toward pink
  expect(bottom[0]).toBeLessThan(200); // shade: darker red
  expect(bottom[1]).toBeLessThan(20);
  expect(left[0]).toBeGreaterThan(200); // the rim reaches all around
  expect(inside.slice(0, 3)).toEqual(BLUE);
  expect(corner.slice(0, 3)).toEqual([255, 255, 255]); // rounded, not a square corner
  await props(page).getByRole('button', { name: '外側ベベルを削除', exact: true }).click();

  // Emboss without the object's color: gray.
  await addEffect(page, 'ベベルとエンボス', 'エンボス');
  await props(page).getByLabel('オブジェクトの色を表示').uncheck();
  px = await exportPixels(page, [[200, 200]]);
  expect(px[0].slice(0, 3)).toEqual([128, 128, 128]);
});

test('blur, sharpen and color adjustments', async ({ page }) => {
  await rect(page);
  await addEffect(page, 'ぼかしとシャープ', 'ぼかし');
  let px = await exportPixels(page, [[100, 200], [95, 200]]);
  expect(px[0][0]).toBeGreaterThan(BLUE[0] + 30); // the edge mixes with the white around it
  expect(px[1].slice(0, 3)).not.toEqual([255, 255, 255]);
  await props(page).getByRole('button', { name: 'ぼかしを削除', exact: true }).click();

  await addEffect(page, 'ぼかしとシャープ', 'シャープ');
  await expect(page.locator('[data-testid=canvas] filter feComposite[operator="arithmetic"]')).toHaveCount(1);
  await props(page).getByRole('button', { name: 'シャープを削除', exact: true }).click();

  await addEffect(page, '色の調整', '明るさ・コントラスト');
  await setNum(page, '明るさ・コントラストの明るさ', '50');
  px = await exportPixels(page, [[200, 200]]);
  expect(lum(px[0])).toBeGreaterThan(lum(BLUE) + 150);
  await props(page).getByRole('button', { name: '明るさ・コントラストを削除', exact: true }).click();

  await addEffect(page, '色の調整', '色相・彩度');
  await setNum(page, '色相・彩度の彩度', '-100');
  px = await exportPixels(page, [[200, 200]]);
  expect(Math.max(...px[0].slice(0, 3)) - Math.min(...px[0].slice(0, 3))).toBeLessThan(3); // gray
});

test('effects also work on images, and are saved as editable settings', async ({ page }) => {
  await placePng(page, 'g.png', makePng(100, 100, () => [0, 0, 255, 255]));
  await page.keyboard.press('v');
  await addEffect(page, '色の調整', '反転');
  const x = await state<number>(page, 's => s.doc.layers[0].children[0].box.x');
  const y = await state<number>(page, 's => s.doc.layers[0].children[0].box.y');
  const [px] = await exportPixels(page, [[x + 50, y + 50]]);
  expect(px.slice(0, 3)).toEqual([255, 255, 0]);
  expect((await effects(page)).map((e) => e.kind)).toEqual(['invert']);
});

test('drag a row by its grip or name to reorder; one undo step; a plain click still opens the settings', async ({ page }) => {
  await rect(page);
  await addEffect(page, '色の調整', 'カラーオーバーレイ');
  await addEffect(page, '色の調整', '反転');
  await addEffect(page, 'ぼかしとシャープ', 'ぼかし');
  const kinds = async () => (await effects(page)).map((e) => e.kind);
  const center = async (loc: import('@playwright/test').Locator) => {
    const b = (await loc.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const rows = props(page).locator('.effect-row');
  // Fold the settings so all rows fit on screen.
  for (const n of ['カラーオーバーレイ', 'ぼかし']) await props(page).getByRole('button', { name: `${n}の設定` }).click();
  await rows.nth(0).scrollIntoViewIfNeeded();

  // Grip of ぼかし (last) dragged above the first row.
  const from = await center(rows.nth(2).locator('.effect-grip'));
  const top = (await rows.nth(0).boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, top.y + 10, { steps: 8 });
  await expect(rows.nth(0)).toHaveClass(/drop-before/);
  await expect(rows.nth(2)).toHaveClass(/drag-source/);
  await page.mouse.up();
  expect(await kinds()).toEqual(['blur', 'color-overlay', 'invert']);
  await expect(props(page).locator('.drop-before, .drop-after')).toHaveCount(0);

  // By the name: カラーオーバーレイ (now 2nd) to the end.
  const name = await center(props(page).getByRole('button', { name: 'カラーオーバーレイの設定' }));
  const last = (await rows.nth(2).boundingBox())!;
  const wasOpen = await props(page).getByRole('button', { name: 'カラーオーバーレイの設定' }).getAttribute('aria-expanded');
  await page.mouse.move(name.x, name.y);
  await page.mouse.down();
  await page.mouse.move(name.x, last.y + last.height - 2, { steps: 8 });
  await expect(rows.nth(2)).toHaveClass(/drop-after/);
  await page.mouse.up();
  expect(await kinds()).toEqual(['blur', 'invert', 'color-overlay']);
  // Dragging did not toggle the settings open/closed.
  await expect(props(page).getByRole('button', { name: 'カラーオーバーレイの設定' })).toHaveAttribute('aria-expanded', wasOpen!);

  // Dropping where it already is changes nothing.
  const g = await center(rows.nth(0).locator('.effect-grip'));
  await drag(page, g, { x: g.x, y: g.y + 3 });
  expect(await kinds()).toEqual(['blur', 'invert', 'color-overlay']);

  // Each drag is one undo step.
  await page.keyboard.press('Control+z');
  expect(await kinds()).toEqual(['blur', 'color-overlay', 'invert']);
  await page.keyboard.press('Control+z');
  expect(await kinds()).toEqual(['color-overlay', 'invert', 'blur']);

  // A plain click on the name still opens / closes the settings.
  const btn = props(page).getByRole('button', { name: 'ぼかしの設定' });
  const before = await btn.getAttribute('aria-expanded');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', before === 'true' ? 'false' : 'true');
});

test('tone curve: edited in a pop-up dialog, previewed live, confirmed with OK or reverted with キャンセル', async ({ page }) => {
  await rect(page);
  type Pt = { x: number; y: number };
  const curves = async () => (await effects(page))[0].curves as Record<'rgb' | 'r' | 'g' | 'b', Pt[]>;
  const undoLabel = () => state<string | undefined>(page, 's => s.history.past[s.history.past.length - 1]?.label');

  // Adding a tone curve opens its dialog at once; キャンセル on a new curve removes it again.
  await addEffect(page, '色の調整', 'トーンカーブ');
  let dlg = page.getByRole('dialog', { name: 'トーンカーブ' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'キャンセル' }).click();
  await expect(dlg).toHaveCount(0);
  expect(await effects(page)).toHaveLength(0);
  expect(await undoLabel()).toBe('図形の作成'); // nothing left in the history

  await addEffect(page, '色の調整', 'トーンカーブ');
  dlg = page.getByRole('dialog', { name: 'トーンカーブ' });
  const graph = dlg.getByRole('group', { name: 'トーンカーブのカーブ' });
  const g = (await graph.boundingBox())!;
  // The graph's 0..255 area sits inside a small margin (viewBox -6..261).
  const at = (x: number, y: number) => ({ x: g.x + ((x + 6) / 267) * g.width, y: g.y + ((261 - y) / 267) * g.height });

  // Click on the graph adds a point; dragging it raises the midtones. The canvas
  // previews the change while the dialog is open.
  await drag(page, at(128, 128), at(128, 190));
  let c = await curves();
  expect(c.rgb).toHaveLength(3);
  expect(Math.abs(c.rgb[1].x - 128)).toBeLessThanOrEqual(3);
  expect(Math.abs(c.rgb[1].y - 190)).toBeLessThanOrEqual(3);
  await expect(page.locator('[data-testid=canvas] filter feComponentTransfer')).toHaveCount(1);
  // Exact values by typing.
  for (const [label, v] of [['トーンカーブの入力', '128'], ['トーンカーブの出力', '192']]) {
    const input = dlg.locator(`input[aria-label="${label}"]`);
    await input.fill(v);
    await input.press('Enter');
  }
  expect((await curves()).rgb[1]).toEqual({ x: 128, y: 192 });
  // Red channel only: lift its dark end.
  await dlg.getByRole('group', { name: 'トーンカーブのチャンネル' }).getByRole('button', { name: '赤' }).click();
  const out = dlg.locator('input[aria-label="トーンカーブの出力"]');
  await out.fill('120'); // point 0 of the red curve
  await out.press('Enter');
  await dlg.getByRole('button', { name: 'OK' }).click();
  await expect(dlg).toHaveCount(0);
  c = await curves();
  expect(c.rgb[1]).toEqual({ x: 128, y: 192 });
  expect(c.r[0]).toEqual({ x: 0, y: 120 });
  expect(await undoLabel()).toBe('トーンカーブの追加'); // the whole dialog is one undo step
  let [px] = await exportPixels(page, [[200, 200]]);
  expect(px[0]).toBeGreaterThan(BLUE[0] + 80); // midtones up + red lifted
  expect(px[1]).toBeGreaterThan(BLUE[1] + 30);

  // Reopen from the list: changes, then キャンセル (or Esc) → nothing changes.
  const saved = await curves();
  await props(page).getByRole('button', { name: 'トーンカーブの設定' }).click();
  dlg = page.getByRole('dialog', { name: 'トーンカーブ' });
  await dlg.getByRole('button', { name: 'リセット' }).click(); // RGB curve back to a line
  expect((await curves()).rgb).toHaveLength(2);
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(await curves()).toEqual(saved);

  // Reopen: keyboard editing, OK, then a single undo restores the previous curve.
  await props(page).getByRole('button', { name: 'トーンカーブの設定' }).click();
  dlg = page.getByRole('dialog', { name: 'トーンカーブ' });
  const p1 = at(128, 192);
  await page.mouse.click(p1.x, p1.y); // select the middle point (no move = no change)
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  expect((await curves()).rgb[1]).toEqual({ x: 128, y: 194 });
  await page.keyboard.press('Delete');
  expect((await curves()).rgb).toHaveLength(2);
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect(await undoLabel()).toBe('トーンカーブの変更');
  await page.keyboard.press('Control+z');
  expect(await curves()).toEqual(saved);
  [px] = await exportPixels(page, [[200, 200]]);
  expect(px[0]).toBeGreaterThan(BLUE[0] + 80);
});

test('the tone curve dialog keeps the canvas undimmed and can be moved by its title', async ({ page }) => {
  await rect(page);
  await addEffect(page, '色の調整', 'トーンカーブ');
  const dlg = page.getByRole('dialog', { name: 'トーンカーブ' });
  await expect(page.locator('.dialog-backdrop')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const before = (await dlg.boundingBox())!;
  const title = (await dlg.locator('.dialog-title').boundingBox())!;
  await drag(page, { x: title.x + 40, y: title.y + title.height / 2 }, { x: title.x + 240, y: title.y + title.height / 2 + 30 });
  const after = (await dlg.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(200, 0);
  expect(after.y - before.y).toBeCloseTo(30, 0);
  await expect(dlg).toBeVisible(); // moving does not close it
  await dlg.getByRole('button', { name: 'OK' }).click();
  expect((await effects(page)).map((e) => e.kind)).toEqual(['curves']);
});

test('ぼかし（ズーム）: streaks outward from the center, follows the center setting and the effect order', async ({ page }) => {
  await rect(page); // blue (100,100)–(300,300)
  await addEffect(page, 'ぼかしとシャープ', 'ぼかし（ズーム）');
  expect((await effects(page))[0]).toMatchObject({ kind: 'zoom-blur', amount: 0.2, centerX: 0.5, centerY: 0.5 });
  await expect(page.locator('[data-testid=canvas] [data-zoom-blur]')).toHaveCount(1);
  let px = await exportPixels(page, [[200, 200], [305, 200], [95, 200], [335, 200]]);
  // The center stays the shape's color (within rounding of the stacked copies).
  for (let c = 0; c < 3; c++) expect(Math.abs(px[0][c] - BLUE[c])).toBeLessThanOrEqual(4);
  for (const p of [px[1], px[2]]) {
    expect(p[0]).toBeLessThan(230); // streaks reach outside on both sides
    expect(p[2]).toBeGreaterThan(p[0]);
  }
  expect(px[3].slice(0, 3)).toEqual([255, 255, 255]); // beyond 120 % of the half width

  // Center at the left edge: streaks only go right.
  await setNum(page, 'ぼかし（ズーム）の中心 X', '0');
  px = await exportPixels(page, [[95, 200], [310, 200]]);
  expect(px[0].slice(0, 3)).toEqual([255, 255, 255]);
  expect(px[1][0]).toBeLessThan(230);

  // An effect above it is blurred along (red streaks); one below it applies to the result.
  await addEffect(page, '色の調整', 'カラーオーバーレイ');
  await props(page).getByRole('button', { name: 'カラーオーバーレイを上へ' }).click();
  px = await exportPixels(page, [[310, 200]]);
  expect(px[0][0]).toBeGreaterThan(200);
  expect(px[0][2]).toBeLessThan(200); // red, not blue
  await addEffect(page, '色の調整', '反転');
  px = await exportPixels(page, [[200, 200]]);
  // Red overlay, zoomed, then inverted → cyan.
  expect(px[0][0]).toBeLessThanOrEqual(4);
  expect(px[0][1]).toBeGreaterThanOrEqual(251);
  expect(px[0][2]).toBeGreaterThanOrEqual(251);

  // Off: no copies.
  await props(page).getByLabel('ぼかし（ズーム）を有効にする').uncheck();
  await expect(page.locator('[data-testid=canvas] [data-zoom-blur]')).toHaveCount(0);
});
