'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const ROLES = ['super_admin', 'regional_manager', 'inventory_manager', 'pharmacist'];
const SALT_ROUNDS = 12;
const TOKEN_CACHE_TTL = 900; // 15 minutes in seconds

// ─── Rate Limiters ────────────────────────────────────────────────────────────
// Strict limit for auth mutation endpoints (brute-force protection)
const authMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
});

// Moderate limit for token refresh (prevents refresh token flooding)
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many refresh requests.' },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateTokens(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    branchId: user.branch_id,
  };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });
  const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
  return { accessToken, refreshToken };
}

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ success: false, errors: errors.array() });
    return false;
  }
  return true;
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post(
  '/register',
  authMutationLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').isIn(ROLES).withMessage(`Role must be one of: ${ROLES.join(', ')}`),
    body('branchId').optional().isInt({ min: 1, max: 18 }),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { email, password, role, branchId } = req.body;
    try {
      const exists = await req.db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (exists.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Email already registered' });
      }
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const result = await req.db.query(
        `INSERT INTO users (email, password, role, branch_id) VALUES ($1, $2, $3, $4) RETURNING id, email, role, branch_id, created_at`,
        [email, hashedPassword, role, branchId || null]
      );
      const user = result.rows[0];
      const { accessToken, refreshToken } = generateTokens(user);

      // Store hashed refresh token
      const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await req.db.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshHash, expiresAt]
      );

      res.status(201).json({
        success: true,
        data: { user: { id: user.id, email: user.email, role: user.role, branchId: user.branch_id }, accessToken, refreshToken },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post(
  '/login',
  authMutationLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { email, password } = req.body;
    try {
      const result = await req.db.query(
        'SELECT id, email, password, role, branch_id, is_active FROM users WHERE email = $1',
        [email]
      );
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ success: false, message: 'Invalid email or password' });
      }
      if (!user.is_active) {
        return res.status(403).json({ success: false, message: 'Account is deactivated' });
      }

      await req.db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

      const { accessToken, refreshToken } = generateTokens(user);
      const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await req.db.query(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [user.id, refreshHash, expiresAt]
      );

      // Cache user info in Redis
      if (req.redis.status === 'ready') {
        await req.redis.setex(
          `user:${user.id}`,
          TOKEN_CACHE_TTL,
          JSON.stringify({ id: user.id, email: user.email, role: user.role, branchId: user.branch_id })
        );
      }

      res.json({
        success: true,
        data: { user: { id: user.id, email: user.email, role: user.role, branchId: user.branch_id }, accessToken, refreshToken },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', refreshLimiter, [body('refreshToken').notEmpty()], async (req, res, next) => {
  if (!validate(req, res)) return;
  const { refreshToken } = req.body;
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const result = await req.db.query(
      'SELECT rt.id, u.id as user_id, u.email, u.role, u.branch_id, u.is_active FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.user_id = $1 AND rt.token_hash = $2 AND rt.expires_at > NOW()',
      [decoded.userId, tokenHash]
    );
    if (!result.rows[0] || !result.rows[0].is_active) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const user = result.rows[0];
    // Rotate refresh token
    await req.db.query('DELETE FROM refresh_tokens WHERE id = $1', [result.rows[0].id]);
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    const newHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await req.db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.user_id, newHash, expiresAt]
    );

    res.json({ success: true, data: { accessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }
    next(err);
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', [body('refreshToken').notEmpty()], async (req, res, next) => {
  if (!validate(req, res)) return;
  const { refreshToken } = req.body;
  try {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await req.db.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ success: false, message: 'Not authenticated' });
  try {
    // Try cache first
    if (req.redis.status === 'ready') {
      const cached = await req.redis.get(`user:${userId}`);
      if (cached) return res.json({ success: true, data: JSON.parse(cached) });
    }
    const result = await req.db.query(
      'SELECT id, email, role, branch_id, last_login, created_at FROM users WHERE id = $1',
      [userId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
