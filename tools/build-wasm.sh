#!/usr/bin/env bash
# Build the engine for the browser.
#
# Target "web" rather than "bundler": the bundler target makes webpack parse the
# .wasm itself, and its parser does not understand everything LLVM emits today.
# With the web target the glue fetches the module at runtime from /engine/, which
# also means the bundle stays small and the engine can be cached separately.
set -euo pipefail
cd "$(dirname "$0")/.."
GLUE=apps/web/src/wasm
ASSET=apps/web/public/engine

cargo build --release --target wasm32-unknown-unknown -p hh-wasm --manifest-path rust/Cargo.toml
mkdir -p "$GLUE" "$ASSET"
wasm-bindgen \
  --target web \
  --out-dir "$GLUE" \
  --out-name hh_wasm \
  rust/target/wasm32-unknown-unknown/release/hh_wasm.wasm

mv "$GLUE/hh_wasm_bg.wasm" "$ASSET/hh_wasm_bg.wasm"
rm -f "$GLUE/hh_wasm_bg.wasm.d.ts"

# The generated glue defaults to `new URL('hh_wasm_bg.wasm', import.meta.url)`,
# which webpack resolves at build time and then cannot find. We always pass the
# public path explicitly, so replace the default with that path.
python3 - "$GLUE/hh_wasm.js" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "module_or_path = new URL('hh_wasm_bg.wasm', import.meta.url);"
if needle not in s:
    raise SystemExit("wasm-bindgen glue changed shape; update tools/build-wasm.sh")
open(p, 'w').write(s.replace(needle, "module_or_path = '/engine/hh_wasm_bg.wasm';"))
PY

if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Os -o "$ASSET/hh_wasm_bg.wasm" "$ASSET/hh_wasm_bg.wasm"
  echo "wasm-opt applied"
fi
# The engine is served with a long cache lifetime, so its URL has to change
# when its contents do — otherwise a rebuilt engine keeps loading from cache
# against a freshly generated glue and every new binding is missing.
HASH=$(shasum -a 256 "$ASSET/hh_wasm_bg.wasm" | cut -c1-12)
printf '{ "hash": "%s" }\n' "$HASH" > "$ASSET/engine.json"
python3 - "$GLUE/hh_wasm.js" "$HASH" <<'PY'
import sys
path, digest = sys.argv[1], sys.argv[2]
s = open(path).read()
needle = "module_or_path = '/engine/hh_wasm_bg.wasm"
if needle not in s:
    raise SystemExit('wasm-bindgen glue changed shape; update tools/build-wasm.sh')
import re
s = re.sub(r"module_or_path = '/engine/hh_wasm_bg\.wasm[^']*'",
           "module_or_path = '/engine/hh_wasm_bg.wasm?v=%s'" % digest, s)
open(path, 'w').write(s)
PY

echo "engine: $(du -h "$ASSET/hh_wasm_bg.wasm" | cut -f1), Version $HASH"
