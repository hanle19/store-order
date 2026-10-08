import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Table, Tag, Space, Segmented, DatePicker, Select, message, Empty, Typography, Grid,
} from 'antd';
import { FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../api';

const pad = (n) => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function timeOf(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function statusTag(status) {
  const n = Number(status);
  if (n >= 500) return <Tag color="error">{n}</Tag>;
  if (n >= 400) return <Tag color="warning">{n}</Tag>;
  if (n >= 300) return <Tag color="blue">{n}</Tag>;
  return <Tag color="success">{n}</Tag>;
}

export default function SystemLogsCard() {
  const [type, setType] = useState('access');
  const [date, setDate] = useState(todayStr());
  const [lines, setLines] = useState(200);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/system/logs', { params: { type, date, lines } });
      setData(res.data || {});
    } catch (e) {
      console.error('加载系统日志失败', e);
      message.error(e.response?.data?.error || '加载系统日志失败，请稍后重试');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [type, date, lines]);

  useEffect(() => { load(); }, [load]);

  const rows = (data?.lines || []).map((r, i) => ({ ...r, _key: `${i}-${r.at || ''}` }));

  const accessColumns = [
    { title: '时间', dataIndex: 'at', key: 'at', width: 90, render: (v) => timeOf(v) },
    { title: '方法', dataIndex: 'method', key: 'method', width: 80 },
    {
      title: '路径',
      dataIndex: 'path',
      key: 'path',
      render: (v) => <span style={{ wordBreak: 'break-all' }}>{v}</span>,
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: statusTag },
    {
      title: '耗时',
      dataIndex: 'ms',
      key: 'ms',
      width: 90,
      align: 'right',
      render: (v) => (Number.isFinite(Number(v)) ? `${v} ms` : '—'),
    },
    {
      title: '用户',
      dataIndex: 'userId',
      key: 'userId',
      width: 80,
      render: (v) => (v == null ? '—' : v),
    },
  ];

  const errorColumns = [
    { title: '时间', dataIndex: 'at', key: 'at', width: 90, render: (v) => timeOf(v) },
    { title: '来源', dataIndex: 'scope', key: 'scope', width: 140 },
    {
      title: '错误信息',
      dataIndex: 'message',
      key: 'message',
      render: (v) => <span style={{ wordBreak: 'break-all' }}>{v || '—'}</span>,
    },
    {
      title: '请求',
      key: 'req',
      width: 200,
      render: (_, r) => (r.method || r.path ? `${r.method || ''} ${r.path || ''}` : '—'),
    },
  ];

  return (
    <Card
      title={<span><FileTextOutlined /> 系统日志</span>}
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>}
      style={{ marginBottom: 'var(--space-xl)' }}
    >
      <Space wrap style={{ marginBottom: 'var(--space-md)' }}>
        <Segmented
          value={type}
          onChange={(v) => setType(v)}
          options={[
            { label: '请求日志', value: 'access' },
            { label: '错误日志', value: 'error' },
          ]}
        />
        <DatePicker
          value={dayjs(date, 'YYYY-MM-DD')}
          onChange={(d) => setDate(d ? d.format('YYYY-MM-DD') : todayStr())}
          allowClear={false}
          style={{ width: 140 }}
        />
        <Select
          value={lines}
          onChange={setLines}
          style={{ width: 120 }}
          options={[
            { label: '最近 100 条', value: 100 },
            { label: '最近 200 条', value: 200 },
            { label: '最近 500 条', value: 500 },
            { label: '最近 1000 条', value: 1000 },
          ]}
        />
      </Space>

      <div className="text-aux" style={{ marginBottom: 'var(--space-sm)' }}>
        {data?.exists === false
          ? `${date} 无${type === 'error' ? '错误' : '请求'}日志（当日尚无记录或已被清理）`
          : `当日共 ${data?.total ?? 0} 条，显示最近 ${rows.length} 条 · 目录 ${data?.dir || '—'} · 保留 ${data?.keepDays ?? 14} 天`}
      </div>

      {data?.exists === false ? (
        <Empty description="无日志" style={{ padding: '24px 0' }} />
      ) : (
        <Table
          rowKey="_key"
          size="small"
          loading={loading}
          columns={type === 'error' ? errorColumns : accessColumns}
          dataSource={rows}
          pagination={rows.length > 10 ? { pageSize: 10, size: 'small' } : false}
          scroll={{ x: isMobile ? 640 : 820 }}
          expandable={type === 'error' ? {
            rowExpandable: (r) => !!r.stack,
            expandedRowRender: (r) => (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 'var(--font-size-sm)' }}>
                {r.stack}
              </pre>
            ),
          } : undefined}
          locale={{ emptyText: '暂无日志记录' }}
        />
      )}

      <div className="text-aux" style={{ marginTop: 'var(--space-sm)' }}>
        日志中的 <Typography.Text code>token / password / secret</Typography.Text> 等参数已自动掩码，可安全截图转发。
      </div>
    </Card>
  );
}
