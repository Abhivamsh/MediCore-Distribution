'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ success: false, errors: errors.array() }); return false; }
  return true;
}

// ─── GET /api/inventory ────────────────────────────────────────────────────────
// Returns stock levels; branch-scoped for non-admin roles
router.get('/', async (req, res, next) => {
  const role = req.headers['x-user-role'];
  const userBranch = req.headers['x-branch-id'];
  const { branchId, lowStock, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  try {
    const params = [];
    let sql = `
      SELECT p.id, p.sku, p.name, p.category, p.unit, p.unit_price, p.reorder_level,
             s.branch_id, s.quantity, s.batch_number, s.expiry_date,
             CASE WHEN s.quantity <= p.reorder_level THEN true ELSE false END as low_stock
      FROM products p
      JOIN stock s ON s.product_id = p.id
      WHERE p.is_active = true
    `;

    const effectiveBranch =
      role === 'super_admin' || role === 'regional_manager'
        ? branchId || null
        : userBranch;

    if (effectiveBranch) {
      params.push(effectiveBranch);
      sql += ` AND s.branch_id = $${params.length}`;
    }

    if (lowStock === 'true') {
      sql += ' AND s.quantity <= p.reorder_level';
    }

    params.push(parseInt(limit, 10));
    sql += ` ORDER BY p.name LIMIT $${params.length}`;
    params.push(offset);
    sql += ` OFFSET $${params.length}`;

    const result = await req.db.query(sql, params);
    res.json({ success: true, data: result.rows, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) { next(err); }
});

// ─── GET /api/inventory/products/:id ──────────────────────────────────────────
router.get('/products/:id', [param('id').isInt()], async (req, res, next) => {
  if (!validate(req, res)) return;
  try {
    const result = await req.db.query(
      `SELECT p.*, json_agg(json_build_object('branch_id', s.branch_id, 'quantity', s.quantity, 'batch_number', s.batch_number, 'expiry_date', s.expiry_date)) as stock
       FROM products p LEFT JOIN stock s ON s.product_id = p.id
       WHERE p.id = $1 GROUP BY p.id`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Product not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/inventory/products ─────────────────────────────────────────────
router.post(
  '/products',
  [
    body('sku').trim().notEmpty(),
    body('name').trim().notEmpty(),
    body('unitPrice').isFloat({ min: 0 }),
    body('reorderLevel').isInt({ min: 0 }),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { sku, name, category, manufacturer, unit, unitPrice, reorderLevel } = req.body;
    try {
      const result = await req.db.query(
        `INSERT INTO products (sku, name, category, manufacturer, unit, unit_price, reorder_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [sku, name, category || null, manufacturer || null, unit || 'units', unitPrice, reorderLevel]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) { next(err); }
  }
);

// ─── POST /api/inventory/stock/adjust ─────────────────────────────────────────
// Adjust stock (receive, dispense, adjust)
router.post(
  '/stock/adjust',
  [
    body('productId').isInt(),
    body('branchId').isInt({ min: 1, max: 18 }),
    body('quantity').isInt(),
    body('movementType').isIn(['receive', 'dispense', 'adjust', 'transfer_in', 'transfer_out']),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { productId, branchId, quantity, movementType, batchNumber, referenceId, referenceType, notes } = req.body;
    const userId = req.headers['x-user-id'];

    const client = await req.db.connect();
    try {
      await client.query('BEGIN');

      // Upsert stock
      const stockResult = await client.query(
        `INSERT INTO stock (product_id, branch_id, quantity, batch_number)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, branch_id, batch_number)
         DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity, updated_at = NOW()
         RETURNING *`,
        [productId, branchId, quantity, batchNumber || 'default']
      );

      // Record movement
      await client.query(
        `INSERT INTO stock_movements (product_id, branch_id, movement_type, quantity, reference_id, reference_type, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [productId, branchId, movementType, quantity, referenceId || null, referenceType || null, notes || null, userId || null]
      );

      await client.query('COMMIT');

      // Publish event
      await req.mq.publish('inventory.updated', {
        productId, branchId, quantity: stockResult.rows[0].quantity, movementType,
      });

      res.json({ success: true, data: stockResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

// ─── GET /api/inventory/alerts ─────────────────────────────────────────────────
router.get('/alerts', async (req, res, next) => {
  try {
    const result = await req.db.query(`
      SELECT p.id as product_id, p.sku, p.name, p.reorder_level,
             s.branch_id, s.quantity,
             CASE WHEN s.quantity = 0 THEN 'out_of_stock' ELSE 'low_stock' END as alert_type
      FROM products p
      JOIN stock s ON s.product_id = p.id
      WHERE s.quantity <= p.reorder_level AND p.is_active = true
      ORDER BY s.quantity ASC
    `);
    res.json({ success: true, data: result.rows, count: result.rowCount });
  } catch (err) { next(err); }
});

module.exports = router;
