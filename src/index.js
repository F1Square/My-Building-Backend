require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('./supabase');

const app = express();
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

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 My Building API running on port ${PORT}`);
  await verifyDbConnection();
});
