const PDFDocument = require('pdfkit');
const supabase = require('../supabase');
const { withDisplayUser, userDisplayName } = require('./userDisplayName');
const { sendMail, escapeHtml } = require('./mailService');

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function methodLabelFromRecord(record) {
  const rawMethod = String(record.payment_method || '').toLowerCase();
  if (rawMethod.startsWith('online') || rawMethod === 'easebuzz') return 'Online (Easebuzz)';
  if (rawMethod === 'cheque') return 'Cheque';
  if (rawMethod === 'cash') return 'Cash';
  return 'Manual';
}

function categoryLabelFromBill(bill) {
  return {
    maintenance: 'Maintenance Payment Receipt',
    water_meter: 'Water Meter Payment Receipt',
    special: 'Special Bill Payment Receipt',
  }[bill?.category || 'maintenance'] || 'Payment Receipt';
}

/**
 * Build the same receipt PDF used by downloadReceipt, as a Buffer.
 * @param {object} record — payment row with maintenance_bills, users, buildings joins
 */
function buildReceiptPdfBuffer(record) {
  const paymentRecordId = record.id;
  const bill = record.maintenance_bills;
  const user = withDisplayUser(record.users);
  const building = record.buildings;

  const baseAmount = Number(record.amount ?? bill?.amount ?? 0);
  const penaltyAmount = Number(record.penalty_amount ?? 0);
  const totalAmount = Number(record.total_amount ?? (baseAmount + penaltyAmount));
  const methodLabel = methodLabelFromRecord(record);
  const categoryLabel = categoryLabelFromBill(bill);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, doc.page.width, 80).fill('#1E3A8A');
    doc.fillColor('#fff').fontSize(26).font('Helvetica-Bold').text('My Building', 50, 22);
    doc.fontSize(11).font('Helvetica').text(categoryLabel, 50, 52);

    doc.fillColor('#111827').rect(50, 100, doc.page.width - 100, 55).stroke('#E5E7EB');
    doc.fontSize(10).font('Helvetica');
    doc.text(`Receipt No: ${String(paymentRecordId).slice(0, 8).toUpperCase()}`, 62, 112);
    doc.text(`Payment Date: ${record.paid_at ? new Date(record.paid_at).toLocaleDateString('en-IN') : '—'}`, 62, 126);
    doc.text(`Method: ${methodLabel}`, 300, 112);
    if (record.razorpay_payment_id) {
      doc.text(`Reference: ${record.razorpay_payment_id}`, 300, 126);
    }
    doc.fillColor('#16A34A').font('Helvetica-Bold').text('STATUS: PAID', 62, 140);

    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text('Building', 50, 175);
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    doc.text(building?.name || 'N/A', 50, 191);
    doc.text(building?.address || '', 50, 205);

    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(12).text('Resident', 300, 175);
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    doc.text(`Name: ${userDisplayName(user)}`, 300, 191);
    doc.text(`Flat: ${user?.flat_no || 'N/A'}  |  Phone: ${user?.phone || 'N/A'}`, 300, 205);

    doc.rect(50, 235, doc.page.width - 100, 26).fill('#F3F4F6');
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(11);
    doc.text('Description', 62, 243);
    doc.text('Period', 240, 243);
    doc.text('Due Date', 360, 243);
    doc.text('Amount', 470, 243);

    let rowY = 261;
    doc.rect(50, rowY, doc.page.width - 100, 28).stroke('#E5E7EB');
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    doc.text(bill?.description || 'Bill', 62, rowY + 9);
    doc.text(bill?.month ? `${MONTHS[bill.month]} ${bill.year}` : '—', 240, rowY + 9);
    doc.text(bill?.due_date || '—', 360, rowY + 9);
    doc.text(`Rs. ${baseAmount.toLocaleString('en-IN')}`, 470, rowY + 9);
    rowY += 28;

    if (penaltyAmount > 0) {
      doc.rect(50, rowY, doc.page.width - 100, 28).stroke('#E5E7EB');
      doc.fillColor('#B45309').font('Helvetica-Oblique');
      doc.text('Late-payment penalty', 62, rowY + 9);
      doc.fillColor('#374151').font('Helvetica');
      doc.text('—', 240, rowY + 9);
      doc.text('—', 360, rowY + 9);
      doc.fillColor('#B45309').font('Helvetica-Bold');
      doc.text(`Rs. ${penaltyAmount.toLocaleString('en-IN')}`, 470, rowY + 9);
      rowY += 28;
    }

    rowY += 12;
    doc.rect(50, rowY, doc.page.width - 100, 36).fill('#1E3A8A');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(13);
    doc.text('Total Paid', 62, rowY + 11);
    doc.text(`Rs. ${totalAmount.toLocaleString('en-IN')}`, 470, rowY + 11);

    doc.fillColor('#9CA3AF').font('Helvetica').fontSize(9);
    doc.text('This is a computer-generated receipt. No signature required.', 50, rowY + 70, {
      align: 'center',
      width: doc.page.width - 100,
    });
    doc.text(`Generated on ${new Date().toLocaleString('en-IN')}`, 50, rowY + 83, {
      align: 'center',
      width: doc.page.width - 100,
    });

    doc.end();
  });
}

const RECEIPT_SELECT =
  '*, maintenance_bills(month, year, amount, due_date, description, category, penalty_amount), users!maintenance_payments_user_id_fkey(name, flat_no, email, phone), buildings(name, address)';

/**
 * Best-effort: email the PDF receipt to the resident. Never throws.
 */
async function sendPaymentReceiptEmail(paymentRecordId) {
  try {
    if (!paymentRecordId) return;
    const { data: record, error } = await supabase
      .from('maintenance_payments')
      .select(RECEIPT_SELECT)
      .eq('id', paymentRecordId)
      .single();

    if (error || !record) {
      console.error('[mail] receipt: record not found', paymentRecordId, error?.message);
      return;
    }
    if (record.status !== 'paid') return;

    const to = record.users?.email?.trim();
    if (!to) {
      console.warn('[mail] receipt: no email for payment', paymentRecordId);
      return;
    }

    const bill = record.maintenance_bills;
    const totalAmount = Number(
      record.total_amount ?? (Number(record.amount || 0) + Number(record.penalty_amount || 0)),
    );
    const period = bill?.month ? `${MONTHS[bill.month]} ${bill.year}` : (bill?.description || 'your bill');
    const buildingName = record.buildings?.name || 'your society';
    const methodLabel = methodLabelFromRecord(record);
    const pdf = await buildReceiptPdfBuffer(record);
    const shortId = String(paymentRecordId).slice(0, 8).toUpperCase();

    await sendMail({
      to,
      subject: `Payment Receipt — ${buildingName} (${period})`,
      html: `
        <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;background:#f5f7fa;border-radius:12px">
          <h2 style="color:#1E3A8A;margin:0 0 8px">Payment receipt</h2>
          <p style="color:#374151;margin:0 0 16px">
            Your payment of <strong>₹${escapeHtml(totalAmount.toLocaleString('en-IN'))}</strong>
            for <strong>${escapeHtml(period)}</strong> (${escapeHtml(methodLabel)}) is confirmed.
          </p>
          <p style="color:#374151;margin:0 0 8px">Receipt No: <strong>${escapeHtml(shortId)}</strong></p>
          <p style="color:#6B7280;font-size:13px;margin:16px 0 0">The PDF receipt is attached. You can also download it from the My Building app.</p>
        </div>
      `,
      text: `Payment receipt for ${period}. Amount: ₹${totalAmount.toLocaleString('en-IN')}. Method: ${methodLabel}. Receipt No: ${shortId}. PDF attached.`,
      attachments: [
        {
          filename: `receipt_${shortId.toLowerCase()}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });
  } catch (err) {
    console.error('[mail] receipt email failed:', err.message || err);
  }
}

module.exports = {
  buildReceiptPdfBuffer,
  sendPaymentReceiptEmail,
  RECEIPT_SELECT,
  methodLabelFromRecord,
  categoryLabelFromBill,
};
