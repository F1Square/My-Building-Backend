/**
 * Visitor flat-scope tests: list visibility + notify recipients.
 * A-102 resident sees/gets A-102 visits; B-102 must not; society pramukh is included in notify.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatVisitorFlatLabel,
  buildVisitorFlatLabels,
  visitorEntryVisibleToUser,
  visitorNotifyRecipientIds,
  resolveVisitorFlat,
  WRONG_FLAT_ERROR,
} = require('../src/utils/flatMatchHelper');

const BUILDING = {
  id: 'bldg-1',
  has_wings: true,
  wings: 'A,B,C',
};

describe('visitor flat labels — wing isolation', () => {
  it('formats self-entry label as Wing-Flat', () => {
    assert.equal(formatVisitorFlatLabel('A', '102', true), 'A-102');
    assert.equal(formatVisitorFlatLabel('B', '102', true), 'B-102');
    assert.equal(formatVisitorFlatLabel('', '102', false), '102');
  });

  it('A-102 resident labels include A-102 and never B-102', () => {
    const labels = buildVisitorFlatLabels('102', 'A');
    assert.ok(labels.includes('A-102'));
    assert.ok(!labels.includes('B-102'));
    // bare "102" must NOT be included when wing is set (prevents cross-wing leak)
    assert.ok(!labels.includes('102'));
  });

  it('B-102 resident labels include B-102 and never A-102', () => {
    const labels = buildVisitorFlatLabels('102', 'B');
    assert.ok(labels.includes('B-102'));
    assert.ok(!labels.includes('A-102'));
    assert.ok(!labels.includes('102'));
  });

  it('accepts user.flat_no already stored as Wing-Flat', () => {
    const labels = buildVisitorFlatLabels('A-102', 'A');
    assert.ok(labels.includes('A-102'));
    assert.ok(!labels.includes('B-102'));
    assert.ok(!labels.includes('A-A-102'));
  });

  it('building-wide / no wing keeps bare flat only', () => {
    assert.deepEqual(buildVisitorFlatLabels('102', 'Building-Wide'), ['102']);
    assert.deepEqual(buildVisitorFlatLabels('102', ''), ['102']);
    assert.deepEqual(buildVisitorFlatLabels('', 'A'), []);
  });

  it('trims whitespace in flat and wing', () => {
    assert.ok(buildVisitorFlatLabels(' 102 ', ' A ').includes('A-102'));
  });
});

describe('visitor entry visibility — A-102 vs B-102', () => {
  const entryA = { flat_no: 'A-102' };
  const entryB = { flat_no: 'B-102' };
  const entryC = { flat_no: 'A-103' };

  it('A-102 user can see A-102 entry', () => {
    assert.equal(visitorEntryVisibleToUser(entryA.flat_no, '102', 'A'), true);
    assert.equal(visitorEntryVisibleToUser(entryA.flat_no, 'A-102', 'A'), true);
  });

  it('B-102 user must NOT see A-102 entry', () => {
    assert.equal(visitorEntryVisibleToUser(entryA.flat_no, '102', 'B'), false);
    assert.equal(visitorEntryVisibleToUser(entryA.flat_no, 'B-102', 'B'), false);
  });

  it('A-102 user must NOT see B-102 or A-103 entries', () => {
    assert.equal(visitorEntryVisibleToUser(entryB.flat_no, '102', 'A'), false);
    assert.equal(visitorEntryVisibleToUser(entryC.flat_no, '102', 'A'), false);
  });

  it('visibility is case-insensitive for wing letter', () => {
    assert.equal(visitorEntryVisibleToUser('a-102', '102', 'A'), true);
    assert.equal(visitorEntryVisibleToUser('A-102', '102', 'a'), true);
  });

  it('empty entry flat is never visible', () => {
    assert.equal(visitorEntryVisibleToUser('', '102', 'A'), false);
    assert.equal(visitorEntryVisibleToUser(null, '102', 'A'), false);
  });

  it('filters a mixed list so only own-flat rows remain', () => {
    const rows = [entryA, entryB, entryC, { flat_no: 'A-102' }];
    const visible = rows.filter((r) => visitorEntryVisibleToUser(r.flat_no, '102', 'A'));
    assert.equal(visible.length, 2);
    assert.ok(visible.every((r) => r.flat_no === 'A-102'));
  });
});

describe('visitor notify recipients — no cross-flat notify', () => {
  const userA102 = { id: 'user-a-102', role: 'user', flat_no: '102', wing: 'A' };
  const userB102 = { id: 'user-b-102', role: 'user', flat_no: '102', wing: 'B' };
  const userA103 = { id: 'user-a-103', role: 'user', flat_no: '103', wing: 'A' };
  const pramukh = { id: 'pramukh-1', role: 'pramukh', flat_no: '501', wing: 'C' };

  it('notifies A-102 resident + society pramukh for A-102 visit', () => {
    const ids = visitorNotifyRecipientIds([userA102], [pramukh]);
    assert.ok(ids.includes('user-a-102'));
    assert.ok(ids.includes('pramukh-1'));
    assert.ok(!ids.includes('user-b-102'));
    assert.ok(!ids.includes('user-a-103'));
  });

  it('B-102 user is never a recipient for A-102 visit', () => {
    const ids = visitorNotifyRecipientIds([userA102], [pramukh]);
    assert.equal(ids.includes(userB102.id), false);
  });

  it('A-103 user is never a recipient for A-102 visit', () => {
    const ids = visitorNotifyRecipientIds([userA102], [pramukh]);
    assert.equal(ids.includes(userA103.id), false);
  });

  it('dedupes when pramukh also lives in the visited flat', () => {
    const pramukhInFlat = { id: 'user-a-102', role: 'pramukh' };
    const ids = visitorNotifyRecipientIds([userA102], [pramukhInFlat, pramukh]);
    assert.equal(ids.filter((id) => id === 'user-a-102').length, 1);
    assert.equal(ids.length, 2);
  });

  it('returns empty when nobody to notify', () => {
    assert.deepEqual(visitorNotifyRecipientIds([], []), []);
    assert.deepEqual(visitorNotifyRecipientIds(null, null), []);
  });

  it('ignores recipients without id', () => {
    const ids = visitorNotifyRecipientIds([{ name: 'x' }, userA102], [{}, pramukh]);
    assert.deepEqual(ids.sort(), ['pramukh-1', 'user-a-102']);
  });
});

describe('resolveVisitorFlat — residents scoped by wing', () => {
  function mockSupabase(users) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      in() { return chain; },
      then(onFulfilled, onRejected) {
        return Promise.resolve({ data: users, error: null }).then(onFulfilled, onRejected);
      },
    };
    return { from() { return chain; } };
  }

  it('returns only A-102 residents when wing A + flat 102', async () => {
    const dbUsers = [
      { id: 'a102', flat_no: '102', wing: 'A' },
      { id: 'b102', flat_no: '102', wing: 'B' },
    ];
    const result = await resolveVisitorFlat(mockSupabase(dbUsers), 'bldg-1', BUILDING, 'A', '102');
    assert.equal(result.error, null);
    assert.equal(result.flatLabel, 'A-102');
    assert.deepEqual(result.residents.map((r) => r.id), ['a102']);
    assert.ok(!result.residents.some((r) => r.id === 'b102'));
  });

  it('rejects missing wing when building has wings', async () => {
    const result = await resolveVisitorFlat(mockSupabase([]), 'bldg-1', BUILDING, '', '102');
    assert.equal(result.error, 'Please select a wing');
  });

  it('rejects wrong wing not in building list', async () => {
    const result = await resolveVisitorFlat(mockSupabase([]), 'bldg-1', BUILDING, 'Z', '102');
    assert.equal(result.error, WRONG_FLAT_ERROR);
  });

  it('rejects when no resident registered on that wing+flat', async () => {
    const result = await resolveVisitorFlat(mockSupabase([]), 'bldg-1', BUILDING, 'A', '999');
    assert.equal(result.error, WRONG_FLAT_ERROR);
    assert.equal(result.flatLabel, 'A-999');
  });
});

describe('end-to-end scope story — visitor to A-102', () => {
  it('A-102 user sees entry; B-102 does not; notify excludes B-102', () => {
    const storedFlat = formatVisitorFlatLabel('A', '102', true); // A-102
    assert.equal(storedFlat, 'A-102');

    assert.equal(visitorEntryVisibleToUser(storedFlat, '102', 'A'), true);
    assert.equal(visitorEntryVisibleToUser(storedFlat, '102', 'B'), false);

    const flatResidents = [{ id: 'user-a-102' }];
    const pramukhs = [{ id: 'pramukh-1' }];
    const otherFlatUsers = ['user-b-102', 'user-a-103'];
    const recipients = visitorNotifyRecipientIds(flatResidents, pramukhs);

    assert.ok(recipients.includes('user-a-102'));
    assert.ok(recipients.includes('pramukh-1'));
    for (const id of otherFlatUsers) {
      assert.equal(recipients.includes(id), false, `${id} must not be notified`);
    }
  });
});
