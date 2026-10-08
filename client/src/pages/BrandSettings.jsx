import { useState, useEffect } from 'react';
import { Card, Form, Input, Button, message, Alert, Grid } from 'antd';
import { SaveOutlined, HomeOutlined } from '@ant-design/icons';
import api from '../api';
import { useBrand } from '../context/BrandContext';

const C = {
  primary: 'var(--color-primary)',
  primaryDark: '#8B7355',
  border: '#EAE6E2',
  text: '#333333',
  textLight: '#888888',
  bg: '#FAF8F5',
};

export default function BrandSettings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const { md } = Grid.useBreakpoint();
  const isMobile = !md;
  const { brand, reload } = useBrand();

  useEffect(() => {
    form.setFieldsValue({ site_name: brand.site_name || '门店系统' });
  }, [brand.site_name]);

  const handleSave = async () => {
    const v = await form.validateFields();
    setLoading(true);
    try {
      await api.put('/config', { site_name: v.site_name.trim() });
      message.success('品牌名称已更新');
      await reload();
    } catch (e) {
      message.error(e.response?.data?.error || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  // 仅移动端附加样式，桌面端一律保持原样
  const firstCardBody = isMobile ? { padding: 12 } : undefined;
  const firstCardMargin = isMobile ? 12 : 16;
  const alertIconSize = isMobile ? 18 : undefined;
  const alertMessage = isMobile
    ? <span style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>品牌名称将显示在登录页面标题和系统左上角 Logo 处</span>
    : '品牌名称将显示在登录页面标题和系统左上角 Logo 处';
  const secondCardBody = isMobile ? { padding: 16 } : undefined;
  const btnBlock = isMobile || undefined;
  const btnHeight = isMobile ? 44 : 36;
  const btnFontSize = isMobile ? 15 : 14;

  return (
    <div style={{ maxWidth: 520 }}>
      <Card
        size="small"
        bodyStyle={firstCardBody}
        style={{
          marginBottom: firstCardMargin, borderRadius: 10,
          background: C.bg, border: `1px solid ${C.border}`,
        }}
      >
        <Alert
          type="info"
          showIcon
          icon={<HomeOutlined style={{ color: C.primary, fontSize: alertIconSize }} />}
          message={alertMessage}
          style={{ background: 'transparent', border: 'none', padding: 0 }}
        />
      </Card>

      <Card size="small" bodyStyle={secondCardBody} style={{ borderRadius: 10, border: `1px solid ${C.border}` }}>
        <Form form={form} layout="vertical">
          <Form.Item
            label="品牌名称"
            name="site_name"
            rules={[{ required: true, message: '请输入品牌名称' }]}
          >
            <Input
              placeholder="例如：门店系统"
              maxLength={20}
              style={{ height: 40, borderRadius: 8 }}
            />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={loading}
              onClick={handleSave}
              block={btnBlock}
              style={{
                height: btnHeight, borderRadius: 8, fontWeight: 600,
                fontSize: btnFontSize,
                background: C.primary, borderColor: C.primary,
              }}
            >
              保存
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
