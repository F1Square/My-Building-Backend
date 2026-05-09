const supabase = require('../supabase');
const ns = require('../utils/notificationService');

const PHONE_RE = /^[6-9]\d{9}$/;

// PUBLIC: visitor self-entry via QR (no auth required)
exports.visitorSelfEntry = async (req, res) => {
  const { building_id } = req.params;
  const { name, mobile, purpose, flat_no, photo_url } = req.body;

  if (!name?.trim()) return res.status(422).json({ error: 'Name is required' });
  if (name.trim().length > 100) return res.status(422).json({ error: 'Name must not exceed 100 characters' });
  if (!mobile?.trim()) return res.status(422).json({ error: 'Mobile number is required' });
  if (!PHONE_RE.test(mobile.trim())) return res.status(422).json({ error: 'Enter a valid 10-digit Indian mobile number' });
  if (!flat_no?.trim()) return res.status(422).json({ error: 'Flat number is required' });
  if (flat_no.trim().length > 20) return res.status(422).json({ error: 'Flat number must not exceed 20 characters' });
  if (purpose && purpose.trim().length > 500) return res.status(422).json({ error: 'Purpose must not exceed 500 characters' });

  const { data: building } = await supabase
    .from('buildings').select('id, name').eq('id', building_id).single();
  if (!building) return res.status(404).json({ error: 'Building not found' });

  const { data, error } = await supabase
    .from('visitors')
    .insert({
      building_id,
      name: name.trim(),
      phone: mobile.trim(),
      purpose: purpose?.trim(),
      flat_no: flat_no.trim(),
      photo_url,
      entry_type: 'self'
    })
    .select().single();

  if (error) return res.status(400).json({ error: error.message });

  await ns.notifyMembers(building_id, {
    title: '🚪 New Visitor',
    body: `${name.trim()} is visiting Flat ${flat_no.trim()} — ${purpose?.trim() || 'No purpose specified'}`,
    type: 'visitor',
    meta: { visitor_id: data.id }
  });

  res.status(201).json({ message: 'Entry logged successfully', visitor: data, building_name: building.name });
};

// PUBLIC: JSON building info — used by visitor-web standalone website
exports.getBuildingInfoJson = async (req, res) => {
  const { building_id } = req.params;
  const { data, error } = await supabase
    .from('buildings').select('id, name, address').eq('id', building_id).single();
  if (error || !data) return res.status(404).json({ error: 'Building not found' });
  res.json(data);
};

// PUBLIC: serve HTML visitor entry form (opened when QR is scanned)
exports.getBuildingInfo = async (req, res) => {
  const { building_id } = req.params;
  const { data, error } = await supabase
    .from('buildings').select('id, name, address').eq('id', building_id).single();
  if (error || !data) return res.status(404).send('<h2>Building not found</h2>');

  const backendUrl = process.env.NODE_ENV === 'production'
    ? (process.env.BACKEND_URL || '')
    : `${req.protocol}://${req.get('host')}`;

  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>Visitor Entry — ${data.name}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; min-height: 100vh; padding: 20px 16px 40px; }
    .header { text-align: center; margin-bottom: 24px; padding-top: 16px; }
    .header .icon { font-size: 48px; }
    .header h1 { font-size: 22px; font-weight: 800; color: #1E3A8A; margin-top: 8px; }
    .header p { font-size: 13px; color: #6B7280; margin-top: 4px; }
    .card { background: #fff; border-radius: 20px; padding: 24px 20px; max-width: 480px; margin: 0 auto; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; margin-top: 16px; }
    label span { color: #EF4444; }
    input, textarea { width: 100%; border: 1.5px solid #D1D5DB; border-radius: 10px; padding: 12px 14px; font-size: 15px; color: #111827; background: #F9FAFB; outline: none; transition: border-color 0.2s; }
    input:focus, textarea:focus { border-color: #1E3A8A; background: #fff; }
    textarea { height: 80px; resize: none; }
    .photo-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; border: 1.5px dashed #1E3A8A; border-radius: 12px; padding: 14px; background: #EFF6FF; color: #1E3A8A; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 4px; }
    .photo-preview { width: 100%; max-height: 220px; object-fit: cover; border-radius: 12px; margin-top: 12px; display: none; }
    .submit-btn { width: 100%; background: #1E3A8A; color: #fff; border: none; border-radius: 12px; padding: 16px; font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 24px; transition: opacity 0.2s; }
    .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .error { color: #EF4444; font-size: 13px; margin-top: 8px; display: none; }
    .success-screen { display: none; text-align: center; padding: 32px 16px; }
    .success-screen .tick { font-size: 72px; }
    .success-screen h2 { font-size: 24px; font-weight: 800; color: #16A34A; margin-top: 12px; }
    .success-screen p { font-size: 15px; color: #6B7280; margin-top: 10px; line-height: 1.6; }
  </style>
</head>
<body>
  <div id="formView">
    <div class="header">
      <div class="icon">🏢</div>
      <h1>${data.name}</h1>
      <p>${data.address || 'Visitor Entry Form'}</p>
    </div>
    <div class="card">
      <label>Full Name <span>*</span></label>
      <input id="name" type="text" placeholder="Your full name" autocomplete="name" />

      <label>Mobile Number <span>*</span></label>
      <input id="mobile" type="tel" placeholder="10-digit mobile number" maxlength="10" inputmode="numeric" />

      <label>Visiting Flat No <span>*</span></label>
      <input id="flat_no" type="text" placeholder="e.g. A-101" autocomplete="off" />

      <label>Purpose of Visit</label>
      <textarea id="purpose" placeholder="e.g. Delivery, Meeting, Repair work..."></textarea>

      <label>Live Photo <span>*</span></label>
      <label class="photo-btn" for="photoInput">
        <span>📷</span> <span id="photoLabel">Take / Upload Photo</span>
      </label>
      <input id="photoInput" type="file" accept="image/*" capture="environment" style="display:none" onchange="previewPhoto(this)" />
      <img id="photoPreview" class="photo-preview" alt="Preview" />

      <div class="error" id="errMsg"></div>
      <button class="submit-btn" id="submitBtn" onclick="submitForm()">Register Entry</button>
    </div>
  </div>

  <div class="success-screen" id="successView">
    <div class="tick">✅</div>
    <h2>Entry Registered!</h2>
    <p>Your visit to <strong>${data.name}</strong> has been recorded.<br/>The residents have been notified.</p>
  </div>

  <script>
    var photoBase64 = null;

    function previewPhoto(input) {
      var file = input.files[0];
      if (!file) return;
      document.getElementById('photoLabel').textContent = 'Photo selected ✓';
      var reader = new FileReader();
      reader.onload = function(e) {
        photoBase64 = e.target.result;
        var img = document.getElementById('photoPreview');
        img.src = photoBase64;
        img.style.display = 'block';
      };
      reader.readAsDataURL(file);
    }

    function showError(msg) {
      var el = document.getElementById('errMsg');
      el.textContent = msg;
      el.style.display = 'block';
    }

    function hideError() {
      document.getElementById('errMsg').style.display = 'none';
    }

    function submitForm() {
      hideError();
      var name = document.getElementById('name').value.trim();
      var mobile = document.getElementById('mobile').value.trim();
      var flat_no = document.getElementById('flat_no').value.trim();
      var purpose = document.getElementById('purpose').value.trim();

      if (!name) return showError('Full name is required');
      if (!mobile || !/^[6-9]\\d{9}$/.test(mobile)) return showError('Enter a valid 10-digit mobile number');
      if (!flat_no) return showError('Flat number is required');
      if (!photoBase64) return showError('Please take or upload a photo');

      var btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Submitting...';

      fetch('${backendUrl}/entry/building/${building_id}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, mobile: mobile, flat_no: flat_no, purpose: purpose, photo_url: photoBase64 })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          showError(data.error);
          btn.disabled = false;
          btn.textContent = 'Register Entry';
        } else {
          document.getElementById('formView').style.display = 'none';
          document.getElementById('successView').style.display = 'block';
        }
      })
      .catch(function() {
        showError('Network error. Please check your connection and try again.');
        btn.disabled = false;
        btn.textContent = 'Register Entry';
      });
    }
  </script>
</body>
</html>`);
};
