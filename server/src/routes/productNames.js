import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { auditDelete, TARGET_TYPES } from '../utils/audit.js';

const router = Router();
router.use(authMiddleware);

// 获取所有商品名称
router.get('/', (req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT * FROM product_names ORDER BY name ASC').all();
  res.json(items);
});

// 新增商品名称
router.post('/', roleMiddleware('admin'), (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '商品名称不能为空' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM product_names WHERE name = ?').get(name.trim());
  if (existing) return res.status(400).json({ error: '商品名称已存在' });

  const result = db.prepare(
    'INSERT INTO product_names (name, brand, model, spec) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), '', '', '');

  res.json({ id: result.lastInsertRowid, message: '添加成功' });
});

// 修改商品名称
router.put('/:id', roleMiddleware('admin'), (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '商品名称不能为空' });

  const db = getDb();
  const item = db.prepare('SELECT * FROM product_names WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: '商品名称不存在' });

  // 检查名称是否与其他记录冲突
  const dup = db.prepare('SELECT id FROM product_names WHERE name = ? AND id != ?').get(name.trim(), req.params.id);
  if (dup) return res.status(400).json({ error: '商品名称已存在' });

  const oldName = item.name;

  db.transaction(() => {
    db.prepare(
      'UPDATE product_names SET name = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?'
    ).run(name.trim(), req.params.id);

    // 全局同步：更新 products、order_items、purchase_items 中的旧名称
    if (oldName !== name.trim()) {
      db.prepare('UPDATE products SET name = ?, updated_at = datetime(\'now\',\'localtime\') WHERE name = ?').run(name.trim(), oldName);
      db.prepare('UPDATE order_items SET product_name = ? WHERE product_name = ?').run(name.trim(), oldName);
      db.prepare('UPDATE purchase_items SET product_name = ? WHERE product_name = ?').run(name.trim(), oldName);
    }
  });

  res.json({ message: '修改成功，已全局同步' });
});

// 删除商品名称
router.delete('/:id', roleMiddleware('admin'), (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM product_names WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: '商品名称不存在' });

  db.prepare('DELETE FROM product_names WHERE id = ?').run(req.params.id);
  auditDelete(req, TARGET_TYPES.PRODUCT_NAME, item.id, item);
  res.json({ message: '删除成功' });
});

export default router;
