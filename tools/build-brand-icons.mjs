// Regenerate apps/web/src/lib/brand-icons.ts from the simple-icons package.
//
// The share sheet needs eight brand marks. Importing the package at runtime
// would pull an index of over three thousand icons into the bundle, so the
// paths are extracted once and checked in. Run this after updating the package.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const si = createRequire(import.meta.url)('simple-icons');

const WANT = [
  ['instagram', 'siInstagram'], ['x', 'siX'], ['bluesky', 'siBluesky'],
  ['mastodon', 'siMastodon'], ['facebook', 'siFacebook'], ['whatsapp', 'siWhatsapp'],
  ['reddit', 'siReddit'], ['telegram', 'siTelegram'],
];

const head = `// Brand glyphs for the share sheet.
//
// Generated from the \`simple-icons\` package, which publishes the official
// marks under CC0. Extracted rather than imported: the package holds over
// three thousand icons and pulling the index into the bundle to use eight of
// them would cost far more than the paths themselves.
//
// Regenerate with: node tools/build-brand-icons.mjs
//
// LinkedIn is deliberately absent — simple-icons removed it after a trademark
// request, so that button keeps a text mark instead of a wrong glyph.

export interface BrandIcon {
  /** 24×24 viewBox path. */
  path: string;
  /** The brand's own colour, as published.  */
  hex: string;
}

export const BRAND: Record<string, BrandIcon> = {
`;

const body = WANT.map(([key, exp]) => {
  const icon = si[exp];
  if (!icon) throw new Error(`simple-icons kennt ${exp} nicht (mehr) — Liste prüfen`);
  return `  ${key}: { path: '${icon.path}', hex: '#${icon.hex}' },`;
}).join('\n');

writeFileSync(resolve(ROOT, 'apps/web/src/lib/brand-icons.ts'), `${head}${body}\n};\n`);
console.log(`  brand-icons.ts: ${WANT.length} Marken`);
