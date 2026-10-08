import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { auditDelete, TARGET_TYPES } from '../utils/audit.js';

const router = Router();
router.use(authMiddleware);

function withItems(db, b) {
  b.items = db.prepare('SELECT bi.*, p.name AS product_name, p.price AS product_price FROM bundle_items bi LEFT JOIN products p ON p.id = bi.product_id WHERE bi.bundle_id = ? ORDER BY bi.id ASC').all(b.id);
  return b;
}

// 列表（开单页与后台共用；available=1 仅返回启用项）
router.get('/', (req, res) => {
  const db = getDb();
  const { available } = req.query;
  let sql = 'SELECT * FROM bundles';
  const params = [];
  if (available === '1') { sql += ' WHERE status = 1'; }
  sql += ' ORDER BY id DESC';
  const list = db.prepare(sql).all(...params).map(b => withItems(db, b));
  res.json(list);
});

// 详情
router.get('/:id', (req, res) => {
  const db = getDb();
  const b = db.prepare('SELECT * FROM bundles WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: '套餐不存在' });
  res.json(withItems(db, b));
});

// 创建
router.post('/', roleMiddleware('admin', 'boss'), (req, res) => {
  const { name, combo_price, category, brand, start, end, items } = req.body;
  if (!name || combo_price === undefined) {
    return res.status(400).json({ error: '请填写套餐名称和组合价' });
  }
  const db = getDb();
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO bundles (name, combo_price, category, brand, start, end, status) VALUES (?,?,?,?,?,?,1)')
      .run(name, Number(combo_price), category || '', brand || '', start || '', end || '');
    const bid = r.lastInsertRowid;
    const ins = db.prepare('INSERT INTO bundle_items (bundle_id, product_id, qty, is_main) VALUES (?,?,?,?)');
    let mainCount = 0;
    (Array.isArray(items) ? items : []).forEach(it => {
      if (!it.product_id) return;
      const isMain = it.is_main ? 1 : 0;
      if (isMain) mainCount++;
      ins.run(bid, Number(it.product_id), Number(it.qty) || 1, isMain);
    });
    if (mainCount === 0 && (Array.isArray(items) ? items : []).length > 0) {
      db.prepare('UPDATE bundle_items SET is_main = 1 WHERE bundle_id = ? AND id = (SELECT MIN(id) FROM bundle_items WHERE bundle_id = ?)').run(bid, bid);
    }
    return bid;
  });
  try {
    const bid = tx();
    res.json({ id: bid, message: '套餐创建成功' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新
router.put('/:id', roleMiddleware('admin', 'boss'), (req, res) => {
  const { name, combo_price, category, brand, start, end, status, items } = req.body;
  const db = getDb();
  const b = db.prepare('SELECT * FROM bundles WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: '套餐不存在' });

  const tx = db.transaction(() => {
    const fields = [], vals = [];
    if (name !== undefined) { fields.push('name = ?'); vals.push(name); }
    if (combo_price !== undefined) { fields.push('combo_price = ?'); vals.push(Number(combo_price)); }
    if (category !== undefined) { fields.push('category = ?'); vals.push(category); }
    if (brand !== undefined) { fields.push('brand = ?'); vals.push(brand); }
    if (start !== undefined) { fields.push('start = ?'); vals.push(start || ''); }
    if (end !== undefined) { fields.push('end = ?'); vals.push(end || ''); }
    if (status !== undefined) { fields.push('status = ?'); vals.push(status ? 1 : 0); }
    if (fields.length) { vals.push(b.id); db.prepare(`UPDATE bundles SET ${fields.join(', ')} WHERE id = ?`).run(...vals); }

    if (Array.isArray(items)) {
      db.prepare('DELETE FROM bundle_items WHERE bundle_id = ?').run(b.id);
      const ins = db.prepare('INSERT INTO bundle_items (bundle_id, product_id, qty, is_main) VALUES (?,?,?,?)');
      let mainCount = 0;
      items.forEach(it => {
        if (!it.product_id) return;
        const isMain = it.is_main ? 1 : 0;
        if (isMain) mainCount++;
        ins.run(b.id, Number(it.product_id), Number(it.qty) || 1, isMain);
      });
      if (mainCount === 0 && items.length > 0) {
        db.prepare('UPDATE bundle_items SET is_main = 1 WHERE bundle_id = ? AND id = (SELECT MIN(id) FROM bundle_items WHERE bundle_id = ?)').run(b.id, b.id);
      }
    }
  });
  try {
    tx();
    res.json({ message: '更新成功' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除
router.delete('/:id', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const bundle = db.prepare('SELECT * FROM bundles WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM bundle_items WHERE bundle_id = ?').run(req.params.id);
  db.prepare('DELETE FROM bundles WHERE id = ?').run(req.params.id);
  if (bundle) auditDelete(req, TARGET_TYPES.BUNDLE, bundle.id, bundle);
  res.json({ message: '删除成功' });
});

export default router;
