#!/usr/bin/env bash
# REST API walkthrough with curl. Requires: ATLASGUARD_BASE_URL (…/api/v1), ATLASGUARD_API_KEY, ATLASGUARD_PROJECT_ID.
set -euo pipefail
: "${ATLASGUARD_BASE_URL:?}" "${ATLASGUARD_API_KEY:?}" "${ATLASGUARD_PROJECT_ID:?}"
AUTH=(-H "Authorization: Bearer ${ATLASGUARD_API_KEY}")
BASE="${ATLASGUARD_BASE_URL%/}"

echo "Model status:"
curl -sS "${BASE}/model/status" | head -c 400; echo

SUITE_ID=$(curl -sS "${BASE}/benchmarks?search=nigerian-context-v1" "${AUTH[@]}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data[0].id')
echo "Suite: ${SUITE_ID}"

RUN_ID=$(curl -sS -X POST "${BASE}/evaluations/runs" "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"projectId\":\"${ATLASGUARD_PROJECT_ID}\",\"suiteId\":\"${SUITE_ID}\",\"languages\":[\"en-NG\",\"yo\"],\"categories\":[\"civic_information\"]}" \
  | node -pe 'const b=JSON.parse(require("fs").readFileSync(0)); if(!b.success){console.error(b.error);process.exit(1)} b.data.id')
echo "Run: ${RUN_ID}"

while true; do
  STATUS=$(curl -sS "${BASE}/evaluations/runs/${RUN_ID}" "${AUTH[@]}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.status')
  echo "  ${STATUS}"
  case "${STATUS}" in COMPLETED|FAILED|CANCELLED) break;; esac
  sleep 3
done

curl -sS "${BASE}/reports/${RUN_ID}/export?format=csv" "${AUTH[@]}" -o "atlasguard-${RUN_ID}.csv"
echo "Saved atlasguard-${RUN_ID}.csv"
