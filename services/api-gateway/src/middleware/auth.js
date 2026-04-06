'use strict';

const jwt = require('jsonwebtoken');

/**
 * Verify JWT token – used by API Gateway before forwarding requests.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Forward user context to downstream services via headers
    req.headers['x-user-id']     = String(decoded.userId);
    req.headers['x-user-role']   = decoded.role;
    req.headers['x-branch-id']   = String(decoded.branchId || '');
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

module.exports = { authenticate };
