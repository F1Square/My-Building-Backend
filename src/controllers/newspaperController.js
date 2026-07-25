const supabase = require('../supabase');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');

const VALID_LANGUAGES = ['english', 'hindi', 'gujarati'];
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — long enough to read, short enough to limit leaks
const TITLE_MAX = 150;

// Multer — memory storage for Supabase upload
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
exports.upload = upload;

const extractStoragePath = (fileUrl) => {
  if (!fileUrl) return null;
  const marker = '/object/public/newspapers/';
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  return `newspapers/${fileUrl.substring(idx + marker.length)}`;
};

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

const editionTitle = (edition) => {
  const t = edition?.title?.trim();
  if (t) return t;
  const lang = edition?.language || 'english';
  return `${lang.charAt(0).toUpperCase()}${lang.slice(1)} Edition`;
};

async function assertNewspaperAccess(req) {
  if (req.user.role === 'admin') return null;
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('newspaper_addon, newspaper_expires_at, status, expires_at')
    .eq('user_id', req.user.id)
    .single();

  const isActive = sub?.status === 'active' && (!sub.expires_at || new Date(sub.expires_at) > new Date());
  const newsOk = !!sub?.newspaper_addon
    && (!sub.newspaper_expires_at || new Date(sub.newspaper_expires_at) > new Date());
  if (!isActive || !newsOk) return { status: 403, error: 'newspaper_addon_required' };
  return null;
}

function mapEditionMeta(edition) {
  return {
    id: edition.id,
    title: editionTitle(edition),
    date: edition.date,
    language: edition.language,
    source: edition.source,
    kind: edition.source === 'upload' ? 'pdf' : 'external',
    created_at: edition.created_at,
  };
}

// GET /newspapers?date=YYYY-MM-DD&language=english — list editions (titles) for date+language
exports.listEditions = async (req, res) => {
  const { date, language } = req.query;
  if (!date || !language) return res.status(422).json({ error: 'date and language are required' });
  if (!VALID_LANGUAGES.includes(language)) return res.status(422).json({ error: 'Invalid language' });

  const denied = await assertNewspaperAccess(req);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const { data: editions, error } = await supabase
    .from('newspaper_editions')
    .select('id, title, date, language, source, created_at')
    .eq('date', date)
    .eq('language', language)
    .order('created_at', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });
  if (!editions?.length) return res.status(404).json({ error: 'not_available' });

  res.json({
    date,
    language,
    editions: editions.map(mapEditionMeta),
  });
};

// GET /newspapers/item/:id — open one edition (signed URL)
exports.getEditionById = async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(422).json({ error: 'id is required' });

  const denied = await assertNewspaperAccess(req);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const { data: edition, error } = await supabase
    .from('newspaper_editions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!edition) return res.status(404).json({ error: 'not_available' });

  const signedUrl = await signUploadedUrl(edition);
  res.json({
    ...mapEditionMeta(edition),
    url: signedUrl,
  });
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

// POST /newspapers — admin upload (always inserts; multiple PDFs per date+language allowed)
exports.uploadEdition = async (req, res) => {
  const { date, language, url } = req.body;
  const title = String(req.body.title || '').trim();
  if (!date || !language) return res.status(422).json({ error: 'date and language are required' });
  if (!VALID_LANGUAGES.includes(language)) return res.status(422).json({ error: 'Invalid language' });
  if (!title) return res.status(422).json({ error: 'title is required' });
  if (title.length > TITLE_MAX) return res.status(422).json({ error: `title must not exceed ${TITLE_MAX} characters` });

  let file_url = url?.trim() || null;
  let source = 'url';

  if (req.file) {
    // Unique name so multiple PDFs on the same date+language never overwrite each other
    const fileName = `newspapers/${language}/${date}_${uuidv4()}.pdf`;
    const { error: storageErr } = await supabase.storage
      .from('newspapers')
      .upload(fileName, req.file.buffer, { contentType: 'application/pdf', upsert: false });

    if (storageErr) return res.status(400).json({ error: storageErr.message });

    const { data: publicUrl } = supabase.storage.from('newspapers').getPublicUrl(fileName);
    file_url = publicUrl.publicUrl;
    source = 'upload';
  }

  if (!file_url) return res.status(422).json({ error: 'Either a file or a URL is required' });

  const { data: row, error } = await supabase
    .from('newspaper_editions')
    .insert({ date, language, title, file_url, source, uploaded_by: req.user.id })
    .select('id, title, date, language, source, created_at')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  try {
    const now = new Date();
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('user_id, expires_at, newspaper_expires_at')
      .eq('newspaper_addon', true)
      .eq('status', 'active');

    const recipients = [];
    const seen = new Set();
    for (const s of subs || []) {
      if (!s.user_id || seen.has(s.user_id)) continue;
      const planOk = !s.expires_at || new Date(s.expires_at) > now;
      const newsOk = !s.newspaper_expires_at || new Date(s.newspaper_expires_at) > now;
      if (!planOk || !newsOk) continue;
      seen.add(s.user_id);
      recipients.push(s.user_id);
    }

    if (recipients.length) {
      await Promise.all(recipients.map((user_id) => ns.notifyUser(user_id, {
        type: 'newspaper',
        meta: { date, language, edition_id: row.id, title },
        build: (lang) => createCopy(lang).newspaperEdition(date, language, title),
      })));
    }
  } catch (notifyErr) {
    console.error('[newspaper] notify subscribers failed:', notifyErr);
  }

  res.status(201).json({
    message: 'Edition saved',
    edition: mapEditionMeta(row),
    file_url,
    source,
  });
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
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map((e) => ({ ...e, title: editionTitle(e) })));
};

// GET /newspapers/url-patterns — admin
exports.getUrlPatterns = async (req, res) => {
  const { data, error } = await supabase.from('newspaper_url_patterns').select('*');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
};

// PUT /newspapers/url-patterns — admin
exports.saveUrlPatterns = async (req, res) => {
  const { patterns } = req.body;
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
