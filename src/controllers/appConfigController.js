const supabase = require('../supabase');

const DEFAULT_CONFIG = Object.freeze({
  version: '1.14.1',
  maintenance_mode: false,
  maintenance_message: 'Our services are currently under maintenance.',
});
const ALLOWED_KEYS = new Set(['app_version', 'maintenance_mode', 'maintenance_message']);
const CACHE_TTL_MS = 30 * 1000;
let configCache = null;
let cacheExpiry = 0;

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
};

const normalizeConfig = (config = {}) => ({
  version: String(config.app_version || DEFAULT_CONFIG.version),
  maintenance_mode: normalizeBoolean(config.maintenance_mode),
  maintenance_message: config.maintenance_message || DEFAULT_CONFIG.maintenance_message,
});

exports.getAppConfig = async (req, res) => {
  try {
    if (configCache && Date.now() < cacheExpiry) {
      return res.json(configCache);
    }

    // Try to fetch from a 'settings' or 'app_config' table
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value');

    if (error) {
      console.log('Using hardcoded fallback for app config:', error.message);
      return res.json(DEFAULT_CONFIG);
    }

    const config = {};
    data.forEach((item) => {
      config[item.key] = item.value;
    });
    const normalized = normalizeConfig(config);
    configCache = normalized;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    res.json(normalized);
  } catch (err) {
    res.json(DEFAULT_CONFIG);
  }
};

exports.updateAppConfig = async (req, res) => {
  const { key, value } = req.body || {};

  if (!key || value === undefined) {
    return res.status(422).json({ error: 'Key and value are required' });
  }

  if (!ALLOWED_KEYS.has(key)) {
    return res.status(422).json({ error: 'Unsupported config key' });
  }

  try {
    const { error } = await supabase
      .from('app_config')
      .upsert({ key, value }, { onConflict: 'key' });

    if (error) throw error;

    configCache = null;
    cacheExpiry = 0;
    res.json({ message: `Updated ${key} successfully` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};
