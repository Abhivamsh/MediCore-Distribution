'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ success: false, errors: errors.array() }); return false; }
  return true;
}

// ─── GET /api/inventory/transfers ─────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  try {
    const params = [];
    let sql = `SELECT t.*, p.name as product_name, p.sku FROM stock_transfers t JOIN products p ON p.id = t.product_id WHERE 1=1`;
    if (status) { params.push(status); sql += ` AND t.status = $${params.length}`; }
    params.push(parseInt(limit, 10)); sql += ` ORDER BY t.created_at DESC LIMIT $${params.length}`;
    params.push(offset); sql += ` OFFSET $${params.length}`;
    const result = await req.db.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// ─── POST /api/inventory/transfers ────────────────────────────────────────────
router.post(
  '/',
  [
    body('productId').isInt(),
    body('fromBranchId').isInt({ min: 1, max: 18 }),
    body('toBranchId').isInt({ min: 1, max: 18 }),
    body('quantity').isInt({ min: 1 }),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { productId, fromBranchId, toBranchId, quantity, notes } = req.body;
    const userId = req.headers['x-user-id'];

    const client = await req.db.connect();
    try {
      await client.query('BEGIN');

      // Check source stock
      const stockCheck = await client.query(
        `SELECT SUM(quantity)::int as total FROM stock WHERE product_id = $1 AND branch_id = $2`,
        [productId, fromBranchId]
      );
      if (!stockCheck.rows[0] || stockCheck.rows[0].total < quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Insufficient stock at source branch' });
      }

      const result = await client.query(
        `INSERT INTO stock_transfers (product_id, from_branch_id, to_branch_id, quantity, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [productId, fromBranchId, toBranchId, quantity, notes || null, userId || null]
      );

      await client.query('COMMIT');

      await req.mq.publish('inventory.transfer.created', {
        transferId: result.rows[0].id, productId, fromBranchId, toBranchId, quantity,
      });

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// ─── PATCH /api/inventory/transfers/:id/approve ───────────────────────────────
router.patch('/:id/approve', [param('id').isInt()], async (req, res, next) => {
  if (!validate(req, res)) return;
  const userId = req.headers['x-user-id'];
  const client = await req.db.connect();
  try {
    await client.query('BEGIN');
    const transfer = await client.query('SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!transfer.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Transfer not found' }); }
    if (transfer.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Transfer is not pending' }); }

    const t = transfer.rows[0];

    // Deduct from source
    await client.query(`UPDATE stock SET quantity = quantity - $1, updated_at = NOW() WHERE product_id = $2 AND branch_id = $3`, [t.quantity, t.product_id, t.from_branch_id]);
    // Add to destination
    await client.query(
      `INSERT INTO stock (product_id, branch_id, quantity, batch_number) VALUES ($1, $2, $3, 'transfer')
       ON CONFLICT (product_id, branch_id, batch_number) DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity, updated_at = NOW()`,
      [t.product_id, t.to_branch_id, t.quantity]
    );

    await client.query(`UPDATE stock_transfers SET status = 'approved', approved_by = $1, updated_at = NOW() WHERE id = $2`, [userId, req.params.id]);
    await client.query('COMMIT');

    await req.mq.publish('inventory.transfer.approved', { transferId: t.id });
    res.json({ success: true, message: 'Transfer approved and stock updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
