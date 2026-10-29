// Modules split off the main bundle (loaded on demand) and the image worker.
//
// A published update replaces every file on the server, so a page opened before the update
// cannot fetch the old split-off files any more ("Failed to fetch dynamically imported
// module"). To keep an open page working, everything split off is fetched right after
// startup (preloadLazyModules), and a failed load says what to do instead of a raw error.

export const APP_UPDATED_MESSAGE =
  'アプリが更新されたため、必要なファイルを読み込めませんでした。作業内容を保存（Ctrl+S）してから、ページを再読み込みしてください。';

/** A load failure caused by the app having been updated on the server. */
export class AppUpdatedError extends Error {
  constructor() {
    super(APP_UPDATED_MESSAGE);
  }
}

/** Load a module once; a failed load is retried next time and reported as AppUpdatedError. */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => {
    p ??= load().catch(() => {
      p = null;
      throw new AppUpdatedError();
    });
    return p;
  };
}

export const loadRasterize = lazy(() => import('./render/rasterize'));
export const loadSvgExport = lazy(() => import('./io/svgExport'));
export const loadFontNames = lazy(() => import('./render/fontNames'));
export const loadPathBoolean = lazy(() => import('./engine/pathBoolean'));

/** Fetch every split-off module (and start the image worker) so later use needs no download. */
export function preloadLazyModules(startWorker: () => void): void {
  const run = () => {
    for (const load of [loadRasterize, loadSvgExport, loadFontNames, loadPathBoolean]) void load().catch(() => undefined);
    startWorker();
  };
  // After the first paint, so startup stays fast.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 500);
}
