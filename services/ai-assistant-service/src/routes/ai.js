'use strict';

const express = require('express');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const router = express.Router();

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ success: false, errors: errors.array() }); return false; }
  return true;
}

// Rate limit AI queries (expensive external API calls)
const aiQueryLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'AI query rate limit exceeded. Please wait a moment.' },
});

const SYSTEM_PROMPT = `You are MediCore AI Assistant, an intelligent assistant for a pharmacy distribution platform.
You help pharmacists, inventory managers, and regional managers with:
- Inventory queries and restocking recommendations
- Sales trend analysis and insights
- Drug interaction queries (general guidance, not medical advice)
- Purchase order recommendations based on stock levels
- Branch performance comparisons
- Operational efficiency suggestions

Always be precise, data-driven, and professional. If asked for medical advice, clarify you provide operational insights only.
Keep responses concise and actionable.`;

// ─── POST /api/ai/query ────────────────────────────────────────────────────────
router.post(
  '/query',
  aiQueryLimiter,
  [body('message').trim().isLength({ min: 1, max: 2000 })],
  async (req, res, next) => {
    if (!validate(req, res)) return;
    const { message, context = {} } = req.body;
    const userId = req.headers['x-user-id'];
    const branchId = req.headers['x-branch-id'];
    const role = req.headers['x-user-role'];
    const startTime = Date.now();

    // Check cache for identical queries (within 5 min)
    const cacheKey = `ai:query:${Buffer.from(message).toString('base64').slice(0, 64)}`;
    try {
      if (req.redis.status === 'ready') {
        const cached = await req.redis.get(cacheKey);
        if (cached) {
          return res.json({ success: true, data: JSON.parse(cached), cached: true });
        }
      }

      let aiResponse;
      if (process.env.OPENAI_API_KEY) {
        // Live OpenAI call
        const messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Context: Role=${role}, BranchId=${branchId || 'all'}, Extra=${JSON.stringify(context)}\n\nQuery: ${message}`,
          },
        ];

        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-4o-mini',
            messages,
            max_tokens: 500,
            temperature: 0.3,
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          }
        );

        aiResponse = {
          message: response.data.choices[0].message.content,
          tokensUsed: response.data.usage.total_tokens,
        };
      } else {
        // Fallback: rule-based responses for common queries when no API key
        aiResponse = generateRuleBasedResponse(message, role, branchId);
      }

      const duration = Date.now() - startTime;

      // Log query
      await req.db.query(
        'INSERT INTO ai_query_log (user_id, branch_id, query, response, tokens_used, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId || null, branchId || null, message, aiResponse.message, aiResponse.tokensUsed || 0, duration]
      );

      // Cache response for 5 minutes
      if (req.redis.status === 'ready') {
        await req.redis.setex(cacheKey, 300, JSON.stringify(aiResponse));
      }

      res.json({ success: true, data: aiResponse });
    } catch (err) {
      if (err.response?.status === 429) {
        return res.status(429).json({ success: false, message: 'AI service rate limit reached. Please try again shortly.' });
      }
      next(err);
    }
  }
);

// ─── GET /api/ai/recommendations ──────────────────────────────────────────────
router.get('/recommendations', aiQueryLimiter, async (req, res, next) => {
  const branchId = req.headers['x-branch-id'];
  try {
    // Fetch recent analytics data from analytics DB
    const lowStockQuery = await req.db.query(
      `SELECT total_sku_count, low_stock_count, out_of_stock_count
       FROM inventory_snapshots
       WHERE branch_id = $1 AND date = CURRENT_DATE LIMIT 1`,
      [branchId]
    );

    const recommendations = [];

    if (lowStockQuery.rows[0]) {
      const { low_stock_count, out_of_stock_count } = lowStockQuery.rows[0];
      if (out_of_stock_count > 0) {
        recommendations.push({
          type: 'critical',
          category: 'inventory',
          message: `${out_of_stock_count} product(s) are out of stock. Immediate purchase orders recommended.`,
        });
      }
      if (low_stock_count > 0) {
        recommendations.push({
          type: 'warning',
          category: 'inventory',
          message: `${low_stock_count} product(s) are below reorder level. Review and place purchase orders.`,
        });
      }
    }

    if (recommendations.length === 0) {
      recommendations.push({ type: 'info', category: 'general', message: 'All inventory levels are healthy.' });
    }

    res.json({ success: true, data: recommendations });
  } catch (err) { next(err); }
});

// ─── GET /api/ai/query-history ─────────────────────────────────────────────────
router.get('/query-history', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  const { limit = 20 } = req.query;
  try {
    const result = await req.db.query(
      'SELECT id, query, response, tokens_used, duration_ms, created_at FROM ai_query_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, parseInt(limit, 10)]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// ─── Rule-based fallback ──────────────────────────────────────────────────────
function generateRuleBasedResponse(message, role, branchId) {
  const lower = message.toLowerCase();
  let response = 'I can help you with inventory management, sales analysis, and purchase recommendations. Please provide more specific details about what you need.';

  if (lower.includes('stock') || lower.includes('inventory')) {
    response = 'To check stock levels, visit the Inventory module. For low-stock alerts, check the Alerts section. Consider setting up automated reorder points for critical medications.';
  } else if (lower.includes('sales') || lower.includes('revenue')) {
    response = 'Sales analytics are available in the Dashboard. You can filter by date range and branch to compare performance trends.';
  } else if (lower.includes('purchase') || lower.includes('order')) {
    response = 'Purchase orders can be created in the Purchases module. Review your low-stock alerts first to prioritize urgent orders.';
  } else if (lower.includes('branch') || lower.includes('transfer')) {
    response = 'Branch transfers can be initiated from the Inventory Transfer section. Ensure the destination branch has sufficient demand before approving transfers.';
  }

  return { message: response, tokensUsed: 0 };
}

module.exports = router;
