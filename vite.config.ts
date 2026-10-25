/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content Security Policy for the built app (a <meta> tag, since GitHub Pages cannot send
 * headers). Everything the app loads comes from its own origin; images also come from
 * blob: / data: URLs it creates itself. No inline or external scripts, no plug-ins, no
 * network access beyond its own files. Not applied to the dev server, which injects inline
 * scripts for hot reload.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'hanabi-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replace(/<meta charset="UTF-8" \/>/, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  // Relative asset URLs so the build works from any sub-path (e.g. GitHub Pages /Sparca/).
  base: './',
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
