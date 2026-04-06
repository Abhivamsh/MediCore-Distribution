'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ success: false, errors: errors.array() }); return false; }
  return true;
}

function generatePoNumber(branchId) {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `PO-${String(branchId).padStart(2, '0')}-${ymd}-${rand}`;
}

// ─── GET /api/purchases ────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  const role = req.headers['x-user-role'];
  const userBranch = req.headers['x-branch-id'];
  const { branchId, status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  try {
    const params = [];
    let sql = `SELECT po.id, po.po_number, po.branch_id, s.name as supplier_name, po.status, po.total, po.expected_date, po.created_at
               FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE 1=1`;

    const effectiveBranch = (role === 'super_admin' || role === 'regional_manager') ? branchId || null : userBranch;
    if (effectiveBranch) { params.push(effectiveBranch); sql += ` AND po.branch_id = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND po.status = $${params.length}`; }

    params.push(parseInt(limit, 10)); sql += ` ORDER BY po.created_at DESC LIMIT $${params.length}`;
    params.push(offset); sql += ` OFFSET $${params.length}`;
    const result = await req.db.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// ─── GET /api/purchases/:id ───────────────────────────────────────────────────
router.get('/:id', [param('id').isInt()], async (req, res, next) => {
  if (!validate(req, res)) return;
  try {
    const po = await req.db.query('SELECT po.*, s.name as supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = $1', [req.params.id]);
    if (!po.rows[0]) return res.status(404).json({ success: false, message: 'Purchase order not found' });
    const items = await req.db.query('SELECT * FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    res.json({ success: true, data: { ...po.rows[0], items: items.rows } });
  } catch (err) { next(err); }
});

// ─── POST /api/purchases ──────────────────────────────────────────────────────
router.post('/', [
  body('supplierId').isInt(),
  body('branchId').isInt({ min: 1, max: 18 }),
  body('items').isArray({ min: 1 }),
  body('items.*.productId').isInt(),
  body('items.*.productName').trim().notEmpty(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('items.*.unitPrice').isFloat({ min: 0 }),
], async (req, res, next) => {
  if (!validate(req, res)) return;
  const { supplierId, branchId, items, expectedDate, tax = 0, notes } = req.body;
  const userId = req.headers['x-user-id'];

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const total = subtotal + tax;
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const poResult = await client.query(
      `INSERT INTO purchase_orders (po_number, supplier_id, branch_id, subtotal, tax, total, expected_date, created_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [generatePoNumber(branchId), supplierId, branchId, subtotal, tax, total, expectedDate || null, userId || null, notes || null]
    );
    const po = poResult.rows[0];
    for (const item of items) {
      await client.query(
        'INSERT INTO purchase_order_items (po_id, product_id, product_name, quantity, unit_price, total) VALUES ($1, $2, $3, $4, $5, $6)',
        [po.id, item.productId, item.productName, item.quantity, item.unitPrice, item.quantity * item.unitPrice]
      );
    }
    await client.query('COMMIT');
    await req.mq.publish('purchase.order.created', { poId: po.id, poNumber: po.po_number, branchId, supplierId, total });
    res.status(201).json({ success: true, data: { ...po, items } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ─── PATCH /api/purchases/:id/receive ─────────────────────────────────────────
router.patch('/:id/receive', [param('id').isInt()], async (req, res, next) => {
  if (!validate(req, res)) return;
  try {
    const result = await req.db.query(
      `UPDATE purchase_orders SET status = 'received', received_date = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'PO not found' });
    await req.mq.publish('purchase.order.received', { poId: result.rows[0].id, branchId: result.rows[0].branch_id });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
