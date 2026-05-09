// Always load base .env first, then overlay .env.development when in dev mode.
// This means .env.development only needs the keys that differ from production.
require('dotenv').config();
if (process.env.NODE_ENV === 'development') {
  require('dotenv').config({ path: '.env.development', override: true });
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('./supabase');

// Validate required environment variables
function validateEnvironmentVariables() {
  const requiredVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'JWT_SECRET',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
  }
  
  console.log('✅ All required environment variables are present');
}

// Validate environment variables on startup
validateEnvironmentVariables();

const app = express();

// Trust the first proxy hop. Required for Vercel / Render / any reverse-proxy
// deployment so that req.protocol returns the correct https scheme (instead
// of the internal http) and req.ip returns the real client IP from
// X-Forwarded-For. Without this, payment-callback redirect URLs end up with
// the wrong scheme and Easebuzz refuses or falls back to env.
app.set('trust proxy', true);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

app.use('/api', require('./routes'));
app.use('/entry', require('./routes/entry'));

// Serve visitor-web static site
app.use('/visitor', express.static(path.join(__dirname, '../../visitor-web')));

app.get('/health', (_, res) => res.json({ status: 'ok', app: 'My Building API' }));

const PORT = process.env.PORT || 5000;

async function verifyDbConnection() {
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) {
      console.error('❌ Database connection FAILED:', error.message);
    } else {
      console.log('✅ Database connected successfully (Supabase)');
    }
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
  }
}

const { startScheduler } = require('./utils/scheduler');

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 My Building API running on port ${PORT}`);
  await verifyDbConnection();
  startScheduler();
});
