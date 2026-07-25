const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isDbUserId,
  isTokenVersionValid,
  nextTokenVersion,
} = require('../src/middleware/auth');

describe('auth session invalidation helpers', () => {
  it('treats only UUID user ids as database-backed sessions', () => {
    assert.equal(isDbUserId('550e8400-e29b-41d4-a716-446655440000'), true);
    assert.equal(isDbUserId('admin'), false);
    assert.equal(isDbUserId('watchman'), false);
    assert.equal(isDbUserId(null), false);
  });

  it('accepts matching token versions including missing-as-zero', () => {
    assert.equal(isTokenVersionValid(0, 0), true);
    assert.equal(isTokenVersionValid(undefined, 0), true);
    assert.equal(isTokenVersionValid(2, 2), true);
    assert.equal(isTokenVersionValid('3', 3), true);
  });

  it('rejects tokens after a password-reset version bump', () => {
    // Device A logged in at tv=0; user resets password → DB becomes 1
    assert.equal(isTokenVersionValid(0, 1), false);
    assert.equal(isTokenVersionValid(undefined, 1), false);
    assert.equal(isTokenVersionValid(1, 2), false);
  });

  it('increments token version for password reset', () => {
    assert.equal(nextTokenVersion(undefined), 1);
    assert.equal(nextTokenVersion(0), 1);
    assert.equal(nextTokenVersion(4), 5);
  });
});
