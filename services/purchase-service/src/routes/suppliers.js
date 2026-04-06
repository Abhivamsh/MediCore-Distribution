'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ success: false, errors: errors.array() }); return false; }
  return true;
}

router.get('/', async (req, res, next) => {
  try {
    const result = await req.db.query('SELECT * FROM suppliers WHERE is_active = true ORDER BY name');
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

router.post('/', [
  body('name').trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().trim(),
], async (req, res, next) => {
  if (!validate(req, res)) return;
  const { name, contactName, email, phone, address } = req.body;
  try {
    const result = await req.db.query(
      'INSERT INTO suppliers (name, contact_name, email, phone, address) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, contactName || null, email || null, phone || null, address || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
