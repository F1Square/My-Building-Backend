const cloudinary = require('../services/cloudinaryService');

/**
 * Generate an optimized Cloudinary URL
 * @param {string} publicId - Cloudinary public ID
 * @param {Object} options - Transformation options
 * @param {number} [options.width] - Target width in pixels
 * @param {number} [options.height] - Target height in pixels
 * @param {string} [options.crop] - Crop mode (fill, fit, scale, etc.)
 * @param {string} [options.gravity] - Gravity for cropping (face, center, etc.)
 * @param {number|string} [options.quality] - Quality (1-100) or 'auto'
 * @param {string} [options.format] - Format (jpg, png, webp) or 'auto'
 * @param {string} [options.context] - Context for device-specific optimizations (mobile, web, thumbnail)
 * @returns {string} Optimized Cloudinary URL
 */
function generateImageUrl(publicId, options = {}) {
  if (!publicId) {
    throw new Error('Public ID is required');
  }

  // Build transformation array
  const transformations = [];

  // Always include automatic optimizations
  transformations.push('f_auto'); // Automatic format optimization
  transformations.push('q_auto'); // Automatic quality optimization

  // Apply context-specific defaults
  if (options.context === 'thumbnail') {
    if (!options.width) options.width = 200;
    if (!options.height) options.height = 200;
    if (!options.crop) options.crop = 'fill';
    if (!options.gravity) options.gravity = 'face';
  } else if (options.context === 'mobile' && !options.width) {
    options.width = 800; // Mobile default width
  } else if (options.context === 'web' && !options.width) {
    options.width = 1200; // Web default width
  }

  // Add specified transformations
  if (options.width) transformations.push(`w_${options.width}`);
  if (options.height) transformations.push(`h_${options.height}`);
  if (options.crop) transformations.push(`c_${options.crop}`);
  if (options.gravity) transformations.push(`g_${options.gravity}`);
  if (options.quality && options.quality !== 'auto') transformations.push(`q_${options.quality}`);
  if (options.format && options.format !== 'auto') transformations.push(`f_${options.format}`);

  // Generate URL using Cloudinary SDK
  return cloudinary.url(publicId, {
    transformation: transformations.join(','),
    secure: true
  });
}

/**
 * Generate a thumbnail URL
 * @param {string} publicId - Cloudinary public ID
 * @param {number} [size=200] - Thumbnail size in pixels
 * @returns {string} Thumbnail URL
 */
function generateThumbnailUrl(publicId, size = 200) {
  return generateImageUrl(publicId, {
    width: size,
    height: size,
    crop: 'fill',
    gravity: 'face',
    context: 'thumbnail'
  });
}

/**
 * Generate mobile-optimized URL
 * @param {string} publicId - Cloudinary public ID
 * @param {Object} [options] - Additional transformation options
 * @returns {string} Mobile-optimized URL
 */
function generateMobileUrl(publicId, options = {}) {
  return generateImageUrl(publicId, {
    ...options,
    context: 'mobile'
  });
}

/**
 * Generate web-optimized URL
 * @param {string} publicId - Cloudinary public ID
 * @param {Object} [options] - Additional transformation options
 * @returns {string} Web-optimized URL
 */
function generateWebUrl(publicId, options = {}) {
  return generateImageUrl(publicId, {
    ...options,
    context: 'web'
  });
}

/**
 * Extract public ID from Cloudinary URL
 * @param {string} cloudinaryUrl - Full Cloudinary URL
 * @returns {string|null} Public ID or null if invalid URL
 */
function extractPublicId(cloudinaryUrl) {
  if (!cloudinaryUrl || typeof cloudinaryUrl !== 'string') {
    return null;
  }

  try {
    // Match Cloudinary URL pattern and extract public ID
    const match = cloudinaryUrl.match(/\/image\/upload\/(?:v\d+\/)?(?:[^/]+\/)*([^/.]+)(?:\.[^.]+)?$/);
    return match ? match[1] : null;
  } catch (error) {
    console.error('Error extracting public ID:', error);
    return null;
  }
}

module.exports = {
  generateImageUrl,
  generateThumbnailUrl,
  generateMobileUrl,
  generateWebUrl,
  extractPublicId
};