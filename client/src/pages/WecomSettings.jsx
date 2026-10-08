import { useState, useEffect } from 'react';
import { Card, Form, Input, Button, message, Alert, Modal, Grid, Tag, Space } from 'antd';
import {
  WechatOutlined, SaveOutlined, SendOutlined, EyeOutlined, ReloadOutlined,
} from '@ant-design/icons';
import api from '../api';
import { useBrand } from '../context/BrandContext';

const C = {
  primary: 'var(--color-primary)',
  border: 'var(--color-border)',
  text: 'var(--color-text)',
  textLight: 'var(--color-text-tertiary)',
  bg: 'var(--color-bg)',
  danger: 'var(--color-error)',
};

export default function WecomSettings() {
  const { brand } = useBrand();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [previewText, setPreviewText] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  const { md } = Grid.useBreakpoint();
  const isMobile = !md;

  useEffect(() => {
    api.get('/wecom/config').then(res => {
      const c = res.data.config || {};
      setConfigured(!!c.configured);
      // webhook 地址出于安全不回填明文，留空表示需重新粘贴
    }).catch((err) => { console.error('加载企业微信配置失败', err); message.error('加载企业微信配置失败，请稍后重试'); });
  }, []);

  const handleSave = async () => {
    const v = await form.validateFields();
    setLoading(true);
    try {
      const payload = {
        wecom_webhook_url: v.wecom_webhook_url.trim(),
      };
      await api.put('/wecom/config', payload);
      message.success('企业微信配置已保存');
      setConfigured(true);
    } catch (e) {
      message.error(e.response?.data?.error || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  const showWecomError = (err, hint) => {
    const content = [err || '操作失败', hint].filter(Boolean).join(' ');
    message.error({ content, duration: 8 });
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await api.post('/wecom/test');
      if (res.data.success) message.success('测试消息已发送，请查看企业微信');
      else showWecomError(res.data.error, res.data.hint);
    } catch (e) {
      showWecomError(e.response?.data?.error, e.response?.data?.hint);
    } finally {
      setTesting(false);
    }
  };

  const handlePreview = async (send) => {
    if (send) setPushing(true); else setPreviewing(true);
    try {
      const res = await api.post('/wecom/preview', { send: !!send });
      if (res.data.success) {
        setPreviewText(res.data.markdown || '');
        setPreviewOpen(true);
        if (send && res.data.sent) message.success('已推送今日闭店日报');
      } else {
        showWecomError(res.data.error, res.data.hint);
      }
    } catch (e) {
      message.error(e.response?.data?.error || '操作失败');
    } finally {
      setPreviewing(false);
      setPushing(false);
    }
  };

  const btnHeight = isMobile ? 44 : 36;
  const btnFontSize = isMobile ? 13 : 16;
  const block = isMobile || undefined;

  return (
    <div style={{ maxWidth: 560 }}>
      <Card
        size="small"
        bodyStyle={isMobile ? { padding: 12 } : undefined}
        style={{ marginBottom: isMobile ? 8 : 16, borderRadius: 'var(--radius-md)', background: C.bg, border: `1px solid ${C.border}` }}
      >
        <Alert
          type={configured ? 'success' : 'info'}
          showIcon
          icon={<WechatOutlined style={{ color: C.primary }} />}
          message={
            configured
              ? '企业微信已配置（群机器人）：管理员闭店提交后，系统会自动把当日经营日报推送到指定群。'
              : `尚未完成企业微信配置。步骤：① 企业微信建一个群（如“${(brand.store_name || '我的门店') + '日报'}”）；② 群设置 → 添加群机器人 → 新建，复制 Webhook 地址；③ 粘贴到下方；④ 点“发送测试”验证。全程无需公网、无需可信IP。`
          }
          style={{ background: 'transparent', border: 'none', padding: 0 }}
        />
      </Card>

      <Card size="small" bodyStyle={isMobile ? { padding: 16 } : undefined} style={{ borderRadius: 'var(--radius-md)', border: `1px solid ${C.border}` }}>
        <Form form={form} layout="vertical">
          <Form.Item
            label="群机器人 Webhook 地址"
            name="wecom_webhook_url"
            rules={[
              { required: true, message: '请粘贴群机器人 Webhook 地址' },
              {
                pattern: /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=.+/i,
                message: '地址格式不正确，应为 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
              },
            ]}
            extra="在企业微信群 → 群设置 → 添加群机器人 → 新建后复制。地址含 ?key= 一段，切勿泄露。"
          >
            <Input placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx" style={{ height: 36, borderRadius: 8 }} />
          </Form.Item>

          <Form.Item style={{ marginBottom: 8 }}>
            <Button
              type="primary" icon={<SaveOutlined />} loading={loading}
              onClick={handleSave} block={block}
              style={{ height: btnHeight, borderRadius: 8, fontWeight: 600, fontSize: btnFontSize, background: C.primary, borderColor: C.primary }}
            >
              保存配置
            </Button>
          </Form.Item>

          <Space wrap style={{ width: '100%' }}>
            <Button icon={<SendOutlined />} loading={testing} onClick={handleTest}
              style={{ height: btnHeight, borderRadius: 8, fontSize: btnFontSize }}>
              发送测试
            </Button>
            <Button icon={<EyeOutlined />} loading={previewing} onClick={() => handlePreview(false)}
              style={{ height: btnHeight, borderRadius: 8, fontSize: btnFontSize }}>
              预览今日报告
            </Button>
            <Button icon={<ReloadOutlined />} loading={pushing} onClick={() => handlePreview(true)}
              style={{ height: btnHeight, borderRadius: 8, fontSize: btnFontSize }}>
              重推今日
            </Button>
          </Space>
        </Form>
      </Card>

      <Modal
        title="闭店日报预览（企业微信 Markdown）"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewOpen(false)}>关闭</Button>,
          <Button key="push" type="primary" icon={<SendOutlined />} loading={pushing} onClick={() => { setPreviewOpen(false); handlePreview(true); }}
            style={{ background: C.primary, borderColor: C.primary }}>
            确认推送
          </Button>,
        ]}
        className="modal-md"
      >
        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--font-size-sm)', lineHeight: 1.7,
          background: 'var(--color-bg-white)', border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, margin: 0,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}>{previewText}</pre>
      </Modal>
    </div>
  );
}
