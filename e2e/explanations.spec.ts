// 画面の説明 (2026-11-16): the explanations of how things work can be hidden from 表示 or
// 環境設定 (remembered); the facts (sizes, counts) and warnings stay.
import { expect, test } from '@playwright/test';
import { state } from './helpers';

test('表示 → 画面の説明を表示 hides the explanations, keeps the facts, and is remembered', async ({ page }) => {
  await page.goto('/');
  const props = page.getByRole('region', { name: 'プロパティ' });
  await expect(props).toBeVisible();
  const toolHint = props.getByText(/クリックで選択、Shift\+クリックで追加選択/);
  await expect(toolHint).toBeVisible();
  await expect(props.getByText(/キャンバス \d+ × \d+ px/)).toBeVisible();

  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /画面の説明を表示/ }).click();
  expect(await state(page, 's => s.explanations')).toBe(false);
  await expect(toolHint).toBeHidden();
  await expect(props.getByText('選択ツール', { exact: false }).first()).toBeVisible(); // the tool's name stays
  await expect(props.getByText(/キャンバス \d+ × \d+ px/)).toBeVisible(); // a fact

  // Remembered; dialogs (shown outside the app) follow as well.
  await page.reload();
  await expect(props).toBeVisible();
  expect(await state(page, 's => s.explanations')).toBe(false);
  await expect(toolHint).toBeHidden();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByRole('menuitem', { name: '環境設定…' }).click();
  const prefs = page.getByRole('dialog', { name: '環境設定' });
  await expect(prefs.getByText(/30 秒ほどでこのブラウザの中に自動保存/)).toBeHidden();
  // Back on from 環境設定.
  await prefs.getByLabel(/画面の説明を表示/).check();
  await expect(prefs.getByText(/30 秒ほどでこのブラウザの中に自動保存/)).toBeVisible();
  await prefs.getByRole('button', { name: '閉じる' }).click();
  await expect(toolHint).toBeVisible();
});
