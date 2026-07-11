const supabase = require('../supabase');
const multer = require('multer');

const VALID_LANGUAGES = ['english', 'hindi', 'gujarati'];
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — long enough to read, short enough to limit leaks

// Multer — memory storage for Supabase upload
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
exports.upload = upload;

// Best-effort: extract the storage object path from a Supabase public URL.
// Supabase public URLs look like:
//   https://<project>.supabase.co/storage/v1/object/public/newspapers/<path>
// We need just the part inside the bucket: e.g. "newspapers/english/2026-05-09_173...pdf"
const extractStoragePath = (fileUrl) => {
  if (!fileUrl) return null;
  const marker = '/object/public/newspapers/';
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  return `newspapers/${fileUrl.substring(idx + marker.length)}`;
};

// Generate a short-lived signed URL for an uploaded edition. Falls back to the
// stored URL if signing fails (e.g. legacy rows or storage misconfig).
const signUploadedUrl = async (edition) => {
  if (!edition || edition.source !== 'upload') return edition?.file_url || null;
  const path = extractStoragePath(edition.file_url);
  if (!path) return edition.file_url;
  try {
    const { data, error } = await supabase.storage
      .from('newspapers')
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return edition.file_url;
    return data.signedUrl;
  } catch (_) {
    return edition.file_url;
  }
};

// GET /newspapers?date=YYYY-MM-DD&language=english
exports.getEdition = async (req, res) => {
  const { date, language } = req.query;
  if (!date || !language) return res.status(422).json({ error: 'date and language are required' });
  if (!VALID_LANGUAGES.includes(language)) return res.status(422).json({ error: 'Invalid language' });

  // Check newspaper_addon for non-admin users
  if (req.user.role !== 'admin') {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('newspaper_addon, status, expires_at')
      .eq('user_id', req.user.id)
      .single();

    const isActive = sub?.status === 'active' && (!sub.expires_at || new Date(sub.expires_at) > new Date());
    if (!isActive || !sub?.newspaper_addon) {
      return res.status(403).json({ error: 'newspaper_addon_required' });
    }
  }

  // Check manual edition first
  const { data: edition } = await supabase
    .from('newspaper_editions')
    .select('*')
    .eq('date', date)
    .eq('language', language)
    .maybeSingle();

  if (edition) {
    const signedUrl = await signUploadedUrl(edition);
    return res.json({
      url: signedUrl,
      source: edition.source,
      kind: edition.source === 'upload' ? 'pdf' : 'external',
      date,
      language,
    });
  }

  // No edition for this date + language — do not fall back to URL patterns.
  // Each language tab must only show its own uploaded PDF (or empty).
  res.status(404).json({ error: 'not_available' });
};

// GET /newspapers/available-dates?language=english
exports.getAvailableDates = async (req, res) => {
  const { language } = req.query;
  let query = supabase.from('newspaper_editions').select('date, language').order('date', { ascending: false });
  if (language) query = query.eq('language', language);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
};

// POST /newspapers — admin upload or URL
exports.uploadEdition = async (req, res) => {
  const { date, language, url } = req.body;
  if (!date || !language) return res.status(422).json({ error: 'date and language are required' });
  if (!VALID_LANGUAGES.includes(language)) return res.status(422).json({ error: 'Invalid language' });

  let file_url = url?.trim() || null;
  let source = 'url';

  if (req.file) {
    // Upload to Supabase Storage
    const fileName = `newspapers/${language}/${date}_${Date.now()}.pdf`;
    const { data: storageData, error: storageErr } = await supabase.storage
      .from('newspapers')
      .upload(fileName, req.file.buffer, { contentType: 'application/pdf', upsert: true });

    if (storageErr) return res.status(400).json({ error: storageErr.message });

    const { data: publicUrl } = supabase.storage.from('newspapers').getPublicUrl(fileName);
    file_url = publicUrl.publicUrl;
    source = 'upload';
  }

  if (!file_url) return res.status(422).json({ error: 'Either a file or a URL is required' });

  // Upsert — replace existing edition for same date+language
  const { data: existing } = await supabase
    .from('newspaper_editions')
    .select('id')
    .eq('date', date)
    .eq('language', language)
    .maybeSingle();

  let error;
  if (existing) {
    ({ error } = await supabase
      .from('newspaper_editions')
      .update({ file_url, source, uploaded_by: req.user.id, updated_at: new Date().toISOString() })
      .eq('id', existing.id));
  } else {
    ({ error } = await supabase
      .from('newspaper_editions')
      .insert({ date, language, file_url, source, uploaded_by: req.user.id }));
  }

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ message: 'Edition saved', date, language, file_url, source });
};

// DELETE /newspapers/:id — admin
exports.deleteEdition = async (req, res) => {
  const { id } = req.params;
  const { data: edition } = await supabase
    .from('newspaper_editions')
    .select('*')
    .eq('id', id)
    .single();

  if (!edition) return res.status(404).json({ error: 'Edition not found' });

  // Delete from storage if uploaded
  if (edition.source === 'upload' && edition.file_url) {
    const path = edition.file_url.split('/newspapers/')[1];
    if (path) await supabase.storage.from('newspapers').remove([`newspapers/${path}`]);
  }

  const { error } = await supabase.from('newspaper_editions').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Edition deleted' });
};

// GET /newspapers/recent — admin: list recent editions
exports.getRecentEditions = async (req, res) => {
  const { data, error } = await supabase
    .from('newspaper_editions')
    .select('*')
    .order('date', { ascending: false })
    .limit(30);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
};

// GET /newspapers/url-patterns — admin
exports.getUrlPatterns = async (req, res) => {
  const { data, error } = await supabase.from('newspaper_url_patterns').select('*');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
};

// PUT /newspapers/url-patterns — admin
exports.saveUrlPatterns = async (req, res) => {
  const { patterns } = req.body; // [{ language, url_pattern }]
  if (!Array.isArray(patterns)) return res.status(422).json({ error: 'patterns must be an array' });

  for (const p of patterns) {
    if (!VALID_LANGUAGES.includes(p.language)) continue;
    const { data: existing } = await supabase
      .from('newspaper_url_patterns')
      .select('id')
      .eq('language', p.language)
      .maybeSingle();

    if (existing) {
      await supabase.from('newspaper_url_patterns')
        .update({ url_pattern: p.url_pattern, updated_by: req.user.id, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('newspaper_url_patterns')
        .insert({ language: p.language, url_pattern: p.url_pattern, updated_by: req.user.id });
    }
  }

  res.json({ message: 'URL patterns saved' });
};
