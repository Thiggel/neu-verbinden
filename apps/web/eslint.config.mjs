// ESLint for the web app.
//
// The repo carried thirteen `eslint-disable` comments and a `lint` script for a
// linter that was never installed: `next lint` dropped into its interactive
// setup wizard and exited non-zero. A check that cannot run checks nothing, and
// the disable comments were silently decorative.
//
// Driven through the ESLint CLI rather than `next lint`, which is deprecated
// and disappears in Next 16.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: ['.next/**', '.next-build/**', 'node_modules/**', 'src/wasm/**', 'public/**'] },
  ...compat.extends('next/core-web-vitals'),
];

export default config;
