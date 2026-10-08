import { useEffect, useState } from 'react';
import { Card, InputNumber, Typography, message, Spin, Alert, Button } from 'antd';
import { FundOutlined } from '@ant-design/icons';
import api from '../api';

const { Title, Paragraph, Text } = Typography;

// 门店目标利润率（售价毛利率）：保本价 = 进价 ÷ (1 − 利润率)。改完自动重算全部商品保本价。
export default function PricingSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [percent, setPercent] = useState(40);   // 以百分比展示
  const [dirty, setDirty] = useState(false);
  const [exampleCost, setExampleCost] = useState(60);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/config');
        const c = res.data || {};
        const m = Number(c.break_even_margin);
        setPercent(Number.isFinite(m) && m > 0 && m < 1 ? Math.round(m * 100) : 40);
      } catch {
        message.error('读取配置失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const changePercent = (v) => {
    setPercent(Number(v) || 0);
    setDirty(true);
  };

  const save = async () => {
    if (percent <= 0 || percent >= 100) { message.error('利润率需在 1% ~ 99% 之间'); return; }
    setSaving(true);
    try {
      await api.put('/config', { break_even_margin: String(percent / 100) });
      // 按新比例重算所有商品保本价
      await api.post('/products/recalc-break-even');
      setDirty(false);
      message.success('已保存，全部商品保本价已按新比例重算');
    } catch (err) {
      message.error(err.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin style={{ margin: 24 }} />;

  const margin = percent / 100;
  const exampleBreakEven = Math.round((exampleCost / (1 - margin)) * 100) / 100;

  return (
    <Card size="small" style={{ borderRadius: 10 }}>
      <Title level={5} style={{ marginTop: 0 }}>
        <FundOutlined /> 门店目标利润率
      </Title>
      <Paragraph type="secondary" style={{ fontSize: 'var(--font-size-sm)' }}>
        保本价（基础售价）= 进价 ÷ (1 − 目标利润率)。低于保本价销售即亏损。修改后系统会按新比例自动重算所有商品保本价。
      </Paragraph>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-border-light)' }}>
        <div>
          <Text strong>目标利润率（售价毛利率）</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>例如设为 40%，则要求每件商品保至少 40% 毛利</Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <InputNumber
            min={1}
            max={99}
            value={percent}
            onChange={changePercent}
            disabled={saving}
            className="w-sm"
            addonAfter="%"
          />
          <Button type="primary" onClick={save} loading={saving} disabled={!dirty || saving}>
            保存
          </Button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-border-light)' }}>
        <div>
          <Text strong>示例核算</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>输入一个进价，预览对应保本价</Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <InputNumber
            min={0}
            value={exampleCost}
            onChange={(v) => setExampleCost(Number(v) || 0)}
            className="w-sm"
            addonBefore="进价"
          />
          <Text strong style={{ minWidth: 120, textAlign: 'right' }}>
            → 保本价 ¥{exampleBreakEven.toLocaleString()}
          </Text>
        </div>
      </div>

      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="说明"
        description="该比例为全店统一标准。已开单的历史订单成本不受影响（按下单时快照核算），仅未手填到手价的订单其保本判定随此设置变化。"
      />
    </Card>
  );
}
