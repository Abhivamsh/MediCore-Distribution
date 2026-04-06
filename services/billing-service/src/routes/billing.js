'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ success: false, errors: errors.array() }); return false; }
  return true;
}

function generateInvoiceNumber(branchId) {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `INV-${String(branchId).padStart(2, '0')}-${ymd}-${rand}`;
}

// ─── GET /api/billing/invoices ─────────────────────────────────────────────────
router.get('/invoices', async (req, res, next) => {
  const role = req.headers['x-user-role'];
  const userBranch = req.headers['x-branch-id'];
  const { branchId, status, startDate, endDate, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  try {
    const params = [];
    let sql = 'SELECT id, invoice_number, branch_id, customer_name, total, payment_status, status, created_at FROM invoices WHERE 1=1';

    const effectiveBranch = (role === 'super_admin' || role === 'regional_manager') ? branchId || null : userBranch;
    if (effectiveBranch) { params.push(effectiveBranch); sql += ` AND branch_id = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    if (startDate) { params.push(startDate); sql += ` AND created_at >= $${params.length}`; }
    if (endDate) { params.push(endDate); sql += ` AND created_at <= $${params.length}`; }

    params.push(parseInt(limit, 10)); sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    params.push(offset); sql += ` OFFSET $${params.length}`;

    const result = await req.db.query(sql, params);
    res.json({ success: true, data: result.rows, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) { next(err); }
});

// ─── GET /api/billing/invoices/:id ────────────────────────────────────────────
router.get('/invoices/:id', [param('id').isInt()], async (req, res, next) => {
  if (!validate(req, res)) return;
  try {
    const invoice = await req.db.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!invoice.rows[0]) return res.status(404).json({ success: false, message: 'Invoice not found' });
    const items = await req.db.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [req.params.id]);
    res.json({ success: true, data: { ...invoice.rows[0], items: items.rows } });
  } catch (err) { next(err); }
});

// ─── POST /api/billing/invoices ────────────────────────────────────────────────
router.post(
  '/invoices',
  [
    body('branchId').isInt({ min: 1, max: 18 }),
    body('items').isArray({ min: 1 }),
    body('items.*.productId').isInt(),
    body('items.*.productName').trim().notEmpty(),
    body('items.*.quantity').isInt({ min: 1 }),
    body('items.*.unitPrice').isFloat({ min: 0 }),
    body('paymentMethod').isIn(['cash', 'card', 'upi', 'credit']),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { branchId, customerName, customerPhone, items, discount = 0, tax = 0, paymentMethod, notes } = req.body;
    const userId = req.headers['x-user-id'];

    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice - (item.discount || 0)), 0);
    const total = subtotal - discount + tax;

    const client = await req.db.connect();
    try {
      await client.query('BEGIN');

      const invoiceResult = await client.query(
        `INSERT INTO invoices (invoice_number, branch_id, customer_name, customer_phone, subtotal, discount, tax, total, payment_method, payment_status, status, created_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'paid', 'completed', $10, $11) RETURNING *`,
        [generateInvoiceNumber(branchId), branchId, customerName || null, customerPhone || null,
         subtotal, discount, tax, total, paymentMethod, userId || null, notes || null]
      );
      const invoice = invoiceResult.rows[0];

      for (const item of items) {
        await client.query(
          'INSERT INTO invoice_items (invoice_id, product_id, product_name, quantity, unit_price, discount, total) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [invoice.id, item.productId, item.productName, item.quantity, item.unitPrice, item.discount || 0,
           item.quantity * item.unitPrice - (item.discount || 0)]
        );
      }

      await client.query('COMMIT');

      // Publish billing event for inventory deduction and analytics
      await req.mq.publish('billing.invoice.created', {
        invoiceId: invoice.id, invoiceNumber: invoice.invoice_number,
        branchId, items, total, createdBy: userId,
      });

      res.status(201).json({ success: true, data: { ...invoice, items } });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// ─── GET /api/billing/summary ──────────────────────────────────────────────────
router.get('/summary', async (req, res, next) => {
  const role = req.headers['x-user-role'];
  const userBranch = req.headers['x-branch-id'];
  const { branchId, period = 'today' } = req.query;

  const effectiveBranch = (role === 'super_admin' || role === 'regional_manager') ? branchId : userBranch;

  const intervals = { today: '1 day', week: '7 days', month: '30 days' };
  const interval = intervals[period] || '1 day';

  try {
    const params = [interval];
    let sql = `
      SELECT
        COUNT(*)::int as invoice_count,
        COALESCE(SUM(total), 0)::numeric(12,2) as total_revenue,
        COALESCE(AVG(total), 0)::numeric(12,2) as avg_invoice_value,
        COUNT(CASE WHEN payment_status = 'paid' THEN 1 END)::int as paid_count
      FROM invoices
      WHERE created_at >= NOW() - $1::interval AND status = 'completed'
    `;
    if (effectiveBranch) { params.push(effectiveBranch); sql += ` AND branch_id = $${params.length}`; }

    const result = await req.db.query(sql, params);
    res.json({ success: true, data: { period, ...result.rows[0] } });
  } catch (err) { next(err); }
});

module.exports = router;
