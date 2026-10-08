import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Tag, Table, Space, message, Alert, Grid, Typography, Tooltip, Skeleton,
} from 'antd';
import {
  CloudUploadOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import api from '../api';

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '0 B';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${dateKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 调度器每 30 分钟检查一次、且只在 hour 那一小时执行，故已过该点或今日已备则顺延到次日
function computeNextRun(status) {
  if (!status?.enabled) return '已关闭';
  const hour = Number(status.hour ?? 3);
  const now = new Date();
  const today = dateKey(now);
  const doneToday = String(status.latest?.name || '').startsWith(`auto-${today}`);
  const next = new Date(now);
  if (doneToday || now.getHours() >= hour) next.setDate(next.getDate() + 1);
  return `${dateKey(next)} ${pad(hour)}:00 之后`;
}

function MetricCell({ label, value, hint }) {
  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-light)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-md)',
        minWidth: 0,
      }}
    >
      <div className="text-aux">{label}</div>
      <div style={{ marginTop: 'var(--space-xs)', fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-text)', wordBreak: 'break-all' }}>
        {value}
      </div>
      {hint ? <div className="text-aux" style={{ marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

export default function AutoBackupCard() {
  const [status, setStatus] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [st, bk] = await Promise.all([
        api.get('/system/auto-backup/status'),
        api.get('/system/backups'),
      ]);
      setStatus(st.data || {});
      setFiles(Array.isArray(bk.data?.data) ? bk.data.data : []);
    } catch (e) {
      console.error('加载自动备份状态失败', e);
      message.error(e.response?.data?.error || '加载自动备份状态失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await api.post('/system/auto-backup/run', null, { timeout: 180000 });
      const d = res.data || {};
      if (d.ok === false || d.success === false) {
        message.error(d.error || '备份失败');
      } else if (d.skipped) {
        message.warning(d.reason || '已跳过本次备份');
      } else {
        message.success(`备份完成：${d.file || ''}${d.size ? `（${formatBytes(d.size)}）` : ''}`);
      }
      await load();
    } catch (e) {
      message.error(e.response?.data?.error || '立即备份失败');
    } finally {
      setRunning(false);
    }
  };

  const enabled = !!status?.enabled;
  const lastResult = status?.lastResult;
  const latest = status?.latest;

  const columns = [
    {
      title: '文件名',
      dataIndex: 'name',
      key: 'name',
      render: (name) => (
        <Tooltip title={name}>
          <span style={{ wordBreak: 'break-all' }}>{name}</span>
        </Tooltip>
      ),
    },
    {
      title: '类型',
      dataIndex: 'name',
      key: 'kind',
      width: 90,
      render: (name) => (String(name).startsWith('auto-')
        ? <Tag color="blue">自动</Tag>
        : <Tag>手动</Tag>),
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 110,
      align: 'right',
      render: (v) => formatBytes(v),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v) => formatTime(v),
    },
  ];

  return (
    <Card
      title={<span><CloudUploadOutlined /> 自动备份</span>}
      extra={(
        <Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
          <Button size="small" type="primary" loading={running} onClick={runNow}>立即备份</Button>
        </Space>
      )}
      style={{ marginBottom: 'var(--space-xl)' }}
    >
      {loading && !status ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <>
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {!enabled && (
              <Alert
                type="warning"
                showIcon
                message="自动备份已关闭（服务端环境变量 AUTO_BACKUP=off）"
                description="当前不会定时备份。请移除该环境变量并重启服务，或手动点击「立即备份」。"
              />
            )}
            {lastResult && lastResult.ok === false && (
              <Alert
                type="error"
                showIcon
                icon={<CloseCircleOutlined />}
                message={`最近一次备份失败：${lastResult.error || '未知错误'}`}
                description={`触发方式：${lastResult.reason === 'scheduled' ? '定时' : '手动'} · 时间：${formatTime(lastResult.at)}`}
              />
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
                gap: 'var(--space-md)',
              }}
            >
              <MetricCell
                label="状态"
                value={enabled
                  ? <Tag color="success" icon={<CheckCircleOutlined />}>已启用</Tag>
                  : <Tag color="error" icon={<CloseCircleOutlined />}>已关闭</Tag>}
                hint={enabled ? `每天 ${pad(Number(status?.hour ?? 3))}:00 后执行` : '不会自动执行'}
              />
              <MetricCell
                label="下次执行"
                value={<span><ClockCircleOutlined /> {computeNextRun(status)}</span>}
                hint="每 30 分钟检查一次，当日已备则跳过"
              />
              <MetricCell
                label="最近备份"
                value={latest ? formatTime(latest.createdAt) : '暂无'}
                hint={latest ? `${latest.name} · ${formatBytes(latest.size)}` : '尚未生成任何自动备份'}
              />
              <MetricCell
                label="保留份数"
                value={`${status?.count ?? 0} / ${status?.keep ?? 30}`}
                hint="超出上限自动清理最旧的"
              />
            </div>

            <div className="text-aux">
              备份目录：<Typography.Text code>{status?.dir || '—'}</Typography.Text>
              （含完整数据库与全部上传附件，可用于一键恢复）
            </div>
          </Space>

          <div style={{ marginTop: 'var(--space-lg)' }}>
            <div className="text-aux" style={{ marginBottom: 'var(--space-sm)' }}>
              备份文件清单（最新在前，共 {files.length} 份）
            </div>
            <Table
              rowKey="name"
              size="small"
              columns={columns}
              dataSource={files}
              pagination={files.length > 8 ? { pageSize: 8, size: 'small' } : false}
              locale={{ emptyText: '暂无备份文件' }}
            />
          </div>
        </>
      )}
    </Card>
  );
}
