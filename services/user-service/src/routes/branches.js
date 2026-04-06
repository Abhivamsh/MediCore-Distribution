'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');

const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ success: false, errors: errors.array() }); return false; }
  return true;
}

// ─── GET /api/branches ─────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const result = await req.db.query(
      'SELECT id, name, code, address, city, state, is_active, manager_id, created_at FROM branches ORDER BY id'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// ─── GET /api/branches/:id ─────────────────────────────────────────────────────
router.get('/:id', [param('id').isInt()], async (req, res, next) => {
  if (!validate(req, res)) return;
  try {
    const result = await req.db.query(
      'SELECT b.*, COUNT(u.id)::int as user_count FROM branches b LEFT JOIN users u ON u.branch_id = b.id WHERE b.id = $1 GROUP BY b.id',
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Branch not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

// ─── POST /api/branches ────────────────────────────────────────────────────────
router.post(
  '/',
  [
    body('name').trim().notEmpty(),
    body('code').trim().toUpperCase().notEmpty(),
    body('city').optional().trim(),
    body('state').optional().trim(),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { name, code, address, city, state } = req.body;
    try {
      const result = await req.db.query(
        'INSERT INTO branches (name, code, address, city, state) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [name, code, address || null, city || null, state || null]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) { next(err); }
  }
);

module.exports = router;
