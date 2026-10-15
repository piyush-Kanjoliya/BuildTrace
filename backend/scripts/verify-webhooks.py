#!/usr/bin/env python3
"""Phase G live verification: GitHub webhook hardening against the running server.

Verifies: raw-body HMAC-SHA256 signature check, delivery-id dedup, push !=
deployment, deployment_status -> deployment, header validation, ping, and that
rejections never leak the secret. Prints PASS/FAIL lines; exits 1 on failure.

Usage:  python3 backend/scripts/verify-webhooks.py   (server must be running)
"""
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request

BASE = 'http://localhost:5000/api/v1'
FAILURES = []
QUERY = ''  # optional ?projectId= fallback for repo matching


def check(name, ok, detail=''):
    print(('PASS' if ok else 'FAIL') + ' - ' + name + ((' | ' + str(detail)) if detail else ''))
    if not ok:
        FAILURES.append(name)


def request(method, path, token=None, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode())


def send_webhook(payload_bytes, headers):
    req = urllib.request.Request(BASE + '/webhooks/github' + QUERY, data=payload_bytes, method='POST')
    req.add_header('Content-Type', 'application/json')
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        return err.code, json.loads(err.read().decode())


# --- login ---
status, body = request('POST', '/auth/login', data={'email': 'admin@buildtrace.dev', 'password': 'BuildTrace123!'})
assert status == 200, body
token = body['data']['token']

# --- pick a project with a repositoryUrl ---
status, body = request('GET', '/projects?limit=100', token)
projects = body['data']['items']
project = next((p for p in projects if p.get('repositoryUrl')), None)
assert project is not None, 'No project has a repositoryUrl configured'
print('Project under test:', project['name'], '->', project['repositoryUrl'])

repo_full = project['repositoryUrl'].rstrip('/')
if '.git' in repo_full:
    repo_full = repo_full[: repo_full.index('.git')]
repo_full = repo_full.split('github.com/')[-1] if 'github.com/' in repo_full else '/'.join(repo_full.split('/')[-2:])

# --- fresh webhook secret (one-time reveal) ---
status, body = request('POST', f"/projects/{project['_id']}/integrations/webhook-secret", token)
check('rotate webhook secret', status in (200, 201) and bool(body.get('data', {}).get('secret')),
      'status=' + str(status))
secret = body['data']['secret']

# --- deployments before ---
status, body = request('GET', f"/deployments?projectId={project['_id']}&limit=1", token)
before_total = body['data']['total']
print('Deployments before:', before_total)


def sign(raw):
    return 'sha256=' + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def gh_headers(delivery, event, signature):
    return {
        'X-GitHub-Delivery': delivery,
        'X-GitHub-Event': event,
        'X-GitHub-Hook-ID': '42',
        'X-Hub-Signature-256': signature,
    }


stamp = int(time.time())

# --- 1. valid push: recorded as a commit event, NEVER a deployment ---
push_payload = {
    'ref': 'refs/heads/main',
    'repository': {'full_name': repo_full},
    'head_commit': {
        'id': 'f' * 40,
        'message': 'Phase G verification commit',
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'author': {'name': 'Phase G Bot'},
        'added': [],
        'removed': [],
        'modified': ['README.md'],
    },
    'commits': [{'id': 'f' * 40}],
    'sender': {'login': 'phase-g-bot'},
}
raw = json.dumps(push_payload).encode()
delivery = f'phaseg-{stamp}-push'
status, body = send_webhook(raw, gh_headers(delivery, 'push', sign(raw)))

# Fallback: if repo-URL matching found no project, retry scoped by projectId.
if status == 404:
    QUERY = f"?projectId={project['_id']}"
    print('NOTE: repo-URL matching returned 404; retrying with explicit ?projectId=')
    status, body = send_webhook(raw, gh_headers(delivery, 'push', sign(raw)))

data = body.get('data') or {}
check('valid push accepted (202)', status == 202, 'status=' + str(status) + ' body=' + json.dumps(body)[:200])
check('push recorded as commit event', data.get('eventType') == 'commit', data.get('eventType'))
check('push does NOT create a deployment', data.get('deploymentId') is None,
      'deploymentId=' + str(data.get('deploymentId')))

# --- 2. redelivery of the same delivery id is deduplicated ---
status, body = send_webhook(raw, gh_headers(delivery, 'push', sign(raw)))
data = body.get('data') or {}
check('redelivery deduplicated', status == 202 and data.get('duplicate') is True,
      'status=' + str(status) + ' duplicate=' + str(data.get('duplicate')))

# --- 3. invalid signature rejected, secret never leaked ---
status, body = send_webhook(raw, gh_headers(f'phaseg-{stamp}-bad', 'push', 'sha256=' + '0' * 64))
text = json.dumps(body)
check('bad signature rejected (401)', status == 401, 'status=' + str(status))
check('rejection does not leak the secret', secret not in text, text[:160])

# --- 4. missing delivery header rejected ---
headers = gh_headers(f'phaseg-{stamp}-nodelivery', 'push', sign(raw))
headers.pop('X-GitHub-Delivery')
status, body = send_webhook(raw, headers)
check('missing X-GitHub-Delivery rejected (400)', status == 400, 'status=' + str(status))

# --- 5. ping is acknowledged ---
ping_raw = json.dumps({'zen': 'Phase G says hi', 'repository': {'full_name': repo_full}}).encode()
status, body = send_webhook(ping_raw, gh_headers(f'phaseg-{stamp}-ping', 'ping', sign(ping_raw)))
check('ping acknowledged (200 pong)', status == 200 and (body.get('data') or {}).get('pong') is True,
      'status=' + str(status))

# --- 6. deployment_status produces a deployment ---
dep_payload = {
    'action': 'created',
    'deployment': {
        'id': stamp,
        'environment': 'production',
        'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(stamp - 120)),
        'url': 'https://api.github.com/deployments/' + str(stamp),
        'creator': {'login': 'phase-g-bot'},
        'sha': 'abcdef1234567890abcdef1234567890abcdef12',
    },
    'deployment_status': {
        'state': 'success',
        'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(stamp)),
        'creator': {'login': 'phase-g-bot'},
        'target_url': 'https://ci.example.com/runs/' + str(stamp),
    },
    'repository': {'full_name': repo_full},
    'sender': {'login': 'phase-g-bot'},
}
raw = json.dumps(dep_payload).encode()
status, body = send_webhook(raw, gh_headers(f'phaseg-{stamp}-dep', 'deployment_status', sign(raw)))
data = body.get('data') or {}
check('deployment_status accepted (202)', status == 202, json.dumps(body)[:200])
check('deployment_status creates a deployment', bool(data.get('deploymentId')),
      'deploymentId=' + str(data.get('deploymentId')))

# --- 7. net deployment count: +1 (push alone must add none) ---
status, body = request('GET', f"/deployments?projectId={project['_id']}&limit=1", token)
after_total = body['data']['total']
check('deployment count +1 (push alone added none)', after_total == before_total + 1,
      f'before={before_total} after={after_total}')

print()
if FAILURES:
    print(f'{len(FAILURES)} CHECK(S) FAILED: {FAILURES}')
    raise SystemExit(1)
print('ALL WEBHOOK CHECKS PASSED')
