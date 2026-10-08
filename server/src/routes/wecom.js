// server/src/routes/wecom.js
// 企业微信（群机器人 Webhook）配置与推送接口。webhook 地址存于 system_config 表，读取时脱敏。
import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import wecomService from '../services/wecom.js';

const router = Router();
router.use(authMiddleware);

// 脱敏：只返回是否已配置 + 掩码（保留 key 末尾 6 位便于核对），绝不返回完整 webhook 地址
function maskWebhook(v) {
  if (!v) return '';
  const m = v.match(/key=([^&]+)/i);
  if (m) {
    const key = m[1];
    if (key.length <= 6) return v.replace(/key=.+/i, 'key=****');
    return v.replace(/key=.+/i, `key=****${key.slice(-6)}`);
  }
  return v.length <= 8 ? '****' : v.slice(0, 8) + '****';
}

// GET /api/wecom/config — 所有登录用户可读（前端判断是否已配置）
router.get('/config', (req, res) => {
  try {
    const db = getDb();
    const cfg = wecomService.getWecomConfig(db);
    res.json({
      success: true,
      config: {
        wecom_webhook_url_masked: maskWebhook(cfg.wecom_webhook_url),
        configured: !!cfg.wecom_webhook_url,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/wecom/config — 仅管理员可写
router.put('/config', roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const b = req.body || {};
    const stmt = db.prepare(
      "INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    );
    const tx = db.transaction(() => {
      if (typeof b.wecom_webhook_url === 'string') stmt.run('wecom_webhook_url', b.wecom_webhook_url.trim());
    });
    tx();
    res.json({ success: true, message: '企业微信配置已保存' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/wecom/test — 发送一条测试消息（仅管理员）
router.post('/test', roleMiddleware('admin'), async (req, res) => {
  try {
    const db = getDb();
    const content = [
      '# ✅ 企业微信连接测试',
      `> <font color="comment">${new Date().toLocaleString('zh-CN')}</font>`,
      '',
      '如果你收到这条消息，说明门店系统已成功接入企业微信。',
      '',
      '> 📌 闭店提交后，系统会自动把当日经营日报推送到此处。',
    ].join('\n');
    const resp = await wecomService.sendMarkdown(db, content);
    if (resp && resp.errcode === 0) {
      res.json({ success: true, message: '测试消息已发送，请查看企业微信' });
    } else {
      res.status(400).json({ success: false, error: `发送失败: ${resp?.errcode} ${resp?.errmsg}`, hint: resp?.hint });
    }
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST /api/wecom/preview — 预览今日闭店日报内容（不发送）；body.send=true 时实际发送
router.post('/preview', roleMiddleware('admin'), async (req, res) => {
  try {
    const db = getDb();
    const reportDate = (req.body && req.body.report_date) || undefined;
    const data = wecomService.buildClosingReportData(db, reportDate);
    const markdown = wecomService.buildClosingReportMarkdown(data);
    if (req.body && req.body.send) {
      const resp = await wecomService.sendMarkdown(db, markdown);
      if (resp && resp.errcode === 0) {
        return res.json({ success: true, sent: true, markdown });
      }
      return res.status(400).json({ success: false, error: `发送失败: ${resp?.errcode} ${resp?.errmsg}`, hint: resp?.hint, markdown });
    }
    res.json({ success: true, sent: false, markdown });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST /api/wecom/push — 管理员手动强制重推今日闭店日报（绕过按天去重）
router.post('/push', roleMiddleware('admin'), async (req, res) => {
  try {
    const db = getDb();
    const reportDate = (req.body && req.body.report_date) || undefined;
    const result = await wecomService.pushClosingReport(db, { reportDate, force: true });
    if (result.pushed) {
      res.json({ success: true, pushed: true, message: '已推送今日闭店日报' });
    } else {
      res.status(400).json({ success: false, error: result.reason || '推送失败', hint: result.response?.hint, response: result.response });
    }
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// POST /api/wecom/push-longimage — 管理员/店长将长图推送到企业微信群
// body: { image: <base64 纯串 或 dataURL>, caption?: 说明文字 }
router.post('/push-longimage', roleMiddleware('admin', 'boss'), async (req, res) => {
  try {
    const db = getDb();
    let b64 = (req.body && req.body.image) || '';
    // 兼容 dataURL 前缀
    const m = b64.match(/^data:image\/\w+;base64,(.+)$/);
    if (m) b64 = m[1];
    if (!b64) return res.status(400).json({ success: false, error: '缺少图片数据' });
    const resp = await wecomService.sendImage(db, b64);
    if (resp && resp.errcode === 0) {
      res.json({ success: true, message: '长图已推送到企业微信群' });
    } else {
      res.status(400).json({ success: false, error: `推送失败: ${resp?.errcode} ${resp?.errmsg}`, hint: resp?.hint });
    }
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

export default router;
