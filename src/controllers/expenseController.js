const supabase = require('../supabase');
const ns = require('../utils/notificationService');
const { createCopy } = require('../utils/notificationCopy');
const { withDisplayUser, userDisplayName, mapRowsWithDisplayUsers } = require('../utils/userDisplayName');

// ── Get all wings for a building ──────────────────────────────────────────────
exports.getWings = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  
  // Admin without building_id: return empty array (they need to select a building first)
  if (!building_id) {
    if (req.user.role === 'admin') {
      return res.json([]);
    }
    return res.status(400).json({ error: 'building_id required' });
  }

  try {
    const { data: building } = await supabase
      .from('buildings').select('wings').eq('id', building_id).single();

    if (!building?.wings) {
      // Return a single "Building-Wide" wing if no wings are configured
      return res.json([{ wing: 'Building-Wide' }]);
    }

    // Parse comma-separated wings (e.g. "A, B, C" -> [{ wing: 'A' }, { wing: 'B' }, { wing: 'C' }])
    const wingList = building.wings
      .split(',')
      .map(w => ({ wing: w.trim() }))
      .filter(w => w.wing);

    res.json(wingList.length > 0 ? wingList : [{ wing: 'Building-Wide' }]);
  } catch (error) {
    console.error('[getWings] Error:', error);
    res.json([{ wing: 'Building-Wide' }]);
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const VALID_TYPES = ['inflow', 'outflow'];
const ENTRY_WITH_USERS =
  '*, added_by_user:users!expense_entries_added_by_fkey(name, email, role), edited_by_user:users!expense_entries_edited_by_fkey(name, email)';

function mapExpenseEntry(entry) {
  if (!entry) return entry;
  return {
    ...entry,
    added_by_user: withDisplayUser(entry.added_by_user),
    edited_by_user: withDisplayUser(entry.edited_by_user),
  };
}

// Fast incremental balance update — no full scan
async function adjustBalance(building_id, wing = 'Building-Wide', delta) {
  // delta = positive for inflow, negative for outflow
  const { data: fund } = await supabase
    .from('society_funds').select('current_balance').eq('building_id', building_id).eq('wing', wing).single();

  const current = parseFloat(fund?.current_balance || 0);
  const newBalance = current + delta;

  await supabase.from('society_funds')
    .upsert({ building_id, wing, current_balance: newBalance }, { onConflict: 'building_id,wing' });

  return newBalance;
}

/** Calendar date YYYY-MM-DD in Asia/Kolkata (app is India-focused). */
function istDateString(d = new Date()) {
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function normalizeEntryDate(date) {
  if (!date) return istDateString();
  const m = String(date).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : istDateString();
}

/**
 * Min allowed entry date when opening balance exists.
 * Prefer opening_balance_as_of; fall back to fund created_at (IST).
 */
function openingBalanceMinDate(fund) {
  if (!fund || fund.opening_balance === null || fund.opening_balance === undefined) return null;
  if (fund.opening_balance_as_of) return String(fund.opening_balance_as_of).slice(0, 10);
  if (fund.created_at) return istDateString(fund.created_at);
  return null;
}

async function assertEntryDateAllowed(building_id, wing, entryDate) {
  const dateOnly = normalizeEntryDate(entryDate);
  const { data: fund } = await supabase
    .from('society_funds')
    .select('*')
    .eq('building_id', building_id)
    .eq('wing', wing)
    .maybeSingle();

  const minDate = openingBalanceMinDate(fund);
  if (minDate && dateOnly < minDate) {
    return {
      error: `Entry date cannot be before opening balance date (${minDate}). Opening balance was set on that day.`,
    };
  }
  return { dateOnly };
}

// ── Get fund summary (balance + opening) ─────────────────────────────────────
exports.getFundSummary = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const wing = req.query.wing || 'Building-Wide';
  
  if (!building_id) {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin must specify building_id in query parameters' });
    }
    return res.status(400).json({ error: 'building_id required' });
  }

  const { data } = await supabase
    .from('society_funds')
    .select('*')
    .eq('building_id', building_id)
    .eq('wing', wing)
    .single();

  if (!data) {
    return res.json({ building_id, wing, opening_balance: null, current_balance: 0, opening_balance_as_of: null });
  }

  const asOf = openingBalanceMinDate(data);
  res.json({ ...data, opening_balance_as_of: asOf });
};

// ── Set opening balance (pramukh first-time setup or admin) ──────────────────
exports.setOpeningBalance = async (req, res) => {
  const { amount, building_id: bodyBuildingId, wing = 'Building-Wide' } = req.body;
  const building_id = req.user.building_id || bodyBuildingId;
  
  if (!building_id) {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin must specify building_id in request body' });
    }
    return res.status(400).json({ error: 'building_id required' });
  }

  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed < 0) return res.status(422).json({ error: 'Amount must be a valid non-negative number' });

  const { data: existing } = await supabase
    .from('society_funds')
    .select('*')
    .eq('building_id', building_id)
    .eq('wing', wing)
    .single();

  const today = istDateString();
  const payload = {
    building_id,
    wing,
    opening_balance: parsed,
    current_balance: parsed,
    updated_at: new Date().toISOString(),
    set_by: req.user.id,
  };
  // Stamp as-of only the first time opening balance is set
  if (!existing?.opening_balance_as_of && (existing?.opening_balance === null || existing?.opening_balance === undefined || !existing)) {
    payload.opening_balance_as_of = today;
  }

  let error;
  if (existing) {
    ({ error } = await supabase.from('society_funds').update(payload).eq('building_id', building_id).eq('wing', wing));
    // Column may not exist yet — retry without as-of
    if (error && String(error.message || '').includes('opening_balance_as_of')) {
      delete payload.opening_balance_as_of;
      ({ error } = await supabase.from('society_funds').update(payload).eq('building_id', building_id).eq('wing', wing));
    }
  } else {
    payload.opening_balance_as_of = today;
    ({ error } = await supabase.from('society_funds').insert(payload));
    if (error && String(error.message || '').includes('opening_balance_as_of')) {
      delete payload.opening_balance_as_of;
      ({ error } = await supabase.from('society_funds').insert(payload));
    }
  }

  if (error) return res.status(400).json({ error: error.message });

  const { data: existingEntries } = await supabase
    .from('expense_entries').select('type, amount').eq('building_id', building_id).eq('wing', wing);
  let balance = parsed;
  (existingEntries || []).forEach((e) => {
    balance += e.type === 'inflow' ? parseFloat(e.amount) : -parseFloat(e.amount);
  });
  await supabase.from('society_funds')
    .update({ current_balance: balance })
    .eq('building_id', building_id)
    .eq('wing', wing);

  res.json({
    message: 'Opening balance set',
    current_balance: balance,
    opening_balance_as_of: payload.opening_balance_as_of || existing?.opening_balance_as_of || today,
  });
};

// ── Get expense entries ───────────────────────────────────────────────────────
exports.getEntries = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const wing = req.query.wing || 'Building-Wide';
  
  if (!building_id) {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin must specify building_id in query parameters' });
    }
    return res.status(400).json({ error: 'building_id required' });
  }

  const { type, limit = 100 } = req.query;

  let query = supabase
    .from('expense_entries')
    .select(ENTRY_WITH_USERS)
    .eq('building_id', building_id)
    .eq('wing', wing)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (type) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map(mapExpenseEntry));
};

// ── Add entry ─────────────────────────────────────────────────────────────────
exports.addEntry = async (req, res) => {
  const { type, amount, description, category, date, building_id: bodyBuildingId, wing = 'Building-Wide' } = req.body;
  const building_id = req.user.building_id || bodyBuildingId;
  
  if (!building_id) {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin must specify building_id in request body' });
    }
    return res.status(400).json({ error: 'building_id required' });
  }

  if (!VALID_TYPES.includes(type)) return res.status(422).json({ error: 'type must be inflow or outflow' });
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) return res.status(422).json({ error: 'Amount must be a positive number' });
  if (!description?.trim()) return res.status(422).json({ error: 'Description is required' });
  if (description.trim().length > 300) return res.status(422).json({ error: 'Description must not exceed 300 characters' });

  const dateCheck = await assertEntryDateAllowed(building_id, wing, date);
  if (dateCheck.error) return res.status(422).json({ error: dateCheck.error });
  const entryDate = dateCheck.dateOnly;

  const { data, error } = await supabase
    .from('expense_entries')
    .insert({
      building_id, wing, type, amount: parsed,
      description: description.trim(),
      category: category?.trim() || null,
      date: entryDate,
      added_by: req.user.id,
      is_edited: false,
    })
    .select(ENTRY_WITH_USERS)
    .single();

  if (error) return res.status(400).json({ error: error.message });

  const delta = type === 'inflow' ? parsed : -parsed;
  const balance = await adjustBalance(building_id, wing, delta);

  const entry = mapExpenseEntry(data);
  const byName = userDisplayName(entry.added_by_user || req.user, 'Pramukh');
  await ns.notifyMembers(building_id, {
    type: 'expense',
    meta: { entry_id: entry.id, type, wing },
    build: (lang) => createCopy(lang).expenseEntry(type, parsed, description.trim(), byName),
  });

  res.status(201).json({ message: 'Entry added', entry, current_balance: balance });
};

// ── Edit entry ────────────────────────────────────────────────────────────────
exports.editEntry = async (req, res) => {
  const { id } = req.params;
  const { type, amount, description, category, date, wing = 'Building-Wide' } = req.body;
  const building_id = req.user.building_id || req.body.building_id;

  // Fetch original
  const { data: original, error: fetchErr } = await supabase
    .from('expense_entries').select('*').eq('id', id).single();
  if (fetchErr || !original) return res.status(404).json({ error: 'Entry not found' });

  // Security: pramukh can only edit their own building
  if (req.user.role === 'pramukh' && original.building_id !== req.user.building_id)
    return res.status(403).json({ error: 'Access denied' });

  if (type && !VALID_TYPES.includes(type)) return res.status(422).json({ error: 'type must be inflow or outflow' });
  if (amount !== undefined) {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return res.status(422).json({ error: 'Amount must be a positive number' });
  }

  // Log the edit
  await supabase.from('expense_edit_logs').insert({
    entry_id: id,
    building_id: original.building_id,
    wing: original.wing,
    edited_by: req.user.id,
    old_type: original.type,
    old_amount: original.amount,
    old_description: original.description,
    old_category: original.category,
    old_date: original.date,
    edited_at: new Date().toISOString(),
  });

  const updates = {
    is_edited: true,
    edited_by: req.user.id,
    edited_at: new Date().toISOString(),
  };
  if (type) updates.type = type;
  if (amount !== undefined) updates.amount = parseFloat(amount);
  if (description !== undefined) updates.description = description.trim();
  if (category !== undefined) updates.category = category?.trim() || null;
  if (date !== undefined && date !== null && String(date).trim() !== '') {
    const m = String(date).match(/^(\d{4}-\d{2}-\d{2})/);
    updates.date = m ? m[1] : date;
  }

  const effectiveDate = updates.date || original.date;
  const dateCheck = await assertEntryDateAllowed(original.building_id, original.wing || wing, effectiveDate);
  if (dateCheck.error) return res.status(422).json({ error: dateCheck.error });

  const { data, error } = await supabase
    .from('expense_entries')
    .update(updates)
    .eq('id', id)
    .select(ENTRY_WITH_USERS)
    .single();
  if (error) return res.status(400).json({ error: error.message });

  // Reverse old entry, apply new entry
  const oldDelta = original.type === 'inflow' ? -parseFloat(original.amount) : parseFloat(original.amount);
  const newType = updates.type || original.type;
  const newAmount = updates.amount !== undefined ? updates.amount : parseFloat(original.amount);
  const newDelta = newType === 'inflow' ? newAmount : -newAmount;
  const balance = await adjustBalance(original.building_id, original.wing, oldDelta + newDelta);
  res.json({ message: 'Entry updated', entry: mapExpenseEntry(data), current_balance: balance });
};

// ── Delete entry ──────────────────────────────────────────────────────────────
exports.deleteEntry = async (req, res) => {
  const { id } = req.params;

  const { data: entry } = await supabase
    .from('expense_entries').select('building_id, wing, type, amount').eq('id', id).single();
  if (!entry) return res.status(404).json({ error: 'Entry not found' });

  if (req.user.role === 'pramukh' && entry.building_id !== req.user.building_id)
    return res.status(403).json({ error: 'Access denied' });

  const { error } = await supabase.from('expense_entries').delete().eq('id', id);
  if (error) return res.status(400).json({ error: error.message });

  // Reverse the deleted entry's effect on balance
  const delta = entry.type === 'inflow' ? -parseFloat(entry.amount) : parseFloat(entry.amount);
  const balance = await adjustBalance(entry.building_id, entry.wing, delta);
  res.json({ message: 'Entry deleted', current_balance: balance });
};

// ── Get edit logs (admin only) ────────────────────────────────────────────────
exports.getEditLogs = async (req, res) => {
  const building_id = req.user.building_id || req.query.building_id;
  const wing = req.query.wing || 'Building-Wide';

  let query = supabase
    .from('expense_edit_logs')
    .select('*, edited_by_user:users!expense_edit_logs_edited_by_fkey(name, email, role)')
    .eq('wing', wing)
    .order('edited_at', { ascending: false })
    .limit(200);

  if (building_id) query = query.eq('building_id', building_id);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(mapRowsWithDisplayUsers(data || [], ['edited_by_user']));
};

// ── Export entries (PDF / Excel) ──────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** PDFKit Helvetica has no ₹ glyph — use Rs. (same as maintenance receipts). */
function fmtInr(n) {
  return `Rs. ${Number(n || 0).toLocaleString('en-IN')}`;
}

function formatEntryDate(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

exports.exportEntries = async (req, res) => {
  const format = String(req.query.format || 'pdf').toLowerCase();
  if (!['pdf', 'excel'].includes(format)) {
    return res.status(400).json({ error: 'format must be pdf or excel' });
  }

  const building_id = req.user.building_id || req.query.building_id;
  const wing = req.query.wing || 'Building-Wide';
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  if (!building_id) {
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin must specify building_id in query parameters' });
    }
    return res.status(400).json({ error: 'building_id required' });
  }
  if (req.user.role === 'pramukh' && building_id !== req.user.building_id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(422).json({ error: 'from and to must be YYYY-MM-DD' });
  }
  if (from > to) return res.status(422).json({ error: 'from must be on or before to' });

  const [{ data: building }, { data: fund }, { data: entries, error }] = await Promise.all([
    supabase.from('buildings').select('name').eq('id', building_id).single(),
    supabase
      .from('society_funds')
      .select('opening_balance, current_balance')
      .eq('building_id', building_id)
      .eq('wing', wing)
      .maybeSingle(),
    supabase
      .from('expense_entries')
      .select(ENTRY_WITH_USERS)
      .eq('building_id', building_id)
      .eq('wing', wing)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(5000),
  ]);

  if (error) return res.status(400).json({ error: error.message });

  const rows = (entries || []).map(mapExpenseEntry);
  const inflow = rows.filter((e) => e.type === 'inflow').reduce((s, e) => s + Number(e.amount), 0);
  const outflow = rows.filter((e) => e.type === 'outflow').reduce((s, e) => s + Number(e.amount), 0);
  const openingBalance = fund?.opening_balance != null ? Number(fund.opening_balance) : null;
  const currentBalance = Number(fund?.current_balance ?? 0);
  const buildingName = building?.name || 'Building';
  const rangeLabel = `${formatEntryDate(from)} – ${formatEntryDate(to)}`;
  const stamp = `${from}_to_${to}`;
  const balanceLine = [
    openingBalance != null ? `Opening: ${fmtInr(openingBalance)}` : null,
    `Current: ${fmtInr(currentBalance)}`,
    `Inflow: ${fmtInr(inflow)}`,
    `Outflow: ${fmtInr(outflow)}`,
  ].filter(Boolean).join('   ');

  if (format === 'excel') {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Expenses');

    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = `${buildingName} — Society Expenses`;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.mergeCells('A2:F2');
    ws.getCell('A2').value = `Wing: ${wing}  |  ${rangeLabel}`;
    ws.getCell('A2').font = { size: 11, color: { argb: 'FF6B7280' } };
    ws.mergeCells('A3:F3');
    ws.getCell('A3').value = balanceLine;
    ws.getCell('A3').font = { size: 11, bold: true };

    const header = ws.addRow(['Date', 'Type', 'Amount (Rs.)', 'Category', 'Description', 'Added By']);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };

    rows.forEach((e) => {
      const row = ws.addRow([
        formatEntryDate(e.date),
        e.type === 'inflow' ? 'Inflow' : 'Outflow',
        Number(e.amount),
        e.category || '—',
        e.description || '—',
        e.added_by_user?.name || '—',
      ]);
      row.getCell(2).font = {
        color: { argb: e.type === 'inflow' ? 'FF16A34A' : 'FFDC2626' },
        bold: true,
      };
    });

    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell({ includeEmpty: true }, (cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > max) max = len;
      });
      col.width = Math.min(max + 2, 40);
    });

    const filename = `expenses_${stamp}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    await wb.xlsx.write(res);
    return res.end();
  }

  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const filename = `expenses_${stamp}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, 72).fill('#1E3A8A');
  doc.fillColor('#fff').fontSize(18).font('Helvetica-Bold').text(buildingName, 40, 18);
  doc.fontSize(11).font('Helvetica').text(`Society Expenses — ${wing}`, 40, 44);

  doc.fillColor('#111').fontSize(10).font('Helvetica')
    .text(`Period: ${rangeLabel}`, 40, 88)
    .text(balanceLine, 40, 104, { width: doc.page.width - 80 });

  const colX = [40, 110, 160, 235, 310, 455];
  let y = 132;
  const headers = ['Date', 'Type', 'Amount', 'Category', 'Description', 'Added By'];
  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151');
    headers.forEach((h, i) => {
      const w = i < colX.length - 1 ? colX[i + 1] - colX[i] - 4 : doc.page.width - 40 - colX[i];
      doc.text(h, colX[i], y, { width: w });
    });
    y += 16;
    doc.moveTo(40, y).lineTo(doc.page.width - 40, y).strokeColor('#E5E7EB').stroke();
    y += 8;
  };
  drawHeader();

  doc.font('Helvetica').fontSize(9);
  for (const e of rows) {
    if (y > doc.page.height - 50) {
      doc.addPage();
      y = 40;
      drawHeader();
      doc.font('Helvetica').fontSize(9);
    }
    const vals = [
      formatEntryDate(e.date),
      e.type === 'inflow' ? 'In' : 'Out',
      fmtInr(e.amount),
      e.category || '—',
      e.description || '—',
      e.added_by_user?.name || '—',
    ];
    const heights = vals.map((v, i) => {
      const w = i < colX.length - 1 ? colX[i + 1] - colX[i] - 4 : doc.page.width - 40 - colX[i];
      return doc.heightOfString(String(v), { width: w });
    });
    const rowH = Math.max(14, ...heights);
    vals.forEach((v, i) => {
      const w = i < colX.length - 1 ? colX[i + 1] - colX[i] - 4 : doc.page.width - 40 - colX[i];
      if (i === 1) doc.fillColor(e.type === 'inflow' ? '#16A34A' : '#DC2626');
      else doc.fillColor('#111');
      doc.text(String(v), colX[i], y, { width: w, height: rowH });
    });
    y += rowH + 6;
  }

  if (!rows.length) {
    doc.fillColor('#6B7280').text('No entries in this period.', 40, y);
  }

  doc.fillColor('#9CA3AF').fontSize(8)
    .text(`Generated ${new Date().toLocaleString('en-IN')}`, 40, doc.page.height - 30, {
      width: doc.page.width - 80,
      align: 'center',
    });
  doc.end();
};
