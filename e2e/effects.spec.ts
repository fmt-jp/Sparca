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

test('tone curve: add and move points (graph or numbers), per-channel curves, delete, reset, undo', async ({ page }) => {
  await rect(page);
  await addEffect(page, '色の調整', 'トーンカーブ');
  type Pt = { x: number; y: number };
  const curves = async () => (await effects(page))[0].curves as Record<'rgb' | 'r' | 'g' | 'b', Pt[]>;
  // Untouched: no filter at all.
  await expect(page.locator('[data-testid=canvas] filter')).toHaveCount(0);

  const graph = props(page).getByRole('group', { name: 'トーンカーブのカーブ' });
  await graph.scrollIntoViewIfNeeded();
  const g = (await graph.boundingBox())!;
  // The graph's 0..255 area sits inside a small margin (viewBox -6..261).
  const at = (x: number, y: number) => ({ x: g.x + ((x + 6) / 267) * g.width, y: g.y + ((261 - y) / 267) * g.height });

  // Click on the graph adds a point; dragging it raises the midtones.
  await drag(page, at(128, 128), at(128, 190));
  let c = await curves();
  expect(c.rgb).toHaveLength(3);
  expect(Math.abs(c.rgb[1].x - 128)).toBeLessThanOrEqual(4);
  expect(Math.abs(c.rgb[1].y - 190)).toBeLessThanOrEqual(4);
  // Exact values by typing.
  await setNum(page, 'トーンカーブの入力', '128');
  await setNum(page, 'トーンカーブの出力', '192');
  expect((await curves()).rgb[1]).toEqual({ x: 128, y: 192 });
  let [px] = await exportPixels(page, [[200, 200]]);
  expect(px[0]).toBeGreaterThan(BLUE[0] + 40);
  expect(px[1]).toBeGreaterThan(BLUE[1] + 30);
  const brightened = px.slice(0, 3);

  // Red channel only: lift its dark end.
  await props(page).getByRole('group', { name: 'トーンカーブのチャンネル' }).getByRole('button', { name: '赤' }).click();
  await setNum(page, 'トーンカーブの出力', '120'); // point 0 of the red curve
  expect((await curves()).r[0]).toEqual({ x: 0, y: 120 });
  [px] = await exportPixels(page, [[200, 200]]);
  expect(px[0]).toBeGreaterThan(brightened[0] + 20);
  expect(px[1]).toBe(brightened[1]);
  expect(px[2]).toBe(brightened[2]);
  await props(page).getByRole('button', { name: 'リセット' }).click();
  expect((await curves()).r).toEqual([{ x: 0, y: 0 }, { x: 255, y: 255 }]);

  // Back to RGB: a drag is one undo step; Delete removes the selected point.
  await props(page).getByRole('group', { name: 'トーンカーブのチャンネル' }).getByRole('button', { name: 'RGB' }).click();
  const before = await curves();
  await drag(page, at(64, 64), at(64, 30));
  expect((await curves()).rgb).toHaveLength(4);
  await page.keyboard.press('Control+z');
  expect(await curves()).toEqual(before);
  c = await curves();
  const p1 = at(128, 192);
  await page.mouse.click(p1.x, p1.y); // select the middle point (no move = no change)
  expect(await curves()).toEqual(c);
  await page.keyboard.press('ArrowUp');
  expect((await curves()).rgb[1].y).toBe(c.rgb[1].y + 1);
  await page.keyboard.press('Delete');
  expect((await curves()).rgb).toEqual([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
  expect(await effects(page)).toHaveLength(1); // the shape and effect are still there
  await expect(page.locator('[data-testid=canvas] filter')).toHaveCount(0);
});
