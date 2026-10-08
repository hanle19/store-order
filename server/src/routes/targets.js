import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// 获取某月所有任务（按店维度：各门店月度目标 + 各导购月度目标）
// 返回 { stores: [{store_id, store_name, is_active, target_amount}], sales: [{user_id, display_name, phone, store_id, store_name, target_amount}] }
router.get('/', (req, res) => {
  const db = getDb();
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: '请提供 year 和 month' });
  const y = parseInt(year), m = parseInt(month);

  // 多店隔离：管理者看全部门店，sales 仅限本店（单店时恒真过滤，零回归）
  const isManager = req.user.role === 'admin' || req.user.role === 'boss';
  const storeParams = [y, m];
  let storeWhere = '';
  if (!isManager) { storeWhere = ' WHERE s.id = ?'; storeParams.push(Number(req.user.store_id) || 1); }

  // 各门店月度目标（user_id IS NULL 行，按 store_id 展开）
  const stores = db.prepare(`
    SELECT s.id as store_id, s.name as store_name, s.is_active,
      COALESCE(t.target_amount, 0) as target_amount
    FROM stores s
    LEFT JOIN monthly_targets t ON t.store_id = s.id AND t.year = ? AND t.month = ? AND t.user_id IS NULL
    ${storeWhere}
    ORDER BY s.is_active DESC, s.id
  `).all(...storeParams);

  // 各导购月度目标（按所属门店分组；sales 仅本店）
  const salesParams = [y, m];
  let salesWhere = '';
  if (!isManager) { salesWhere = ' AND u.store_id = ?'; salesParams.push(Number(req.user.store_id) || 1); }
  const sales = db.prepare(`
    SELECT u.id as user_id, u.display_name, u.phone, u.store_id, s.name as store_name,
      COALESCE(t.target_amount, 0) as target_amount
    FROM users u
    LEFT JOIN stores s ON s.id = u.store_id
    LEFT JOIN monthly_targets t ON t.user_id = u.id AND t.year = ? AND t.month = ?
    WHERE u.role = 'sales' AND u.active = 1${salesWhere}
    ORDER BY s.id, u.display_name
  `).all(...salesParams);

  res.json({
    success: true,
    stores,
    sales
  });
});

// 保存月度任务（批量，按店维度）
// body: { year, month, store_targets: [{store_id, target_amount}], sales_targets: [{user_id, target_amount}] }
router.post('/', roleMiddleware('admin'), (req, res) => {
  const db = getDb();
  const { year, month, store_targets, sales_targets } = req.body || {};
  if (!year || !month) return res.status(400).json({ error: '请提供 year 和 month' });
  const y = parseInt(year), m = parseInt(month);

  const upsert = db.transaction(() => {
    // 门店任务：user_id = NULL，按 store_id 唯一
    if (Array.isArray(store_targets)) {
      const upsStore = db.prepare(`
        INSERT INTO monthly_targets (year, month, store_id, user_id, target_amount, updated_at)
        VALUES (?, ?, ?, NULL, ?, datetime('now','localtime'))
        ON CONFLICT(store_id, year, month) WHERE user_id IS NULL
        DO UPDATE SET target_amount = excluded.target_amount, updated_at = excluded.updated_at
      `);
      for (const st of store_targets) {
        upsStore.run(y, m, Number(st.store_id) || 1, Number(st.target_amount) || 0);
      }
    }

    // 导购任务：store_id 取该用户所属门店（保证 UNIQUE 命中）
    if (Array.isArray(sales_targets)) {
      const upsSales = db.prepare(`
        INSERT INTO monthly_targets (year, month, store_id, user_id, target_amount, updated_at)
        VALUES (?, ?, (SELECT store_id FROM users WHERE id = ?), ?, ?, datetime('now','localtime'))
        ON CONFLICT(year, month, store_id, user_id) DO UPDATE SET target_amount = excluded.target_amount, updated_at = excluded.updated_at
      `);
      for (const s of sales_targets) {
        upsSales.run(y, m, Number(s.user_id), Number(s.user_id), Number(s.target_amount) || 0);
      }
    }
  });

  try {
    upsert();
    res.json({ success: true, message: '任务已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
