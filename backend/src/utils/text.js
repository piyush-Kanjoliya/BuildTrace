'use strict';

/**
 * Normalize an incident title into a stable "error signature" used for
 * recurring-issue detection.
 *
 * Rule (documented in docs/architecture.md):
 *  - lowercase
 *  - replace every number with "#" (removes ids, ports, durations, counts)
 *  - strip anything that is not a letter, digit-placeholder, or space
 *  - collapse whitespace, take the first 12 tokens
 *
 * Two incidents with equal signatures in the same project are considered
 * "recurring". This is a transparent, deterministic rule - not a claim
 * of statistical similarity.
 */
function normalizeSignature(title) {
  if (!title) return 'untitled';
  const sig = String(title)
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/[^a-z#\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .join(' ');
  return sig || 'untitled';
}

/**
 * Extract lowercase word tokens (>= 4 chars) for lightweight text matching
 * between incident descriptions and commit messages.
 */
function keywords(text, minLength = 4) {
  if (!text) return [];
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'error', 'issue', 'after', 'when', 'into', 'have', 'http', 'https', 'null']);
  return Array.from(
    new Set(
      String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= minLength && !stop.has(w))
    )
  );
}

module.exports = { normalizeSignature, keywords };
