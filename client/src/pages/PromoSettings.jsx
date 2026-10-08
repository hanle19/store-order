import { useEffect, useState } from 'react';
import { Card, Switch, Typography, message, Spin, Alert } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import api from '../api';

const { Title, Paragraph, Text } = Typography;

// 促销总开关 + 子开关管理。默认全关，现有价格/财务逻辑零影响。
export default function PromoSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flags, setFlags] = useState({
    promo_enabled: false,
    promo_coupon_enabled: false,
    promo_bundle_enabled: false,
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/config');
        const c = res.data || {};
        setFlags({
          promo_enabled: c.promo_enabled === '1',
          promo_coupon_enabled: c.promo_coupon_enabled === '1',
          promo_bundle_enabled: c.promo_bundle_enabled === '1',
        });
      } catch {
        message.error('读取配置失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = async (key, val) => {
    const prev = { ...flags };
    const next = { ...flags, [key]: val };
    setFlags(next);
    setSaving(true);
    try {
      await api.put('/config', { [key]: val ? '1' : '0' });
      message.success('已保存');
    } catch (err) {
      setFlags(prev);
      message.error(err.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin style={{ margin: 24 }} />;

  return (
    <Card size="small" style={{ borderRadius: 10 }}>
      <Title level={5} style={{ marginTop: 0 }}>
        <ApiOutlined /> 促销活动开关
      </Title>
      <Paragraph type="secondary" style={{ fontSize: 'var(--font-size-sm)' }}>
        本系统默认按现有逻辑手工录入成交价，财务以最终成交价为准。仅在需要时开启以下促销能力；关闭时所有促销计算不生效，价格与现有逻辑完全一致。
      </Paragraph>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-border-light)' }}>
        <div>
          <Text strong>促销总开关</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>开启后，折扣/优惠期生效，并可启用下方子模块</Text>
        </div>
        <Switch checked={flags.promo_enabled} loading={saving} onChange={(v) => update('promo_enabled', v)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--color-border-light)', opacity: flags.promo_enabled ? 1 : 0.5 }}>
        <div>
          <Text strong>优惠券</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>创建券码、满减 / 折扣 / 立减，开单时核销</Text>
        </div>
        <Switch disabled={!flags.promo_enabled} checked={flags.promo_coupon_enabled} loading={saving} onChange={(v) => update('promo_coupon_enabled', v)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', opacity: flags.promo_enabled ? 1 : 0.5 }}>
        <div>
          <Text strong>捆绑销售（套餐）</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>组合商品套餐价，开单时一键选套餐</Text>
        </div>
        <Switch disabled={!flags.promo_enabled} checked={flags.promo_bundle_enabled} loading={saving} onChange={(v) => update('promo_bundle_enabled', v)} />
      </div>

      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="说明"
        description="开启促销后，最终成交价仍可手工修改，财务始终以订单最终成交价核算。抖音等线上券作为“外部核销额”单独记录，不强制覆盖手工价。"
      />
    </Card>
  );
}
