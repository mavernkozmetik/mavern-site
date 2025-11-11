#!/usr/bin/env bash
set -euo pipefail

URL="https://api.render.com/deploy/srv-d47l8m3e5dus73b1pkgg?key=TRqwC-yd_aU"

echo "🚀 Render deploy çağrılıyor..."
HTTP_CODE=$(curl -s -S -o /tmp/render_resp.json -w '%{http_code}' -X POST "$URL")
echo "HTTP_CODE=$HTTP_CODE"
echo "---- body ----"
cat /tmp/render_resp.json || true
echo "--------------"

if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  echo "❌ Render deploy hatası (HTTP $HTTP_CODE)"
  exit 1
fi

echo "✅ Deploy tetiklendi."
