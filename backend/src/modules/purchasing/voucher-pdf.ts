import PDFDocument from 'pdfkit';

export interface VoucherPdfData {
  voucherNo: string;
  voucherDate: string;
  status: string;
  supplierCode: string;
  supplierName: string;
  supplierPhoneSnap: string | null;
  inspectionNo: string;
  coffeeTypeName: string;
  gradeCode: string | null;
  totalWeightKg: string;
  totalAmount: string;
  scaleWarning: string | null;
  lot: { lotNumber: string } | null;
  items: {
    lineNo: number; coffeeTypeName: string; gradeCode: string | null; weightKg: string; pricePerKg: string; amount: string;
    weighings: { scaleCode: string; grossKg: string; tareKg: string; netKg: string; weighedAt: Date }[];
  }[];
  weighingClerkName: string;
  qualityInspectorName: string;
  verifiedByName: string | null;
  verifiedAt: Date | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  cashierName: string | null;
}

const fmtTime = (d: Date | null, tz: string) =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(d) : '';

/** Printable purchase voucher (PDFKit, rendered synchronously in the request — ARCHITECTURE.md §13). */
export function renderVoucherPdf(v: VoucherPdfData, opts: { currency: string; timeZone: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Purchase voucher ${v.voucherNo}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.fontSize(16).font('Helvetica-Bold').text('Coffee Washing Station', { align: 'center' });
    doc.fontSize(12).text('RED CHERRY PURCHASE VOUCHER', { align: 'center' });
    doc.moveDown(0.5);
    if (!['APPROVED', 'PAID'].includes(v.status)) {
      doc.fontSize(11).fillColor('#b71c1c').text(`${v.status} — not valid for payment`, { align: 'center' }).fillColor('black');
    }
    doc.moveDown();

    const field = (label: string, value: string) => {
      doc.font('Helvetica-Bold').fontSize(10).text(`${label}: `, { continued: true }).font('Helvetica').text(value);
    };
    field('Voucher no.', v.voucherNo);
    field('Date', v.voucherDate);
    field('Status', v.status);
    field('Supplier', `${v.supplierName} (${v.supplierCode})${v.supplierPhoneSnap ? ` · ${v.supplierPhoneSnap}` : ''}`);
    field('Quality inspection', v.inspectionNo);
    field('Coffee', `${v.coffeeTypeName}${v.gradeCode ? ` · grade ${v.gradeCode}` : ''}`);
    if (v.lot) field('Lot', v.lot.lotNumber);
    doc.moveDown();

    // Lines
    const cols = [left, left + 30, left + 190, left + 250, left + 340, left + 420];
    const header = ['#', 'Coffee', 'Grade', 'Weight (kg)', `Price/kg (${opts.currency})`, `Amount (${opts.currency})`];
    let y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    header.forEach((h, i) => doc.text(h, cols[i]!, y, { width: (cols[i + 1] ?? left + width) - cols[i]! - 4, align: i >= 3 ? 'right' : 'left' }));
    y += 16;
    doc.moveTo(left, y - 3).lineTo(left + width, y - 3).stroke();
    doc.font('Helvetica');
    for (const it of v.items) {
      const cells = [String(it.lineNo), it.coffeeTypeName, it.gradeCode ?? '—', it.weightKg, it.pricePerKg, it.amount];
      cells.forEach((c, i) => doc.text(c, cols[i]!, y, { width: (cols[i + 1] ?? left + width) - cols[i]! - 4, align: i >= 3 ? 'right' : 'left' }));
      y += 14;
      for (const w of it.weighings) {
        doc.fontSize(8).fillColor('#555')
          .text(`scale ${w.scaleCode} · gross ${w.grossKg} − tare ${w.tareKg} = net ${w.netKg} kg · ${fmtTime(w.weighedAt, opts.timeZone)}`, cols[1]!, y);
        doc.fontSize(9).fillColor('black');
        y += 12;
      }
      y += 2;
    }
    doc.moveTo(left, y).lineTo(left + width, y).stroke();
    y += 6;
    doc.font('Helvetica-Bold');
    doc.text('Total', cols[1]!, y);
    doc.text(v.totalWeightKg, cols[3]!, y, { width: cols[4]! - cols[3]! - 4, align: 'right' });
    doc.text(v.totalAmount, cols[5]!, y, { width: left + width - cols[5]! - 4, align: 'right' });
    doc.font('Helvetica').text('', left, y + 24);

    if (v.scaleWarning) {
      doc.moveDown().fontSize(9).fillColor('#e65100').text(`Scale warning: ${v.scaleWarning}`).fillColor('black');
    }

    // Signatures
    doc.moveDown(2).fontSize(10);
    const sig = (role: string, name: string | null, at?: Date | null) => {
      doc.font('Helvetica-Bold').text(role, { continued: true }).font('Helvetica')
        .text(`  ${name ?? '________________________'}${at ? `  (${fmtTime(at, opts.timeZone)})` : ''}    Signature: ______________`);
      doc.moveDown(0.8);
    };
    sig('Weighing clerk:', v.weighingClerkName);
    sig('Quality inspector:', v.qualityInspectorName);
    sig('Verified by:', v.verifiedByName, v.verifiedAt);
    sig('Approved by:', v.approvedByName, v.approvedAt);
    sig('Paid by (cashier):', v.cashierName);
    sig('Supplier:', v.supplierName);

    doc.fontSize(7).fillColor('#777').text(`Printed ${fmtTime(new Date(), opts.timeZone)} · Total = Σ weight × price/kg`, left, doc.page.height - 50, { align: 'center', width });
    doc.end();
  });
}
