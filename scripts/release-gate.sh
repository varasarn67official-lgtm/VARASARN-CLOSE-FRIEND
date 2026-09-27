#!/usr/bin/env bash
set -euo pipefail
npm test
npm run build
neon config status

npm run preview -- --port 4174 --strictPort &
preview_pid=$!
trap 'kill "$preview_pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 20); do
  if curl -sf http://localhost:4174/ > /dev/null; then break; fi
  sleep 0.5
done
html=$(curl -sf http://localhost:4174/) || { echo "Production-like build did not respond"; exit 1; }
script_src=$(echo "$html" | grep -oE 'src="/assets/[^"]+\.js"' | head -1 | sed -E 's/src="(.*)"/\1/')
[ -n "$script_src" ] || { echo "Production-like build's index.html has no bundled script tag"; exit 1; }
curl -sf "http://localhost:4174${script_src}" > /dev/null || { echo "Production-like build's bundled script did not load"; exit 1; }
kill "$preview_pid" 2>/dev/null || true
trap - EXIT
echo "Production-like build boots and serves its bundle. Follow up with 'npm run preview' in a browser to confirm the sign-in screen renders with no console errors."

echo "Automated checks passed. Complete docs/cutover-record.md with fresh-export counts, restore evidence, two-account permission checks, deployed Google sign-in, and idle-resume acceptance before production cutover."
exit 1
