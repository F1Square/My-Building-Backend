const multer = require('multer');

// Configure multer for memory storage (no disk writes)
const storage = multer.memoryStorage();

// File filter for image validation
const fileFilter = (req, file, cb) => {
  // Check file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const error = new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.');
    error.code = 'INVALID_FILE_TYPE';
    cb(error, false);
  }
};

// Multer configuration
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 // Single file upload
  }
});

// Error handling middleware for multer errors
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    let message;
    let code;

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        message = 'File size must be less than 10MB';
        code = 'FILE_TOO_LARGE';
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Only one file is allowed per upload';
        code = 'TOO_MANY_FILES';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file field';
        code = 'UNEXPECTED_FILE';
        break;
      default:
        message = 'File upload error';
        code = 'UPLOAD_ERROR';
    }

    return res.status(400).json({
      success: false,
      error: message,
      code: code
    });
  } else if (error && error.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      success: false,
      error: error.message,
      code: error.code,
      details: {
        allowedTypes: ['JPEG', 'PNG', 'WebP'],
        maxSize: '10MB'
      }
    });
  }

  next(error);
};

// Single file upload middleware
const singleImageUpload = (fieldName = 'photo') => {
  return [
    upload.single(fieldName),
    handleMulterError
  ];
};

// Multiple files upload middleware (for complaint attachments)
const multipleImageUpload = (fieldName = 'attachments', maxCount = 5) => {
  return [
    upload.array(fieldName, maxCount),
    handleMulterError
  ];
};

// Validation middleware to check if file was uploaded
const requireFile = (req, res, next) => {
  if (!req.file && !req.files) {
    return res.status(400).json({
      success: false,
      error: 'No image file provided',
      code: 'MISSING_FILE'
    });
  }
  next();
};

module.exports = {
  singleImageUpload,
  multipleImageUpload,
  requireFile,
  handleMulterError
};