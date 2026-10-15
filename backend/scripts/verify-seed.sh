#!/bin/bash
# Verify seeded data through the API (dev server on :5000)
set -e
API=${API:-http://localhost:5000/api/v1}

TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@buildtrace.dev","password":"BuildTrace123!"}' | jq -r '.data.token')
echo "logged in as admin: ${TOKEN:0:20}..."

echo "== projects =="
curl -s "$API/projects" -H "Authorization: Bearer $TOKEN" | jq '[.data.items[] | {name, summary}]'

echo "== dashboard (global) =="
curl -s "$API/dashboard" -H "Authorization: Bearer $TOKEN" | jq '{totals:.data.totals, byStatus:.data.incidents.byStatus, deploy:.data.deployments.byStatus, recurring:(.data.recurringIssues.groups | map({signature, count}))}'

echo "== incidents list =="
curl -s "$API/incidents?limit=5&sort=-createdAt" -H "Authorization: Bearer $TOKEN" | jq '[.data.items[] | {title, severity, status}]'

IID=$(curl -s "$API/incidents?limit=50" -H "Authorization: Bearer $TOKEN" | jq -r '.data.items[] | select(.title | startswith("Checkout latency spike in production")) | ._id')
echo "== candidates for incident $IID =="
curl -s "$API/incidents/$IID/candidates" -H "Authorization: Bearer $TOKEN" | jq '{noneFound:.data.noneFound, count:(.data.candidates|length), top:(.data.candidates[0] | {score, delta:.timeDeltaMinutes, associated:.associatedByInvestigator, exp:(.factors | map(.explanation))})}'

PID=$(curl -s "$API/projects" -H "Authorization: Bearer $TOKEN" | jq -r '.data.items[] | select(.slug=="payments-platform") | ._id')
echo "== timeline (late flags) =="
curl -s "$API/projects/$PID/timeline?limit=8" -H "Authorization: Bearer $TOKEN" | jq '[.data.items[] | {eventType, lateArrival, timestampUncertain, receiptDelayMinutes}]'

echo "== viewer cannot create (RBAC) =="
VTOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"priya@buildtrace.dev","password":"BuildTrace123!"}' | jq -r '.data.token')
# priya is developer on web-dashboard but viewer on payments-platform
CODE=$(curl -s -o /tmp/rbac.json -w '%{http_code}' -X POST $API/projects/$PID/incidents -H "Authorization: Bearer $VTOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"viewer should not create this"}')
echo "viewer create incident HTTP: $CODE $(jq -c '.error.message' /tmp/rbac.json)"

echo "== viewer can read =="
CODE2=$(curl -s -o /dev/null -w '%{http_code}' "$API/projects/$PID/incidents" -H "Authorization: Bearer $VTOKEN")
echo "viewer list incidents HTTP: $CODE2"
