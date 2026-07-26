const supabase = require('../supabase');
const { uploadImage } = require('../utils/imageUploadHelper');

// ============================================================
// ADMIN: Upload QR photo per society
// Stores URL in buildings.photos column
// ============================================================
exports.uploadQRPhoto = async (req, res) => {
  try {
    const { building_id } = req.params;

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can upload QR photos' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No photo file provided' });
    }

    if (!building_id) {
      return res.status(400).json({ error: 'Building ID is required' });
    }

    // Verify building exists and admin has access
    const { data: building, error: buildingError } = await supabase
      .from('buildings')
      .select('id, name')
      .eq('id', building_id);

    if (buildingError) {
      console.error('Building lookup error:', buildingError);
      return res.status(400).json({ error: buildingError.message });
    }

    if (!building || building.length === 0) {
      return res.status(404).json({ error: 'Building not found' });
    }

    try {
      // Upload to Cloudinary
      const result = await uploadImage(req.file.buffer, {
        folder: 'visitors',
        publicId: `qr-${building_id}-${Date.now()}`
      });

      // Update building photos column
      const { error: updateError } = await supabase
        .from('buildings')
        .update({ photos: result.secure_url })
        .eq('id', building_id);

      if (updateError) {
        console.error('Update error:', updateError);
        return res.status(400).json({ error: updateError.message });
      }

      res.status(201).json({
        message: 'QR photo uploaded successfully',
        building_id,
        photo_url: result.secure_url
      });
    } catch (uploadError) {
      console.error('Cloudinary upload error:', uploadError);
      res.status(500).json({ error: uploadError.message || 'Failed to upload photo to cloud storage' });
    }
  } catch (error) {
    console.error('QR photo upload error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to upload QR photo'
    });
  }
};

// ============================================================
// ADMIN: Delete QR photo for a society (clears buildings.photos)
// Users/pramukh read the same column, so they stop seeing it too.
// ============================================================
exports.deleteQRPhoto = async (req, res) => {
  try {
    const { building_id } = req.params;

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete QR photos' });
    }

    if (!building_id) {
      return res.status(400).json({ error: 'Building ID is required' });
    }

    const { data: buildings, error: lookupError } = await supabase
      .from('buildings')
      .select('id, photos')
      .eq('id', building_id);

    if (lookupError) {
      console.error('Building lookup error:', lookupError);
      return res.status(400).json({ error: lookupError.message });
    }

    if (!buildings || buildings.length === 0) {
      return res.status(404).json({ error: 'Building not found' });
    }

    if (!buildings[0].photos) {
      return res.status(404).json({ error: 'No QR photo found for this building' });
    }

    const { error: updateError } = await supabase
      .from('buildings')
      .update({ photos: null })
      .eq('id', building_id);

    if (updateError) {
      console.error('Delete QR photo error:', updateError);
      return res.status(400).json({ error: updateError.message });
    }

    res.json({ message: 'QR photo deleted successfully', building_id });
  } catch (error) {
    console.error('QR photo delete error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete QR photo' });
  }
};

// ============================================================
// Get QR photo for a building
// ============================================================
exports.getQRPhoto = async (req, res) => {
  try {
    const { building_id } = req.params;

    if (!building_id) {
      return res.status(400).json({ error: 'Building ID is required' });
    }

    // Check authorization
    if (req.user.role === 'user' && req.user.building_id !== building_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'pramukh' && req.user.building_id !== building_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: buildings, error } = await supabase
      .from('buildings')
      .select('id, photos')
      .eq('id', building_id);

    if (error) {
      console.error('Building query error:', error);
      return res.status(400).json({ error: error.message });
    }

    if (!buildings || buildings.length === 0) {
      return res.status(404).json({ error: 'Building not found' });
    }

    const building = buildings[0];

    if (!building.photos) {
      return res.status(404).json({ error: 'No QR photo found for this building' });
    }

    res.json({
      building_id,
      photo_url: building.photos
    });
  } catch (error) {
    console.error('Get QR photo error:', error);
    res.status(500).json({ error: error.message || 'Failed to retrieve QR photo' });
  }
};

// ============================================================
// Record QR share action (lightweight, no blocking operations)
// ============================================================
exports.recordQRShare = async (req, res) => {
  try {
    const { building_id } = req.params;
    const { share_method = 'whatsapp' } = req.body;

    if (!building_id) {
      return res.status(400).json({ error: 'Building ID is required' });
    }

    // Check authorization (fast, no DB query needed for non-admin)
    if (req.user.role === 'user' && req.user.building_id !== building_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'pramukh' && req.user.building_id !== building_id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Respond immediately without waiting for any DB operations
    res.status(201).json({
      message: 'Share recorded',
      building_id,
      share_method
    });

    // Optional: Log in background (fire and forget, no await)
    // This runs after response is sent, won't block user
    process.nextTick(() => {
      supabase
        .from('activity_logs')
        .insert({
          user_id: req.user.id,
          building_id,
          action: 'qr_share',
          meta: { share_method }
        })
        .then(() => {})
        .catch(() => {}); // Silently fail, non-critical
    });
  } catch (error) {
    console.error('Record share error:', error);
    res.status(500).json({ error: error.message || 'Failed to record share action' });
  }
};
