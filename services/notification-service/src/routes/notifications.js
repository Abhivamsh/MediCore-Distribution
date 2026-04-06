'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ success: false, errors: errors.array() }); return false; }
  return true;
}

// ─── GET /api/notifications ────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const { unreadOnly, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  try {
    const params = [userId];
    let sql = 'SELECT * FROM notifications WHERE user_id = $1';
    if (unreadOnly === 'true') sql += ' AND is_read = false';
    params.push(parseInt(limit, 10)); sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    params.push(offset); sql += ` OFFSET $${params.length}`;
    const result = await req.db.query(sql, params);
    const count = await req.db.query('SELECT COUNT(*)::int FROM notifications WHERE user_id = $1 AND is_read = false', [userId]);
    res.json({ success: true, data: result.rows, unreadCount: count.rows[0].count });
  } catch (err) { next(err); }
});

// ─── PATCH /api/notifications/:id/read ────────────────────────────────────────
router.patch('/:id/read', [param('id').isInt()], async (req, res, next) => {
  if (!validate(req, res)) return;
  const userId = req.headers['x-user-id'];
  try {
    await req.db.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err) { next(err); }
});

// ─── PATCH /api/notifications/read-all ────────────────────────────────────────
router.patch('/read-all', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  try {
    await req.db.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [userId]);
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) { next(err); }
});

// ─── POST /api/notifications/send ─────────────────────────────────────────────
// Internal endpoint: send notification to user(s)
router.post('/send', [
  body('type').notEmpty(),
  body('title').trim().notEmpty(),
  body('message').trim().notEmpty(),
  body('channel').isIn(['in_app', 'email', 'sms']).optional(),
], async (req, res, next) => {
  if (!validate(req, res)) return;
  const { userId, branchId, type, channel = 'in_app', title, message, metadata } = req.body;
  try {
    const result = await req.db.query(
      `INSERT INTO notifications (user_id, branch_id, type, channel, title, message, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId || null, branchId || null, type, channel, title, message, metadata ? JSON.stringify(metadata) : null]
    );

    // Send email if requested and mailer configured
    if (channel === 'email' && metadata?.email && process.env.SMTP_HOST) {
      await req.mailer.sendMail({
        from: process.env.SMTP_USER,
        to: metadata.email,
        subject: title,
        text: message,
      }).catch((err) => req.logger.warn('Email send failed', { error: err.message }));
    }

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
