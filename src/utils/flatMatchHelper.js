const WRONG_FLAT_ERROR = 'Wrong flat number. Please select the correct wing and flat number.';

function normalizeToken(value) {
  return String(value || '').trim();
}

function normalizeWing(value) {
  return normalizeToken(value).toLowerCase();
}

function parseBuildingWings(building) {
  if (!building?.has_wings || !building?.wings) return [];
  return String(building.wings)
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean);
}

function formatVisitorFlatLabel(wing, flatNo, hasWings) {
  const flat = normalizeToken(flatNo);
  if (!flat) return '';
  if (hasWings) {
    const w = normalizeToken(wing);
    return w ? `${w}-${flat}` : flat;
  }
  return flat;
}

function isBuildingWideWing(wing) {
  const w = normalizeWing(wing);
  return !w || w === 'building-wide';
}

/**
 * Flat labels this resident may match on visitors.flat_no.
 * With wing A + flat 102 → ["A-102"] (not bare "102", so B-102 never matches A-102).
 * Without wing → [flat] as stored.
 */
function buildVisitorFlatLabels(flat, wing) {
  flat = normalizeToken(flat);
  wing = normalizeToken(wing);
  if (!flat) return [];

  const labels = new Set();

  if (wing && !isBuildingWideWing(wing)) {
    let flatNum = flat;
    const dash = flat.lastIndexOf('-');
    if (dash > 0) {
      const maybeWing = flat.slice(0, dash);
      const maybeNum = flat.slice(dash + 1).trim();
      if (maybeNum && normalizeWing(maybeWing) === normalizeWing(wing)) {
        flatNum = maybeNum;
        labels.add(flat);
      }
    }
    labels.add(formatVisitorFlatLabel(wing, flatNum, true));
  } else {
    labels.add(flat);
  }

  return [...labels];
}

/** True if this visitor row belongs to the resident's wing+flat (case-insensitive). */
function visitorEntryVisibleToUser(entryFlatNo, userFlat, userWing) {
  const entry = normalizeToken(entryFlatNo).toLowerCase();
  if (!entry) return false;
  return buildVisitorFlatLabels(userFlat, userWing).some(
    (label) => normalizeToken(label).toLowerCase() === entry,
  );
}

/**
 * Who gets visitor push/in-app notify: target-flat residents + society pramukhs.
 * Other flat users (e.g. B-102 when visit is A-102) are never included.
 */
function visitorNotifyRecipientIds(flatResidents, buildingPramukhs) {
  const ids = new Set();
  for (const r of flatResidents || []) {
    if (r?.id) ids.add(r.id);
  }
  for (const p of buildingPramukhs || []) {
    if (p?.id) ids.add(p.id);
  }
  return [...ids];
}

/**
 * Strict wing + flat validation against registered residents.
 * Returns { residents, error, flatLabel }.
 */
async function resolveVisitorFlat(supabase, building_id, building, wing, flatNo) {
  const flat = normalizeToken(flatNo);
  if (!flat) {
    return { residents: [], error: 'Flat number is required', flatLabel: '' };
  }

  const hasWings = !!building?.has_wings;
  const wingInput = normalizeToken(wing);

  if (hasWings) {
    const allowedWings = parseBuildingWings(building);
    if (!wingInput) {
      return { residents: [], error: 'Please select a wing', flatLabel: '' };
    }
    const wingValid = allowedWings.some((w) => normalizeWing(w) === normalizeWing(wingInput));
    if (!wingValid) {
      return { residents: [], error: WRONG_FLAT_ERROR, flatLabel: '' };
    }
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, name, flat_no, wing, expo_push_token')
    .eq('building_id', building_id)
    .eq('status', 'approved')
    .in('role', ['user', 'pramukh'])
    .eq('flat_no', flat);

  if (error) {
    console.error('resolveVisitorFlat error:', error.message);
    return { residents: [], error: error.message, flatLabel: '' };
  }

  let residents = data || [];

  if (hasWings) {
    residents = residents.filter((u) => normalizeWing(u.wing) === normalizeWing(wingInput));
  } else {
    residents = residents.filter((u) => isBuildingWideWing(u.wing));
  }

  const flatLabel = formatVisitorFlatLabel(wingInput, flat, hasWings);

  if (residents.length === 0) {
    return { residents: [], error: WRONG_FLAT_ERROR, flatLabel };
  }

  return { residents, error: null, flatLabel };
}

module.exports = {
  WRONG_FLAT_ERROR,
  normalizeToken,
  normalizeWing,
  parseBuildingWings,
  formatVisitorFlatLabel,
  isBuildingWideWing,
  buildVisitorFlatLabels,
  visitorEntryVisibleToUser,
  visitorNotifyRecipientIds,
  resolveVisitorFlat,
};
