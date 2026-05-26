import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IncomingMessage } from 'node:http';
import { resolveOperatorIdentity } from '../src/operatorIdentity.ts';

function createRequest(headers: Record<string, string | string[] | undefined>): IncomingMessage {
  return { headers } as IncomingMessage;
}

test('resolves identity from trusted headers in precedence order', () => {
  const identity = resolveOperatorIdentity(
    createRequest({
      'x-user-email': 'user@example.com',
      'x-operator-email': 'ops@example.com'
    })
  );

  assert.equal(identity.decidedBy, 'ops@example.com');
  assert.equal(identity.source, 'trusted_header');
});

test('trusted header wins over MERLIN_OPERATOR_ID env fallback', () => {
  const previous = process.env.MERLIN_OPERATOR_ID;
  process.env.MERLIN_OPERATOR_ID = 'env-operator';
  try {
    const identity = resolveOperatorIdentity(
      createRequest({
        'x-user-id': 'header-operator'
      })
    );
    assert.equal(identity.decidedBy, 'header-operator');
    assert.equal(identity.source, 'trusted_header');
  } finally {
    process.env.MERLIN_OPERATOR_ID = previous;
  }
});

test('resolves identity from MERLIN_OPERATOR_ID when trusted headers are absent', () => {
  const previous = process.env.MERLIN_OPERATOR_ID;
  process.env.MERLIN_OPERATOR_ID = 'env-operator';
  try {
    const identity = resolveOperatorIdentity(createRequest({}));
    assert.equal(identity.decidedBy, 'env-operator');
    assert.equal(identity.source, 'env');
  } finally {
    process.env.MERLIN_OPERATOR_ID = previous;
  }
});

test('falls back to unknown when no trusted headers or env identity exist', () => {
  const previous = process.env.MERLIN_OPERATOR_ID;
  process.env.MERLIN_OPERATOR_ID = '';
  try {
    const identity = resolveOperatorIdentity(createRequest({}));
    assert.equal(identity.decidedBy, 'unknown');
    assert.equal(identity.source, 'unknown');
  } finally {
    process.env.MERLIN_OPERATOR_ID = previous;
  }
});
