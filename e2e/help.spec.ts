import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('ヘルプ → 操作ガイド shows the basics by topic', async ({ page }) => {
  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  await page.getByRole('menuitem', { name: /操作ガイド/ }).click();
  const dialog = page.getByRole('dialog', { name: '操作ガイド' });
  await expect(dialog).toBeVisible();
  // Starts with the overview.
  await expect(dialog.getByRole('article')).toContainText('基本の流れ');
  const nav = dialog.getByRole('navigation', { name: '項目' });
  for (const t of ['画面の見かた', '選択・移動・変形', '図形・テキスト・パス', 'レイヤー', '画像の加工', '範囲選択', 'エフェクト', '保存・書き出し', 'キーボードショートカット', '動作環境']) {
    await expect(nav.getByRole('button', { name: t })).toBeVisible();
  }
  await nav.getByRole('button', { name: '範囲選択' }).click();
  await expect(dialog.getByRole('article', { name: '範囲選択' })).toContainText('選択範囲を拡張');
  await expect(nav.getByRole('button', { name: '範囲選択' })).toHaveAttribute('aria-current', 'page');
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(dialog).toHaveCount(0);
});

test('F1 opens the guide; キーボードショートカット opens it at the shortcut list', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'プロパティ' })).toBeVisible();
  await page.keyboard.press('F1');
  const dialog = page.getByRole('dialog', { name: '操作ガイド' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  await page.getByRole('menuitem', { name: 'キーボードショートカット…' }).click();
  const article = dialog.getByRole('article', { name: 'キーボードショートカット' });
  await expect(article).toBeVisible();
  await expect(article.getByRole('row', { name: /取り消し／やり直し/ })).toContainText('Ctrl+Z');
  await expect(article.getByRole('row', { name: /操作ガイド/ })).toContainText('F1');
});

test('the guide has the system requirements (動作環境)', async ({ page }) => {
  await page.getByRole('button', { name: 'ヘルプ', exact: true }).click();
  await page.getByRole('menuitem', { name: '動作環境…' }).click();
  const article = page.getByRole('dialog', { name: '操作ガイド' }).getByRole('article', { name: '動作環境' });
  await expect(article).toContainText('Google Chrome');
  await expect(article).toContainText('16,384px');
  await expect(article).toContainText('サーバーには送信されません');
});
