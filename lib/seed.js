// Sample data for the demo workspace. Dates are set relative to today so the
// dashboard always shows a realistic mix of overdue, due-soon and on-track bills.
import { addDays, todayIST } from './rules.js';

export async function seedInto(api) {
  const T = todayIST();
  const d = (n) => addDays(T, n);
  const at = (n, hm = '10:15') => `${addDays(T, n)}T${hm}:00.000Z`;
  const claude = (n, hm) => ({ actor: 'Claude', actorType: 'claude', at: at(n, hm), internal: true });
  const priya = (n, hm) => ({ actor: 'Priya (Finance)', actorType: 'person', at: at(n, hm), internal: true });

  const rows = [
    // [fields, created by, then steps]
    { f: { supplier_name: 'Sharma Packaging Pvt Ltd', supplier_pan: 'AAKCS4821M', supplier_gstin: '29AAKCS4821M1Z3', udyam_number: 'UDYAM-KR-03-0048211', mse_category: 'micro', supplier_type: 'manufacturer', invoice_number: 'SP/26-27/0412', invoice_date: d(-52), acceptance_date: d(-50), amount: 482000, written_agreement: true, agreed_days: 45, delay_reason: 'Waiting for the supplier to send the corrected e-way bill' }, by: claude(-49), approve: priya(-49, '11:40') },
    { f: { supplier_name: 'Kaveri Print Works', supplier_pan: 'AAGFK7730Q', supplier_gstin: '29AAGFK7730Q1Z8', udyam_number: 'UDYAM-KR-03-0102245', mse_category: 'small', supplier_type: 'service', invoice_number: 'KPW-1187', invoice_date: d(-19), acceptance_date: d(-18), amount: 96500, written_agreement: false }, by: claude(-17), approve: priya(-17, '12:05') },
    { f: { supplier_name: 'Deccan Fasteners', supplier_pan: 'AAFCD2219K', supplier_gstin: '36AAFCD2219K1Z1', udyam_number: 'UDYAM-TS-09-0031877', mse_category: 'small', supplier_type: 'manufacturer', invoice_number: 'DF/2611', invoice_date: d(-28), acceptance_date: d(-26), amount: 215400, written_agreement: true, agreed_days: 30 }, by: claude(-25), approve: priya(-25, '15:20') },
    { f: { supplier_name: 'Bluepeak IT Services', supplier_pan: 'AAJFB9034H', supplier_gstin: '29AAJFB9034H1Z6', udyam_number: 'UDYAM-KR-03-0220918', mse_category: 'micro', supplier_type: 'service', invoice_number: 'BP-INV-0093', invoice_date: d(-41), acceptance_date: d(-40), amount: 148000, written_agreement: true, agreed_days: 60, notes: 'Contract says 60 days. The law caps it at 45.' }, by: priya(-39), approve: priya(-39, '10:30') },
    { f: { supplier_name: 'Annapurna Caterers', supplier_pan: 'ABDPA5512C', udyam_number: 'UDYAM-KR-03-0345120', mse_category: 'micro', supplier_type: 'service', invoice_number: 'AC/771', invoice_date: d(-9), acceptance_date: d(-9), amount: 38750, written_agreement: false }, by: claude(-8), approve: priya(-8, '16:45') },
    { f: { supplier_name: 'Nirmal Tools & Dies', supplier_pan: 'AAECN6170F', supplier_gstin: '27AAECN6170F1Z9', udyam_number: 'UDYAM-MH-26-0077431', mse_category: 'small', supplier_type: 'manufacturer', invoice_number: 'NTD/2026/558', invoice_date: d(-12), acceptance_date: d(-10), amount: 620000, written_agreement: true, agreed_days: 45 }, by: claude(-9), approve: priya(-9, '11:10') },
    { f: { supplier_name: 'Sunrise Logistics', supplier_pan: 'AAQFS3308L', supplier_gstin: '33AAQFS3308L1Z4', udyam_number: 'UDYAM-TN-02-0190034', mse_category: 'small', supplier_type: 'service', invoice_number: 'SL-90214', invoice_date: d(-6), acceptance_date: d(-5), amount: 182300, written_agreement: true, agreed_days: 30 }, by: claude(-4), edit: [priya(-4, '14:02'), { acceptance_date: d(-5), amount: 182300, supplier_gstin: '33AAQFS3308L1Z4' }, { amount: 183200 }] },
    { f: { supplier_name: 'Greenleaf Office Supplies', supplier_pan: 'AANFG4416R', supplier_gstin: '29AANFG4416R1Z2', udyam_number: 'UDYAM-KR-03-0411876', mse_category: 'micro', supplier_type: 'trader', invoice_number: 'GL/8841', invoice_date: d(-14), acceptance_date: d(-14), amount: 27900, written_agreement: false }, by: claude(-13), approve: priya(-13, '09:50') },
    { f: { supplier_name: 'Vertex Engineering Ltd', supplier_pan: 'AABCV1150D', supplier_gstin: '27AABCV1150D1Z7', udyam_number: 'UDYAM-MH-18-0009127', mse_category: 'medium', supplier_type: 'manufacturer', invoice_number: 'VEL-23117', invoice_date: d(-21), acceptance_date: d(-20), amount: 940000, written_agreement: true, agreed_days: 60 }, by: priya(-19), approve: priya(-19, '10:20') },
    { f: { supplier_name: 'Malabar Coir Exports', supplier_gstin: '32AAHFM6025B1Z5', mse_category: 'unknown', supplier_type: 'unknown', invoice_number: 'MCE/1204', invoice_date: d(-12), amount: 74200, written_agreement: false, notes: 'Invoice does not show an acceptance date or a Udyam number.' }, by: claude(-1, '09:42') },
    { f: { supplier_name: 'Orbit Electricals', supplier_pan: 'AADCO8842P', supplier_gstin: '24AADCO8842P1Z0', udyam_number: 'UDYAM-GJ-01-0156720', mse_category: 'micro', supplier_type: 'manufacturer', invoice_number: 'OE/3390', invoice_date: d(-71), acceptance_date: d(-70), amount: 310000, written_agreement: true, agreed_days: 45 }, by: claude(-69), approve: priya(-69, '13:15'), paid: [d(-30), priya(-30, '17:05')] },
    { f: { supplier_name: 'Tulsi Textiles', supplier_pan: 'AAHFT2764J', supplier_gstin: '24AAHFT2764J1Z6', udyam_number: 'UDYAM-GJ-22-0098455', mse_category: 'small', supplier_type: 'manufacturer', invoice_number: 'TT-0672', invoice_date: d(-61), acceptance_date: d(-60), amount: 264000, written_agreement: false, delay_reason: 'Invoice was on hold during a quality dispute' }, by: claude(-59), approve: priya(-59, '11:25'), paid: [d(-20), priya(-20, '16:30')] },
  ];

  for (const r of rows) {
    const first = r.edit ? { ...r.f, ...r.edit[1], amount: r.edit[2].amount } : r.f;
    const { bill } = await api.createBill(first, r.by);
    if (r.edit) await api.updateBill(bill.id, { amount: r.f.amount }, r.edit[0]);
    if (r.approve) await api.approveBill(bill.id, r.approve);
    if (r.paid) await api.markPaid(bill.id, r.paid[0], r.paid[1]);
  }
}
