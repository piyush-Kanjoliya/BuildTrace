'use strict';

const env = require('../config/env');

/**
 * Event-time helpers. Every ingested event distinguishes:
 *  - occurredAt: when the event actually happened (may be unknown/untrusted)
 *  - receivedAt: when BuildTrace received it
 */

/**
 * Resolve a trustworthy occurrence timestamp from an external payload.
 * Returns { occurredAt, occurredAtSource } where source is:
 *   - 'payload'  the source supplied a reliable timestamp
 *   - 'receipt'  no reliable timestamp: we record receipt time and flag uncertainty
 */
function resolveOccurredAt(input, now = new Date()) {
  const raw = input.occurredAt;
  if (raw) {
    const parsed = raw instanceof Date ? raw : new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      // Timestamps far in the future are not trustworthy
      if (parsed.getTime() > now.getTime() + 5 * 60 * 1000) {
        return { occurredAt: now, occurredAtSource: 'receipt' };
      }
      return { occurredAt: parsed, occurredAtSource: 'payload' };
    }
  }
  return { occurredAt: now, occurredAtSource: 'receipt' };
}

/**
 * An event is "late-arriving" when it is received significantly after it occurred.
 */
function isLateArrival(occurredAt, receivedAt) {
  const thresholdMs = env.events.lateThresholdMinutes * 60 * 1000;
  return receivedAt.getTime() - occurredAt.getTime() > thresholdMs;
}

function minutesBetween(earlier, later) {
  return Math.round(((later.getTime() - earlier.getTime()) / 60000) * 10) / 10;
}

module.exports = { resolveOccurredAt, isLateArrival, minutesBetween };
