const supabase = require('../supabase');

/** Used when `subscription_plans` is empty or a slug is missing (safe fallback). */
const FALLBACK_PLANS = {
  monthly: {
    amount_paise: 1500,
    months: 1,
    allow_newspaper_addon: true,
    newspaper_addon_paise: 300,
    title: 'Monthly Plan',
  },
  yearly: {
    amount_paise: 18000,
    months: 12,
    allow_newspaper_addon: true,
    newspaper_addon_paise: 3600,
    title: 'Yearly Plan',
  },
  lifetime: {
    amount_paise: 150000,
    months: null,
    allow_newspaper_addon: false,
    newspaper_addon_paise: null,
    title: 'Lifetime Plan',
  },
};

function normalizeFeatures(row) {
  const f = row?.features;
  if (Array.isArray(f)) return f;
  if (f && typeof f === 'object') return Object.values(f);
  return [];
}

/**
 * @returns {Promise<import('@supabase/supabase-js').PostgrestSingleResponse<any>['data']>}
 */
async function getPlanRowFromDb(slug, { activeOnly = true } = {}) {
  let q = supabase.from('subscription_plans').select('*').eq('slug', slug);
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q.maybeSingle();
  if (error) return null;
  return data;
}

/**
 * Active plan for payments / grants. Falls back to FALLBACK_PLANS only if DB row missing.
 * @param {string} slug
 */
async function getPlanForPayment(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const row = await getPlanRowFromDb(slug, { activeOnly: true });
  if (row) {
    return {
      slug: row.slug,
      amount_paise: row.amount_paise,
      months: row.months,
      allow_newspaper_addon: !!row.allow_newspaper_addon,
      newspaper_addon_paise: row.newspaper_addon_paise,
      title: row.title,
    };
  }
  const f = FALLBACK_PLANS[slug];
  if (!f) return null;
  return { slug, ...f };
}

/** Base plan price in rupees (integer) for promo preview. */
async function getPlanRupeeBase(slug) {
  const p = await getPlanForPayment(slug);
  if (!p) return 0;
  return Math.max(0, Math.round(p.amount_paise / 100));
}

async function listPublicPlans() {
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error || !data?.length) {
    return Object.entries(FALLBACK_PLANS).map(([slug, v], i) => ({
      id: slug,
      slug,
      title: v.title,
      description: '',
      amount_paise: v.amount_paise,
      months: v.months,
      allow_newspaper_addon: v.allow_newspaper_addon,
      newspaper_addon_paise: v.newspaper_addon_paise,
      sort_order: i + 1,
      features: [
        'Full access to all modules',
        'Maintenance billing & payments',
        'Visitor management',
        'Complaints & announcements',
      ],
    }));
  }

  const defaults = [
    'Full access to all modules',
    'Maintenance billing & payments',
    'Visitor management',
    'Complaints & announcements',
  ];

  return data.map((row) => {
    const features = normalizeFeatures(row);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description || '',
      amount_paise: row.amount_paise,
      months: row.months,
      allow_newspaper_addon: !!row.allow_newspaper_addon,
      newspaper_addon_paise: row.newspaper_addon_paise,
      sort_order: row.sort_order,
      features: features.length ? features : defaults,
    };
  });
}

module.exports = {
  FALLBACK_PLANS,
  getPlanRowFromDb,
  getPlanForPayment,
  getPlanRupeeBase,
  listPublicPlans,
};
