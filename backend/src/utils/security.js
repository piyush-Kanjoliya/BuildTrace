'use strict';

const crypto = require('crypto');

/**
 * Constant-time HMAC-SHA256 verification for GitHub webhook payloads.
 *
 * @param {Buffer} rawBody   the exact raw request body bytes
 * @param {string} signature the X-Hub-Signature-256 header value ("sha256=...")
 * @param {string} secret    the project's webhook secret
 * @returns {boolean} true when the signature is valid
 */
function verifyGithubSignature(rawBody, signature, secret) {
  if (!signature || !secret || !rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Generate a random webhook/ingest secret (returned to the user once).
 */
function generateSecret(prefix = 'btwh') {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = { verifyGithubSignature, generateSecret, sha256 };
