'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ success: false, errors: errors.array() }); return false; }
  return true;
}

// ─── GET /api/users ────────────────────────────────────────────────────────────
// Super Admin / Regional Manager can list all; others see own branch
router.get('/', async (req, res, next) => {
  const role = req.headers['x-user-role'];
  const branchId = req.headers['x-branch-id'];
  const { page = 1, limit = 20, role: filterRole, branch } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

  try {
    let queryText = 'SELECT id, email, full_name, phone, role, branch_id, is_active, created_at FROM users WHERE 1=1';
    const params = [];

    if (role !== 'super_admin' && role !== 'regional_manager') {
      params.push(branchId);
      queryText += ` AND branch_id = $${params.length}`;
    } else if (branch) {
      params.push(branch);
      queryText += ` AND branch_id = $${params.length}`;
    }

    if (filterRole) {
      params.push(filterRole);
      queryText += ` AND role = $${params.length}`;
    }

    params.push(parseInt(limit, 10));
    queryText += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    params.push(offset);
    queryText += ` OFFSET $${params.length}`;

    const result = await req.db.query(queryText, params);
    res.json({ success: true, data: result.rows, page: parseInt(page, 10), limit: parseInt(limit, 10) });
  } catch (err) { next(err); }
});

// ─── GET /api/users/:id ────────────────────────────────────────────────────────
router.get('/:id', [param('id').isInt()], async (req, res, next) => {
  if (!validate(req, res)) return;
  try {
    const result = await req.db.query(
      'SELECT id, email, full_name, phone, role, branch_id, is_active, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/users ───────────────────────────────────────────────────────────
router.post(
  '/',
  [
    body('authUserId').isInt(),
    body('email').isEmail().normalizeEmail(),
    body('fullName').trim().notEmpty(),
    body('role').isIn(['super_admin', 'regional_manager', 'inventory_manager', 'pharmacist']),
    body('branchId').optional().isInt({ min: 1, max: 18 }),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { authUserId, email, fullName, phone, role, branchId } = req.body;
    try {
      const result = await req.db.query(
        `INSERT INTO users (auth_user_id, email, full_name, phone, role, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, full_name, role, branch_id, created_at`,
        [authUserId, email, fullName, phone || null, role, branchId || null]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) { next(err); }
  }
);

// ─── PATCH /api/users/:id ──────────────────────────────────────────────────────
router.patch(
  '/:id',
  [param('id').isInt(), body('fullName').optional().trim().notEmpty(), body('phone').optional().trim()],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { fullName, phone, isActive } = req.body;
    try {
      const result = await req.db.query(
        `UPDATE users SET
          full_name = COALESCE($1, full_name),
          phone = COALESCE($2, phone),
          is_active = COALESCE($3, is_active),
          updated_at = NOW()
         WHERE id = $4
         RETURNING id, email, full_name, phone, role, branch_id, is_active`,
        [fullName || null, phone || null, isActive !== undefined ? isActive : null, req.params.id]
      );
      if (!result.rows[0]) return res.status(404).json({ success: false, message: 'User not found' });
      res.json({ success: true, data: result.rows[0] });
    } catch (err) { next(err); }
  }
);

module.exports = router;
