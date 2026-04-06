'use strict';

const jwt = require('jsonwebtoken');

const ROLES = {
  SUPER_ADMIN: 'super_admin',
  REGIONAL_MANAGER: 'regional_manager',
  INVENTORY_MANAGER: 'inventory_manager',
  PHARMACIST: 'pharmacist',
};

const ROLE_HIERARCHY = {
  [ROLES.SUPER_ADMIN]: 4,
  [ROLES.REGIONAL_MANAGER]: 3,
  [ROLES.INVENTORY_MANAGER]: 2,
  [ROLES.PHARMACIST]: 1,
};

/**
 * Middleware: verify JWT and attach user to req.user
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

/**
 * Middleware factory: restrict access to specific roles.
 * @param {...string} roles
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${roles.join(', ')}`,
      });
    }
    next();
  };
}

/**
 * Middleware factory: restrict access based on minimum role level.
 * @param {string} minRole
 */
function authorizeMinRole(minRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] || 0;
    if (userLevel < requiredLevel) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Minimum required role: ${minRole}`,
      });
    }
    next();
  };
}

/**
 * Middleware: restrict access to own branch data unless Super Admin or Regional Manager.
 */
function restrictBranch(req, res, next) {
  const { role, branchId } = req.user;
  const requestedBranch = req.params.branchId || req.query.branchId || req.body.branchId;

  if (!requestedBranch) return next();

  if (role === ROLES.SUPER_ADMIN || role === ROLES.REGIONAL_MANAGER) {
    return next();
  }

  if (String(branchId) !== String(requestedBranch)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only access data from your assigned branch.',
    });
  }
  next();
}

module.exports = { authenticate, authorize, authorizeMinRole, restrictBranch, ROLES, ROLE_HIERARCHY };
