const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePaymentMethods,
  validateSocietyInquiryFields,
  validateSocietyLogo,
  isValidStateCity,
} = require('../src/utils/societyInquiryValidation');

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('societyInquiryValidation', () => {
  it('normalizes multi-select payment methods', () => {
    const result = normalizePaymentMethods({ payment_methods: ['Online', 'Cash', 'Online'] });
    assert.equal(result.ok, true);
    assert.equal(result.value, 'Online, Cash');
  });

  it('rejects empty and invalid payment methods', () => {
    assert.equal(normalizePaymentMethods({ payment_methods: [] }).ok, false);
    assert.equal(normalizePaymentMethods({ payment_methods: ['Bitcoin'] }).ok, false);
  });

  it('maps legacy payment gateway labels to Online', () => {
    const result = normalizePaymentMethods({ payment_method: 'Payment Gateway' });
    assert.equal(result.ok, true);
    assert.equal(result.value, 'Online');
  });

  it('requires a valid image logo, location, and address containing letters', () => {
    assert.equal(validateSocietyLogo(null).ok, false);
    assert.equal(validateSocietyLogo(TINY_PNG).ok, true);
    assert.equal(validateSocietyLogo('data:image/jpeg;base64,/9j/AAAA').ok, true);
    assert.equal(validateSocietyLogo('data:text/plain;base64,AAAA').ok, false);
    assert.equal(isValidStateCity('Gujarat', 'Surat'), true);
    assert.equal(isValidStateCity('Maharashtra', 'Surat'), false);

    const valid = {
      society_name: 'Test',
      society_type: 'Apartment Complex',
      total_wings: 2,
      pincode: '395007',
      state: 'Gujarat',
      city: 'Surat',
      address: '395 Ring Road',
      society_logo: TINY_PNG,
      payment_methods: ['Cash'],
    };
    assert.equal(validateSocietyInquiryFields(valid), null);
    assert.match(
      validateSocietyInquiryFields({ ...valid, address: '123456' }),
      /cannot contain only numbers/i,
    );
    assert.match(
      validateSocietyInquiryFields({ ...valid, society_logo: undefined }),
      /logo/i,
    );
  });
});
