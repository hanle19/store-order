import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { storeClauseAndParams } from '../utils/storeScope.js';
import { auditFromReq, TARGET_TYPES } from '../utils/audit.js';

const router = Router();
router.use(authMiddleware);

// GET / — 送货单列表（按门店隔离，含客户 PII 的送货单只对该店可见）
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { order_id, status, delivery_type } = req.query;
    const conditions = [];
    const params = [];

    if (order_id) { conditions.push('d.order_id = ?'); params.push(order_id); }
    if (status) { conditions.push('d.status = ?'); params.push(status); }
    if (delivery_type) { conditions.push('d.delivery_type = ?'); params.push(delivery_type); }

    const sc = storeClauseAndParams(req, 'd');
    const where = (conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : 'WHERE 1=1') + sc.clause;

    const data = db.prepare(`
      SELECT d.*, u.display_name as operator_name, o.order_no, o.customer_name
      FROM delivery_orders d
      LEFT JOIN users u ON d.operator_id = u.id
      LEFT JOIN orders o ON d.order_id = o.id
      ${where}
      ORDER BY d.created_at DESC
    `).all(...params, ...sc.params);

    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — 送货单详情（按门店隔离，跨店返回 404 防 PII 泄漏）
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const sc = storeClauseAndParams(req, 'd');
    const delivery = db.prepare(`
      SELECT d.*, u.display_name as operator_name, o.order_no, o.customer_name, o.customer_phone, o.customer_address
      FROM delivery_orders d
      LEFT JOIN users u ON d.operator_id = u.id
      LEFT JOIN orders o ON d.order_id = o.id
      WHERE d.id = ? ${sc.clause}
    `).get(req.params.id, ...sc.params);

    if (!delivery) return res.status(404).json({ error: '送货单不存在' });

    const items = db.prepare('SELECT * FROM delivery_items WHERE delivery_id = ?').all(delivery.id);
    res.json({ ...delivery, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/sign — 签收送货单
router.post('/:id/sign', (req, res) => {
  try {
    const db = getDb();
    const sc = storeClauseAndParams(req, 'd');
    const delivery = db.prepare('SELECT * FROM delivery_orders d WHERE d.id = ?' + sc.clause).get(req.params.id, ...sc.params);
    if (!delivery) return res.status(404).json({ error: '送货单不存在' });
    if (delivery.status === 'signed') return res.status(400).json({ error: '已签收' });
    if (delivery.status === 'cancelled') return res.status(400).json({ error: '已取消' });

    db.transaction(() => {
      db.prepare("UPDATE delivery_orders SET status = 'signed', signature_status = 'signed', updated_at = datetime('now','localtime') WHERE id = ?").run(delivery.id);

      const dItems = db.prepare('SELECT * FROM delivery_items WHERE delivery_id = ?').all(delivery.id);
      for (const di of dItems) {
        db.prepare("UPDATE order_items SET item_status = 'delivered' WHERE id = ?").run(di.order_item_id);
      }
    })();

    const updated = db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(delivery.id);
    auditFromReq(req, {
      targetType: TARGET_TYPES.DELIVERY,
      targetId: delivery.id,
      action: 'sign',
      oldStatus: delivery.status,
      newStatus: 'signed',
      details: { order_id: delivery.order_id },
    });
    res.json({ message: '签收成功', delivery: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/rollback — 回退送货单到 dispatched（敏感操作：仅 admin/boss）
router.post('/:id/rollback', roleMiddleware('admin', 'boss'), (req, res) => {
  try {
    const db = getDb();
    const sc = storeClauseAndParams(req, 'd');
    const delivery = db.prepare('SELECT * FROM delivery_orders d WHERE d.id = ?' + sc.clause).get(req.params.id, ...sc.params);
    if (!delivery) return res.status(404).json({ error: '送货单不存在' });
    if (delivery.status !== 'signed') return res.status(400).json({ error: '仅已签收的送货单可回退' });

    db.transaction(() => {
      db.prepare("UPDATE delivery_orders SET status = 'dispatched', signature_status = 'unsigned', updated_at = datetime('now','localtime') WHERE id = ?").run(delivery.id);

      const dItems = db.prepare('SELECT * FROM delivery_items WHERE delivery_id = ?').all(delivery.id);
      for (const di of dItems) {
        db.prepare("UPDATE order_items SET item_status = 'delivering' WHERE id = ?").run(di.order_item_id);
      }
    })();

    auditFromReq(req, {
      targetType: TARGET_TYPES.DELIVERY,
      targetId: delivery.id,
      action: 'rollback_sign',
      oldStatus: delivery.status,
      newStatus: 'dispatched',
      details: { order_id: delivery.order_id },
    });
    res.json({ message: '送货单已回退' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
