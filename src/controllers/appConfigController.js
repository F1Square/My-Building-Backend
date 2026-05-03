const supabase = require('../supabase');

exports.getAppConfig = async (req, res) => {
  try {
    // Try to fetch from a 'settings' or 'app_config' table
    const { data, error } = await supabase
      .from('app_config')
      .select('key, value');

    if (error) {
      console.log('Using hardcoded fallback for app config:', error.message);
      return res.json({
        version: '1.13.0',
        maintenance_mode: false,
        maintenance_message: 'Our services are currently under maintenance.'
      });
    }

    const config = {};
    data.forEach(item => {
      config[item.key] = item.value;
    });

    res.json({
      version: config.app_version || '1.13.0',
      maintenance_mode: config.maintenance_mode === 'true',
      maintenance_message: config.maintenance_message || 'Our services are currently under maintenance.'
    });
  } catch (err) {
    res.json({
      version: '1.13.0',
      maintenance_mode: false,
      maintenance_message: 'Our services are currently under maintenance.'
    });
  }
};
