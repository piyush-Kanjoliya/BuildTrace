#!/bin/bash
# BuildTrace end-to-end smoke test of the core workflow.
# Requires: a dev server running on :5000 and `jq` installed.
set -e
API=${API:-http://localhost:5000/api/v1}
TS=$(date +%s)
EMAIL="smoke-$TS@test.dev"

echo "== register (self-service -> developer role) =="
REG=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Tester\",\"email\":\"$EMAIL\",\"password\":\"Password123!\"}")
TOKEN=$(echo "$REG" | jq -r '.data.token')
echo "token: ${TOKEN:0:24}..."

echo "== create project =="
PROJ=$(curl -s -X POST $API/projects -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Project $TS\",\"description\":\"smoke\",\"repositoryUrl\":\"https://github.com/smoke/proj-$TS\",\"environments\":[\"production\",\"staging\"]}")
PID=$(echo "$PROJ" | jq -r '.data.project._id')
echo "project: $PID"

echo "== create deployment =="
DEP=$(curl -s -X POST $API/projects/$PID/deployments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"version":"v1.2.3","commitSha":"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2","environment":"production","service":"payments-api","commitMessage":"Fix checkout timeout retry logic","changedFiles":["src/checkout.js","src/retry.js"]}')
DEPID=$(echo "$DEP" | jq -r '.data._id')
echo "deployment: $DEPID status=$(echo "$DEP" | jq -r '.data.status')"

echo "== create incident =="
INC=$(curl -s -X POST $API/projects/$PID/incidents -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Checkout timeout errors spike","description":"Users report checkout timeouts after deploy","severity":"SEV2","environment":"production","affectedService":"payments-api"}')
IID=$(echo "$INC" | jq -r '.data._id')
IVER=$(echo "$INC" | jq -r '.data.version')
echo "incident: $IID version=$IVER"

echo "== candidates (correlation engine) =="
CAND=$(curl -s $API/incidents/$IID/candidates -H "Authorization: Bearer $TOKEN")
echo "candidate count: $(echo "$CAND" | jq '.data.candidates | length') top score: $(echo "$CAND" | jq -r '.data.candidates[0].score')"
echo "top factor: $(echo "$CAND" | jq -r '.data.candidates[0].factors[0].explanation')"

echo "== timeline =="
curl -s "$API/projects/$PID/timeline" -H "Authorization: Bearer $TOKEN" | jq '{total:.data.total, types:(.data.items | map(.eventType))}'

echo "== update incident -> investigating =="
UPD=$(curl -s -X PATCH $API/incidents/$IID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"version\":$IVER,\"status\":\"investigating\"}")
echo "new version: $(echo "$UPD" | jq -r '.data.version') status: $(echo "$UPD" | jq -r '.data.status')"

echo "== stale update must 409 =="
STALE=$(curl -s -o /tmp/stale.json -w '%{http_code}' -X PATCH $API/incidents/$IID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"version\":$IVER,\"severity\":\"SEV1\"}")
echo "stale update HTTP: $STALE $(jq -c '.error.details' /tmp/stale.json)"

echo "== resolve without resolution must 422 =="
RES422=$(curl -s -o /tmp/res.json -w '%{http_code}' -X PATCH $API/incidents/$IID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"version\":$(echo "$UPD" | jq -r '.data.version'),\"status\":\"resolved\"}")
echo "HTTP: $RES422 $(jq -c '.error.message' /tmp/res.json)"

echo "== resolve with resolution =="
RESOLVED=$(curl -s -X PATCH $API/incidents/$IID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"version\":$(echo "$UPD" | jq -r '.data.version'),\"status\":\"resolved\",\"resolution\":\"Rolled back v1.2.3\",\"rootCause\":\"Retry storm exhausted the connection pool\"}")
echo "status: $(echo "$RESOLVED" | jq -r '.data.status') resolvedAt: $(echo "$RESOLVED" | jq -r '.data.resolvedAt')"

echo "== ingest late event (40 min ago) with idempotency key =="
LATE_OCC=$(node -e "console.log(new Date(Date.now()-40*60000).toISOString())")
EV1=$(curl -s -X POST $API/events -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PID\",\"eventType\":\"deployment\",\"idempotencyKey\":\"late-deploy-1\",\"occurredAt\":\"$LATE_OCC\",\"deployment\":{\"version\":\"v1.2.2\",\"commitSha\":\"ffff1111aaaa2222bbbb3333cccc4444dddd5555\",\"environment\":\"production\",\"status\":\"success\",\"service\":\"payments-api\"}}")
echo "first: duplicate=$(echo "$EV1" | jq -r '.data.duplicate') processingStatus=$(echo "$EV1" | jq -r '.data.processingStatus')"

echo "== duplicate delivery of same event =="
EV2=$(curl -s -X POST $API/events -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PID\",\"eventType\":\"deployment\",\"idempotencyKey\":\"late-deploy-1\",\"occurredAt\":\"$LATE_OCC\",\"deployment\":{\"version\":\"v1.2.2\",\"commitSha\":\"ffff1111aaaa2222bbbb3333cccc4444dddd5555\",\"environment\":\"production\",\"status\":\"success\"}}")
echo "second: duplicate=$(echo "$EV2" | jq -r '.data.duplicate')"

echo "== event without timestamp is flagged uncertain =="
EV3=$(curl -s -X POST $API/events -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PID\",\"eventType\":\"config_change\",\"payload\":{\"note\":\"toggled feature flag\"}}")
echo "occurredAtSource=$(echo "$EV3" | jq -r '.data.event.occurredAtSource') uncertain=$(echo "$EV3" | jq -r '.data.event.timestampUncertain')"

echo "== dashboard (real aggregations) =="
curl -s "$API/dashboard?projectId=$PID" -H "Authorization: Bearer $TOKEN" | jq '{open:.data.totals.openIncidents, bySeverity:.data.incidents.bySeverity, deployByStatus:.data.deployments.byStatus, timelineEvents:.data.recentActivity | length}'

echo "== authorization: no token must 401 =="
NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' $API/projects)
echo "no-token projects list: $NOAUTH"

echo "SMOKE TEST COMPLETE"
