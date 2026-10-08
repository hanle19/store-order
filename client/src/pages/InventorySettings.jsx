import { useEffect, useState } from 'react';
import { Card, InputNumber, Typography, message, Spin, Alert } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import api from '../api';

const { Title, Paragraph, Text } = Typography;

// 安全库存阈值配置（默认 5）。低于该值的商品在库存页标红预警，工作台/企业微信低库存提醒据此统计。
export default function InventorySettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [threshold, setThreshold] = useState(5);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/config');
        const c = res.data || {};
        setThreshold(c.low_stock_threshold ? Number(c.low_stock_threshold) : 5);
      } catch {
        message.error('读取配置失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = async (val) => {
    const v = Number(val);
    if (!Number.isFinite(v) || v < 0) { message.error('请输入有效数值'); return; }
    setSaving(true);
    try {
      await api.put('/config', { low_stock_threshold: String(v) });
      setThreshold(v);
      message.success('已保存');
    } catch (err) {
      message.error(err.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin style={{ margin: 24 }} />;

  return (
    <Card size="small" style={{ borderRadius: 10 }}>
      <Title level={5} style={{ marginTop: 0 }}>
        <WarningOutlined /> 安全库存阈值
      </Title>
      <Paragraph type="secondary" style={{ fontSize: 'var(--font-size-sm)' }}>
        低于该库存数量的商品会在库存管理页标红「预警」，工作台与企业微信日报据此统计「低库存」数量。默认 5。
      </Paragraph>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-border-light)' }}>
        <div>
          <Text strong>安全库存阈值</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>库存 ≤ 此值的商品视为偏低，需补货</Text>
        </div>
        <InputNumber
          min={0}
          value={threshold}
          onChange={update}
          disabled={saving}
          className="w-sm"
          addonAfter="件"
        />
      </div>

      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="说明"
        description="此阈值对所有商品统一生效。订货类商品的库存由开单/订货自动驱动，达到阈值同样会预警，便于及时补货。"
      />
    </Card>
  );
}
