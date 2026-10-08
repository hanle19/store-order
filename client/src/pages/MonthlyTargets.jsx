import { useState, useEffect } from 'react';
import { Select, InputNumber, Button, message, Space, Typography, Table, Card, Row, Col, Grid, Tag } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import api from '../api';

const { Title, Text } = Typography;

const moneyFormatter = v => (v !== null && v !== undefined) ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
const moneyParser = v => Number((v || '').replace(/,/g, '')) || 0;

export default function MonthlyTargets() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [storeTargets, setStoreTargets] = useState([]); // [{store_id, store_name, is_active, target_amount}]
  const [salesList, setSalesList] = useState([]); // [{user_id, display_name, phone, store_id, store_name, target_amount}]
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const multiStore = storeTargets.length > 1;

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/targets', { params: { year, month } });
      const d = res.data;
      setStoreTargets((d.stores || []).map(s => ({ ...s, target_amount: s.target_amount || 0 })));
      setSalesList((d.sales || []).map(s => ({ ...s, target_amount: s.target_amount || 0 })));
    } catch (err) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [year, month]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post('/targets', {
        year,
        month,
        store_targets: storeTargets.map(s => ({ store_id: s.store_id, target_amount: Number(s.target_amount) || 0 })),
        sales_targets: salesList.map(s => ({ user_id: s.user_id, target_amount: Number(s.target_amount) || 0 }))
      });
      message.success('任务已保存');
    } catch (err) {
      console.error('保存任务失败:', err);
      message.error(err.response?.data?.error || err.message || '保存失败，请检查网络或刷新后重试');
    } finally {
      setSaving(false);
    }
  };

  const updateStoreTarget = (storeId, value) => {
    setStoreTargets(prev => prev.map(s => s.store_id === storeId ? { ...s, target_amount: value || 0 } : s));
  };
  const updateSalesTarget = (userId, value) => {
    setSalesList(prev => prev.map(s => s.user_id === userId ? { ...s, target_amount: value || 0 } : s));
  };

  const monthOptions = [];
  for (let m = 1; m <= 12; m++) monthOptions.push({ label: `${m}月`, value: m });
  const yearOptions = [];
  const cy = new Date().getFullYear();
  for (let y = cy - 2; y <= cy + 1; y++) yearOptions.push({ label: `${y}年`, value: y });

  // 单店：沿用原有单一门店任务卡（向后兼容）；多店：各店一行可编辑表格
  const renderStoreTargetsDesktop = () => {
    if (storeTargets.length === 0) {
      return (
        <Card className="targets-store-card" loading={loading}>
          <Text type="secondary">暂无门店，请先在「门店管理」中创建门店</Text>
        </Card>
      );
    }
    if (!multiStore) {
      const s = storeTargets[0];
      return (
        <Card className="targets-store-card">
          <Row align="middle" gutter={16}>
            <Col><Title level={5} style={{ margin: 0, color: '#5C4A3A' }}>门店月度任务</Title></Col>
            <Col>
              <InputNumber
                prefix="¥"
                value={s.target_amount}
                onChange={v => updateStoreTarget(s.store_id, Number(v) || 0)}
                min={0} step={10000} className="w-md"
                placeholder="门店任务金额"
                formatter={moneyFormatter} parser={moneyParser}
              />
            </Col>
            <Col><Text type="secondary">单位：元</Text></Col>
          </Row>
        </Card>
      );
    }
    // 多店：表格逐店设置
    const cols = [
      { title: '门店', dataIndex: 'store_name', width: 160,
        render: (v, r) => (<span>{v} {r.is_active ? null : <Tag color="red">停用</Tag>}</span>) },
      { title: '月度任务金额（元）', dataIndex: 'target_amount', width: 200,
        render: (val, r) => (
          <InputNumber
            prefix="¥" value={val} min={0} step={10000} className="w-md"
            onChange={v => updateStoreTarget(r.store_id, Number(v) || 0)}
            formatter={moneyFormatter} parser={moneyParser}
          />
        ) },
    ];
    return (
      <Card className="targets-store-card" title="各门店月度任务" loading={loading} bodyStyle={{ padding: 0 }}>
        <Table
          className="app-data-table"
          dataSource={storeTargets}
          columns={cols}
          rowKey="store_id"
          size="middle"
          pagination={false}
          rowClassName={(_, i) => i % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
        />
      </Card>
    );
  };

  const renderStoreTargetsMobile = () => {
    if (storeTargets.length === 0) {
      return <Card className="x-mobile-targets-store-card" bodyStyle={{ padding: 16 }}><Text type="secondary">暂无门店</Text></Card>;
    }
    if (!multiStore) {
      const s = storeTargets[0];
      return (
        <Card className="x-mobile-targets-store-card" bodyStyle={{ padding: 16 }}>
          <Title level={5} style={{ margin: '0 0 12px 0', color: '#5C4A3A' }}>门店月度任务</Title>
          <InputNumber
            prefix="¥" value={s.target_amount}
            onChange={v => updateStoreTarget(s.store_id, Number(v) || 0)}
            min={0} step={10000} style={{ width: '100%' }}
            placeholder="门店任务金额"
            formatter={moneyFormatter} parser={moneyParser}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 'var(--font-size-sm)' }}>单位：元</Text>
        </Card>
      );
    }
    return (
      <Card className="x-mobile-targets-store-card" title="各门店月度任务" loading={loading} bodyStyle={{ padding: 12 }}>
        <div className="x-mcard-list">
          {storeTargets.map(s => (
            <div key={s.store_id} className="x-mcard" style={{ padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="x-mcard-name">{s.store_name}</span>
                {!s.is_active && <Tag color="red">停用</Tag>}
              </div>
              <InputNumber
                prefix="¥" value={s.target_amount}
                onChange={v => updateStoreTarget(s.store_id, Number(v) || 0)}
                min={0} step={10000} style={{ width: '100%', marginTop: 4 }}
                formatter={moneyFormatter} parser={moneyParser}
              />
            </div>
          ))}
        </div>
      </Card>
    );
  };

  const salesColumns = [
    ...(multiStore ? [{ title: '门店', dataIndex: 'store_name', width: 120, render: v => v || '-' }] : []),
    { title: '导购姓名', dataIndex: 'display_name', width: 120 },
    { title: '电话', dataIndex: 'phone', width: 140, render: v => v || '-' },
    {
      title: '月度任务金额（元）', dataIndex: 'target_amount',
      render: (val, record) => (
        <InputNumber
          prefix="¥" value={val}
          onChange={v => updateSalesTarget(record.user_id, Number(v) || 0)}
          min={0} step={5000} className="w-md"
          formatter={moneyFormatter} parser={moneyParser}
        />
      ),
    },
  ];

  const renderSalesDesktop = () => (
    <Card className="targets-sales-card" title="导购个人任务" loading={loading} bodyStyle={{ padding: 0 }}>
      <Table
        className="app-data-table"
        dataSource={salesList}
        columns={salesColumns}
        rowKey="user_id"
        size="middle"
        pagination={false}
        rowClassName={(_, i) => i % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
        locale={{ emptyText: '暂无导购账号，请先在用户管理中创建导购' }}
      />
    </Card>
  );

  const renderSalesMobile = () => (
    <Card className="x-mobile-targets-sales-card" title="导购个人任务" loading={loading} bodyStyle={{ padding: 12 }}>
      {salesList.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          暂无导购账号，请先在用户管理中创建导购
        </div>
      ) : (
        <div className="x-mcard-list">
          {salesList.map(s => (
            <div key={s.user_id} className="x-mcard" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <span className="x-mcard-name" style={{ flex: 1, minWidth: 8 }}>{s.display_name}</span>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                  {multiStore ? `${s.store_name || ''} · ` : ''}{s.phone || '-'}
                </span>
              </div>
              <div className="x-mcard-field" style={{ width: '100%' }}>
                <span className="x-mcard-label">月度任务金额（元）</span>
                <InputNumber
                  prefix="¥" value={s.target_amount}
                  onChange={v => updateSalesTarget(s.user_id, Number(v) || 0)}
                  min={0} step={5000} style={{ width: '100%', marginTop: 6 }}
                  formatter={moneyFormatter} parser={moneyParser}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  const renderMobile = () => (
    <div>
      <Card className="x-mobile-toolbar-card" bodyStyle={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Select value={year} onChange={setYear} options={yearOptions} style={{ flex: 1.2, height: 40, minWidth: 8 }} />
          <Select value={month} onChange={setMonth} options={monthOptions} style={{ flex: 1, height: 40, minWidth: 8 }} />
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}
            style={{ flex: 1.3, height: 40, borderRadius: 6, fontSize: 15, fontWeight: 500, minWidth: 8 }}>
            保存任务
          </Button>
        </div>
      </Card>
      {renderStoreTargetsMobile()}
      {renderSalesMobile()}
    </div>
  );

  const renderDesktop = () => (
    <div>
      <div className="targets-header-row">
        <Space>
          <Select value={year} onChange={setYear} options={yearOptions} className="w-xs" />
          <Select value={month} onChange={setMonth} options={monthOptions} className="w-xs" />
          <Text type="secondary" style={{ fontSize: 'var(--font-size-sm)' }}>设置月度任务</Text>
        </Space>
        <Button className="targets-save-btn" icon={<SaveOutlined />} onClick={handleSave} loading={saving} type="primary">
          保存任务
        </Button>
      </div>
      {renderStoreTargetsDesktop()}
      {renderSalesDesktop()}
    </div>
  );

  return isMobile ? renderMobile() : renderDesktop();
}
