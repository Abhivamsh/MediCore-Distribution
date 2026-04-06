'use strict';

const express = require('express');
const router = express.Router();

const CACHE_TTL = 300; // 5 minutes

async function cached(redis, key, ttl, fetcher) {
  if (redis.status === 'ready') {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit);
  }
  const data = await fetcher();
  if (redis.status === 'ready') await redis.setex(key, ttl, JSON.stringify(data));
  return data;
}

// ─── GET /api/analytics/dashboard ─────────────────────────────────────────────
router.get('/dashboard', async (req, res, next) => {
  const role = req.headers['x-user-role'];
  const userBranch = req.headers['x-branch-id'];
  const { branchId, period = '30' } = req.query;

  const effectiveBranch = (role === 'super_admin' || role === 'regional_manager') ? branchId : userBranch;
  const cacheKey = `analytics:dashboard:${effectiveBranch || 'all'}:${period}`;

  try {
    const data = await cached(req.redis, cacheKey, CACHE_TTL, async () => {
      const params = [parseInt(period, 10)];
      let branchFilter = '';
      if (effectiveBranch) { params.push(effectiveBranch); branchFilter = ` AND branch_id = $${params.length}`; }

      const salesQuery = `
        SELECT
          COALESCE(SUM(revenue), 0)::numeric(12,2) as total_revenue,
          COALESCE(SUM(invoice_count), 0)::int as total_invoices,
          COALESCE(AVG(revenue), 0)::numeric(12,2) as avg_daily_revenue
        FROM daily_sales_snapshots
        WHERE date >= CURRENT_DATE - $1::int${branchFilter}
      `;
      const salesResult = await req.db.query(salesQuery, params);

      const trendQuery = `
        SELECT date, SUM(revenue)::numeric(12,2) as revenue, SUM(invoice_count)::int as invoice_count
        FROM daily_sales_snapshots
        WHERE date >= CURRENT_DATE - $1::int${branchFilter}
        GROUP BY date ORDER BY date
      `;
      const trendResult = await req.db.query(trendQuery, params);

      return {
        period: parseInt(period, 10),
        summary: salesResult.rows[0],
        trend: trendResult.rows,
      };
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ─── GET /api/analytics/sales/by-branch ───────────────────────────────────────
router.get('/sales/by-branch', async (req, res, next) => {
  const { period = '30' } = req.query;
  const cacheKey = `analytics:sales-by-branch:${period}`;
  try {
    const data = await cached(req.redis, cacheKey, CACHE_TTL, async () => {
      const result = await req.db.query(
        `SELECT branch_id,
           SUM(revenue)::numeric(12,2) as total_revenue,
           SUM(invoice_count)::int as total_invoices
         FROM daily_sales_snapshots
         WHERE date >= CURRENT_DATE - $1::int
         GROUP BY branch_id ORDER BY total_revenue DESC`,
        [parseInt(period, 10)]
      );
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ─── GET /api/analytics/inventory/snapshot ────────────────────────────────────
router.get('/inventory/snapshot', async (req, res, next) => {
  const role = req.headers['x-user-role'];
  const userBranch = req.headers['x-branch-id'];
  const { branchId } = req.query;
  const effectiveBranch = (role === 'super_admin' || role === 'regional_manager') ? branchId : userBranch;
  const cacheKey = `analytics:inventory-snapshot:${effectiveBranch || 'all'}`;
  try {
    const data = await cached(req.redis, cacheKey, 60, async () => {
      const params = [];
      let sql = 'SELECT * FROM inventory_snapshots WHERE date = CURRENT_DATE';
      if (effectiveBranch) { params.push(effectiveBranch); sql += ` AND branch_id = $${params.length}`; }
      const result = await req.db.query(sql, params);
      return result.rows;
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ─── GET /api/analytics/top-products ──────────────────────────────────────────
router.get('/top-products', async (req, res, next) => {
  const role = req.headers['x-user-role'];
  const userBranch = req.headers['x-branch-id'];
  const { branchId, period = '30', limit = 10 } = req.query;
  const effectiveBranch = (role === 'super_admin' || role === 'regional_manager') ? branchId : userBranch;
  const cacheKey = `analytics:top-products:${effectiveBranch || 'all'}:${period}`;
  try {
    const data = await cached(req.redis, cacheKey, CACHE_TTL, async () => {
      const rows = await req.db.query(
        `SELECT jsonb_array_elements(top_products) -> 'productId' as product_id,
                jsonb_array_elements(top_products) -> 'name' as name,
                SUM((jsonb_array_elements(top_products) -> 'quantity')::numeric)::int as total_quantity
         FROM daily_sales_snapshots
         WHERE date >= CURRENT_DATE - $1::int AND top_products IS NOT NULL
         GROUP BY 1, 2 ORDER BY total_quantity DESC LIMIT $2`,
        [parseInt(period, 10), parseInt(limit, 10)]
      );
      return rows.rows;
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

module.exports = router;
