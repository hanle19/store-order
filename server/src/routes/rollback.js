import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { executeRollback } from './orders.js';

const router = Router();
router.use(authMiddleware);

// GET /pending — 待审批列表（店长查看）
router.get('/pending', roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const data = db.prepare(`
      SELECT ra.*, u.display_name as applicant_name
      FROM rollback_approvals ra
      LEFT JOIN users u ON ra.applicant_id = u.id
      WHERE ra.status = 'pending'
      ORDER BY ra.created_at DESC
    `).all();
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /my — 我提交的回退申请
router.get('/my', (req, res) => {
  try {
    const db = getDb();
    const data = db.prepare(`
      SELECT ra.*, u2.display_name as approver_name
      FROM rollback_approvals ra
      LEFT JOIN users u2 ON ra.approver_id = u2.id
      WHERE ra.applicant_id = ?
      ORDER BY ra.created_at DESC
    `).all(req.user.id);
    res.json({ data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/approve — 审批通过（店长）
router.post('/:id/approve', roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const approval = db.prepare('SELECT * FROM rollback_approvals WHERE id = ?').get(req.params.id);
    if (!approval) return res.status(404).json({ error: '审批记录不存在' });
    if (approval.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });

    const { result_note } = req.body;

    db.transaction(() => {
      db.prepare(`UPDATE rollback_approvals SET
        status = 'approved', approver_id = ?, result_note = ?, executed = 1,
        updated_at = datetime('now','localtime')
        WHERE id = ?`).run(req.user.id, result_note || '已审批', approval.id);

      // 执行回退：根据 target_type 调用对应逻辑
      if (approval.target_type === 'order') {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(approval.target_id);
        if (order && order.status === approval.from_node) {
          // 复用订单回退核心逻辑（含库存/尾款/送货单补偿），与店长直接回退行为一致
          executeRollback(db, approval.target_id, approval.from_node, approval.to_node, req.user, approval.reason);
        }
      } else if (approval.target_type === 'purchase') {
        db.prepare('UPDATE purchase_orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
          .run(approval.to_node, approval.target_id);
      } else if (approval.target_type === 'delivery') {
        db.prepare('UPDATE delivery_orders SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?')
          .run(approval.to_node, approval.target_id);
      }
    })();

    res.json({ message: '审批通过，回退已执行' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /:id/reject — 审批拒绝（店长）
router.post('/:id/reject', roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const approval = db.prepare('SELECT * FROM rollback_approvals WHERE id = ?').get(req.params.id);
    if (!approval) return res.status(404).json({ error: '审批记录不存在' });
    if (approval.status !== 'pending') return res.status(400).json({ error: '该申请已处理' });

    const { result_note } = req.body;
    db.prepare(`UPDATE rollback_approvals SET
      status = 'rejected', approver_id = ?, result_note = ?,
      updated_at = datetime('now','localtime')
      WHERE id = ?`).run(req.user.id, result_note || '已拒绝', approval.id);

    res.json({ message: '回退申请已拒绝' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
