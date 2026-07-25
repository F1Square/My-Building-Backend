/**
 * Wing bank details — settlement routing helpers.
 * Buildings always have named wings; A-102 → Wing A bank only.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeBankWing,
  pickBankDetailsForWing,
} = require('../src/utils/validators');

describe('normalizeBankWing', () => {
  it('keeps named wings trimmed', () => {
    assert.equal(normalizeBankWing('A'), 'A');
    assert.equal(normalizeBankWing(' B '), 'B');
  });

  it('returns empty string when wing missing', () => {
    assert.equal(normalizeBankWing(''), '');
    assert.equal(normalizeBankWing(null), '');
    assert.equal(normalizeBankWing(undefined), '');
  });
});

describe('pickBankDetailsForWing — A vs B isolation', () => {
  const rows = [
    { wing: 'A', bank_account: '111', razorpay_account_id: 'merch-A' },
    { wing: 'B', bank_account: '222', razorpay_account_id: 'merch-B' },
  ];

  it('A-102 style wing A picks A bank only', () => {
    const bank = pickBankDetailsForWing(rows, 'A');
    assert.equal(bank.bank_account, '111');
    assert.equal(bank.razorpay_account_id, 'merch-A');
  });

  it('B-902 style wing B picks B bank only', () => {
    const bank = pickBankDetailsForWing(rows, 'B');
    assert.equal(bank.bank_account, '222');
    assert.equal(bank.razorpay_account_id, 'merch-B');
  });

  it('does not cross-pick A when asking for B', () => {
    assert.notEqual(pickBankDetailsForWing(rows, 'B').bank_account, '111');
  });

  it('returns null when that wing has no bank row', () => {
    assert.equal(pickBankDetailsForWing(rows, 'C'), null);
    assert.equal(pickBankDetailsForWing([], 'A'), null);
    assert.equal(pickBankDetailsForWing(rows, ''), null);
  });
});
