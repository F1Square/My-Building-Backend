const cloudinary = require('cloudinary').v2;

/**
 * Initialize Cloudinary with environment variables
 * Validates that all required credentials are present
 */
function initializeCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

  // Validate credentials
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    const missingVars = [];
    if (!CLOUDINARY_CLOUD_NAME) missingVars.push('CLOUDINARY_CLOUD_NAME');
    if (!CLOUDINARY_API_KEY) missingVars.push('CLOUDINARY_API_KEY');
    if (!CLOUDINARY_API_SECRET) missingVars.push('CLOUDINARY_API_SECRET');
    
    throw new Error(`Missing Cloudinary credentials: ${missingVars.join(', ')}`);
  }

  // Configure Cloudinary
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });

  console.log('✅ Cloudinary service initialized successfully');
  return cloudinary;
}

// Initialize on module load
try {
  initializeCloudinary();
} catch (error) {
  console.error('❌ Cloudinary initialization failed:', error.message);
  throw error;
}

module.exports = cloudinary;