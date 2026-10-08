import { useState, useEffect, useCallback } from 'react';
import { Table, Select, Card, Space, Typography, Tag, Grid, message } from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import api from '../api';
import { formatMoney } from '../utils/format';
import PageHeader from '../components/PageHeader';

const { Text } = Typography;

function ratioColor(ratio) {
  if (ratio >= 100) return 'green';
  if (ratio >= 50) return 'gold';
  return 'red';
}

export default function StorePerformance() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/stores/comparison', { params: { year, month } });
      if (res.data.success) {
        setData(res.data.stores || []);
        setTotal(res.data.total || null);
      }
    } catch (err) {
      message.error('加载分店业绩失败');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const monthOptions = [];
  for (let m = 1; m <= 12; m++) monthOptions.push({ label: `${m}月`, value: m });
  const yearOptions = [];
  const cy = new Date().getFullYear();
  for (let y = cy - 2; y <= cy + 1; y++) yearOptions.push({ label: `${y}年`, value: y });

  const columns = [
    { title: '门店', dataIndex: 'store_name', key: 'store_name', width: 160, fixed: 'left' },
    { title: '订单数', dataIndex: 'order_count', key: 'order_count', width: 90, align: 'right' },
    {
      title: '实收金额', dataIndex: 'revenue', key: 'revenue', width: 140, align: 'right',
      render: v => <span className="money">{formatMoney(v)}</span>,
    },
    {
      title: '利润', dataIndex: 'profit', key: 'profit', width: 140, align: 'right',
      render: v => <span className="money" style={{ color: v >= 0 ? undefined : 'var(--color-error)' }}>{formatMoney(v)}</span>,
    },
    {
      title: '月度目标', dataIndex: 'target_amount', key: 'target_amount', width: 140, align: 'right',
      render: v => <span className="money">{formatMoney(v)}</span>,
    },
    {
      title: '达成率', dataIndex: 'ratio', key: 'ratio', width: 110, align: 'center',
      render: v => <Tag color={ratioColor(v)}>{v}%</Tag>,
    },
  ];

  return (
    <>
      <PageHeader
        title="分店业绩对比"
        subtitle="按月汇总各门店订单数 · 实收 · 利润 · 目标达成"
        icon={<BarChartOutlined />}
      />
      <Card styles={{ body: { padding: isMobile ? 12 : undefined } }}>
        <div className="targets-header-row" style={{ marginBottom: 16 }}>
          <Space>
            <Select value={year} onChange={setYear} options={yearOptions} className="w-xs" />
            <Select value={month} onChange={setMonth} options={monthOptions} className="w-xs" />
            <Text type="secondary" style={{ fontSize: 'var(--font-size-sm)' }}>各门店业绩对比</Text>
          </Space>
        </div>

        <Table
          className="app-data-table"
          dataSource={data}
          columns={columns}
          rowKey="store_id"
          loading={loading}
          size="middle"
          pagination={false}
          scroll={{ x: 720 }}
          rowClassName={(_, i) => i % 2 === 0 ? 'app-row-even' : 'app-row-odd'}
          summary={() => {
            if (!total) return null;
            return (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ fontWeight: 600, background: 'var(--color-bg-layout)' }}>
                  <Table.Summary.Cell index={0} fixed="left"><Text strong>合计</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">{total.order_count}</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><span className="money">{formatMoney(total.revenue)}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><span className="money">{formatMoney(total.profit)}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><span className="money">{formatMoney(total.target_amount)}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="center"><Tag color={ratioColor(total.ratio)}>{total.ratio}%</Tag></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
        />
      </Card>
    </>
  );
}
