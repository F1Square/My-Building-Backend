const cloudinary = require('../services/cloudinaryService');

/**
 * Upload an image to Cloudinary
 * @param {Buffer|string} fileBuffer - Image file buffer or base64 string
 * @param {Object} options - Upload options
 * @param {string} options.folder - Cloudinary folder (visitors/receipts/complaints)
 * @param {string} [options.publicId] - Optional custom public ID
 * @param {Object} [options.transformation] - Optional transformation parameters
 * @returns {Promise<Object>} Upload result with secure_url and public_id
 * @throws {Error} If upload fails
 */
async function uploadImage(fileBuffer, options = {}) {
  try {
    // Validate inputs
    if (!fileBuffer) {
      throw new Error('File buffer is required');
    }

    if (!options.folder) {
      throw new Error('Folder is required (visitors, receipts, or complaints)');
    }

    // Validate folder name
    const validFolders = ['visitors', 'receipts', 'complaints'];
    if (!validFolders.includes(options.folder)) {
      throw new Error(`Invalid folder. Must be one of: ${validFolders.join(', ')}`);
    }

    // Prepare upload options
    const uploadOptions = {
      folder: options.folder,
      resource_type: 'image',
      format: 'auto', // Automatic format optimization
      quality: 'auto', // Automatic quality optimization
      public_id: options.publicId || undefined,
      transformation: options.transformation || undefined,
      overwrite: false,
      unique_filename: true
    };

    // Convert buffer to base64 if needed
    let uploadData;
    if (Buffer.isBuffer(fileBuffer)) {
      uploadData = `data:image/jpeg;base64,${fileBuffer.toString('base64')}`;
    } else if (typeof fileBuffer === 'string') {
      uploadData = fileBuffer;
    } else {
      throw new Error('File buffer must be a Buffer or base64 string');
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(uploadData, uploadOptions);

    // Return standardized response
    return {
      secure_url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes
    };

  } catch (error) {
    console.error('Image upload error:', error);
    
    // Return descriptive error messages without exposing sensitive information
    if (error.message.includes('Invalid image file')) {
      throw new Error('Invalid image file. Please try a different image.');
    } else if (error.message.includes('File size too large')) {
      throw new Error('File size too large. Maximum size is 10MB.');
    } else if (error.message.includes('Invalid API key')) {
      throw new Error('Image service temporarily unavailable. Please try again later.');
    } else if (error.message.includes('Network')) {
      throw new Error('Network error. Please check your connection and try again.');
    } else if (error.message.includes('timeout')) {
      throw new Error('Upload timeout. Please try again.');
    } else if (error.message.includes('quota') || error.message.includes('limit')) {
      throw new Error('Storage temporarily unavailable. Please try again later.');
    } else if (error.message.includes('File buffer') || error.message.includes('Folder')) {
      // Re-throw validation errors as-is
      throw error;
    } else {
      throw new Error('Failed to upload image. Please try again.');
    }
  }
}

module.exports = { uploadImage };