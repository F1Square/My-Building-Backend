const { Readable } = require('stream');
const cloudinary = require('../services/cloudinaryService');

function mapCloudinaryError(error) {
  const msg = String(error?.message || error?.error?.message || error?.error || '');
  console.error('Cloudinary error detail:', error?.http_code, msg);

  if (/invalid\s+image|corrupt|unsupported/i.test(msg)) {
    throw new Error('Invalid image file. Please try a different image.');
  }
  if (/too\s+large|File\s+size|maximum/i.test(msg)) {
    throw new Error('File size too large. Maximum size is 10MB.');
  }
  if (error?.http_code === 401 || /Invalid\s+API\s+key|authentication/i.test(msg)) {
    throw new Error('Image service temporarily unavailable. Please try again later.');
  }
  if (/Network|ENOTFOUND|ECONNRESET/i.test(msg)) {
    throw new Error('Network error. Please check your connection and try again.');
  }
  if (/timeout|ETIMEDOUT/i.test(msg)) {
    throw new Error('Upload timeout. Please try again.');
  }
  if (/quota|limit/i.test(msg)) {
    throw new Error('Storage temporarily unavailable. Please try again later.');
  }
  if (msg.length && msg.length < 180) {
    throw new Error(`Upload failed: ${msg}`);
  }
  throw new Error('Failed to upload image. Please try again.');
}

/**
 * Upload an image to Cloudinary.
 * Buffers / data-URIs use upload_stream (avoids huge base64 string uploads that time out).
 */
async function uploadImage(fileBuffer, options = {}) {
  if (!fileBuffer) {
    throw new Error('File buffer is required');
  }

  if (!options.folder) {
    throw new Error('Folder is required (visitors, receipts, or complaints)');
  }

  const validFolders = ['visitors', 'receipts', 'complaints'];
  if (!validFolders.includes(options.folder)) {
    throw new Error(`Invalid folder. Must be one of: ${validFolders.join(', ')}`);
  }

  // Do not pass format: 'auto' / quality: 'auto' here — Cloudinary treats them invalidly on upload
  // and returns "Invalid extension in transformation: auto". Optimization belongs on delivery URLs.
  const uploadOptions = {
    folder: options.folder,
    resource_type: 'image',
    public_id: options.publicId || undefined,
    transformation: options.transformation || undefined,
    overwrite: options.overwrite === true,
    unique_filename: !options.publicId,
    timeout: options.timeoutMs || 45000,
  };

  const timeoutMs = options.timeoutMs || 45000;

  const runUpload = async () => {
    let result;

    if (Buffer.isBuffer(fileBuffer)) {
      if (fileBuffer.length === 0) {
        throw new Error('Empty file buffer');
      }
      result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
        Readable.from(fileBuffer).pipe(uploadStream);
      });
    } else if (typeof fileBuffer === 'string') {
      // Prefer buffer stream for data-URIs — string upload of large base64 often times out on serverless.
      const dataUriMatch = fileBuffer.match(/^data:image\/[\w+.-]+;base64,(.+)$/i);
      if (dataUriMatch) {
        const buf = Buffer.from(dataUriMatch[1], 'base64');
        if (!buf.length) throw new Error('Empty file buffer');
        result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
          Readable.from(buf).pipe(uploadStream);
        });
      } else {
        result = await cloudinary.uploader.upload(fileBuffer, uploadOptions);
      }
    } else {
      throw new Error('File buffer must be a Buffer or base64 string');
    }

    return {
      secure_url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      bytes: result.bytes,
    };
  };

  try {
    return await Promise.race([
      runUpload(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Upload timeout. Please try again.')), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error('Image upload error:', error?.http_code, error?.message || error);
    if (
      error.message?.includes('File buffer') ||
      error.message?.includes('Folder') ||
      error.message?.includes('Empty file') ||
      error.message?.includes('Upload timeout')
    ) {
      throw error;
    }
    mapCloudinaryError(error);
  }
}

module.exports = { uploadImage };
