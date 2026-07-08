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
  parseBuildingWings,
  formatVisitorFlatLabel,
  resolveVisitorFlat,
};
