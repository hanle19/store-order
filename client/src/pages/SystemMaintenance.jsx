import { useState } from 'react';
import { Button, Modal, Input, Alert, Typography, message } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import AutoBackupCard from './AutoBackupCard';
import SystemLogsCard from './SystemLogsCard';

const CONFIRM_WORD = '确认重置';

export default function SystemMaintenance() {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);

  const openModal = () => {
    setConfirmText('');
    setOpen(true);
  };

  const handleReset = async () => {
    if (confirmText.trim() !== CONFIRM_WORD) {
      message.error(`请输入「${CONFIRM_WORD}」以解锁按钮`);
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/system/reset');
      if (res.data.success) {
        message.success('系统已恢复出厂设置，正在退出登录…');
        setOpen(false);
        // 重置会重建 users 表，直接整页跳转到登录页最稳妥（清理全部前端状态，避免过渡期渲染异常）
        setTimeout(() => {
          try {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.removeItem('brand');       // 清品牌缓存（复位后旧值会导致向导延迟/不弹）
            localStorage.removeItem('site_name');   // 清旧版品牌名缓存
          } catch (e) { /* ignore */ }
          window.location.href = '/login';
        }, 1000);
      } else {
        message.error(res.data.error || '重置失败');
      }
    } catch (e) {
      message.error(e.response?.data?.error || '重置失败');
    } finally {
      setLoading(false);
    }
  };

  const matched = confirmText.trim() === CONFIRM_WORD;

  return (
    <div>
      {/* 自动备份状态与系统日志（管理员排障用，免登服务器） */}
      <AutoBackupCard />
      <SystemLogsCard />

      <Alert
        type="error"
        showIcon
        icon={<WarningOutlined />}
        message="危险操作：一键初始化（恢复出厂设置）"
        description={
          <div style={{ lineHeight: 1.8 }}>
            此操作将：
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li>清空所有经营数据（订单、客户、商品、库存、销售日报、知识库、配送、采购、财务、操作日志等）</li>
              <li>重置所有系统配置（站点信息、品牌、合同、企业微信、月度目标等）</li>
              <li>删除全部导购账号，仅保留默认管理员 <Typography.Text code>admin / admin123</Typography.Text></li>
            </ul>
            执行前系统会<strong>自动备份数据库到磁盘</strong>，但此操作本身<strong>不可逆</strong>，请务必确认。
          </div>
        }
      />

      <div style={{ marginTop: 24 }}>
        <Button danger type="primary" onClick={openModal}>
          一键初始化系统
        </Button>
      </div>

      <Modal
        title={<span style={{ color: '#cf1322' }}><WarningOutlined /> 确认恢复出厂设置？</span>}
        open={open}
        onOk={handleReset}
        onCancel={() => !loading && setOpen(false)}
        okText="确认重置"
        cancelText="取消"
        okButtonProps={{ danger: true, loading, disabled: !matched }}
        closable={!loading}
        maskClosable={!loading}
        destroyOnClose
      >
        <p>此操作不可恢复，系统将清空所有数据并删除导购账号。执行前会自动备份数据库。</p>
        <p>请在下框输入 <Typography.Text strong>{CONFIRM_WORD}</Typography.Text> 以解锁「确认重置」按钮：</p>
        <Input
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder={`请输入：${CONFIRM_WORD}`}
          status={confirmText && !matched ? 'error' : ''}
          onPressEnter={handleReset}
        />
      </Modal>
    </div>
  );
}
