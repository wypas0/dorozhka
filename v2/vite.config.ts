import { writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Строгий CSP для /beta: только свои файлы, без внешних скриптов, шрифтов и стилей.
// 'unsafe-inline' для стилей нужен атрибутам style в разметке Preact; скрипты — только свои.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self' https://accounts.google.com",
].join('; ');
const HEADERS = `/beta/*
  Content-Security-Policy: ${CSP}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`;
// Кэш «навсегда» для /beta/assets/* сюда не ставим: правило _headers попадает и на ответ 404,
// и браузер на год запоминает «файла нет», если зайдёт в момент выкладки.

export default defineConfig({
  root: 'src/web',
  base: '/beta/',
  plugins: [
    preact(),
    { name: 'dorozhka-headers', closeBundle: () => writeFileSync(new URL('./dist/_headers', import.meta.url), HEADERS) },
  ],
  build: { outDir: '../../dist/beta', emptyOutDir: true, assetsInlineLimit: 0 },
});
