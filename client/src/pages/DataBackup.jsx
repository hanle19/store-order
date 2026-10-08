import { useState } from 'react';
import { Button, Upload, Alert, Typography, message, Modal, Input } from 'antd';
import { DownloadOutlined, UploadOutlined, WarningOutlined, DatabaseOutlined } from '@ant-design/icons';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const CONFIRM_WORD = '确认恢复';

export default function DataBackup() {
  const { logout } = useAuth();
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [file, setFile] = useState(null); // 选中的备份 File

  const handleBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await api.post('/system/backup', null, {
        responseType: 'blob',
        timeout: 180000,
      });
      // 解析服务端建议的文件名
      let fname = `wanan-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`;
      const cd = res.headers['content-disposition'];
      if (cd) {
        const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
        if (m) fname = m[1];
      }
      const blob = new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      message.success('备份已生成，已开始下载');
    } catch (e) {
      message.error(e.response?.data?.error || '备份失败');
    } finally {
      setBackupLoading(false);
    }
  };

  const beforeUpload = (f) => {
    if (!/\.zip$/i.test(f.name)) {
      message.error('仅支持 .zip 备份文件');
      return Upload.LIST_IGNORE;
    }
    setFile(f);
    return false; // 阻止自动上传，仅收集文件
  };

  const openRestoreModal = () => {
    if (!file) {
      message.warning('请先选择备份文件 (.zip)');
      return;
    }
    setConfirmText('');
    setOpen(true);
  };

  const doRestore = async () => {
    if (confirmText.trim() !== CONFIRM_WORD) {
      message.error(`请输入「${CONFIRM_WORD}」以解锁按钮`);
      return;
    }
    setRestoreLoading(true);
    try {
      const form = new FormData();
      form.append('backup', file);
      const res = await api.post('/system/restore', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600000,
      });
      if (res.data.success) {
        message.success('恢复成功，即将退出登录以载入新数据');
        setOpen(false);
        setTimeout(() => logout(), 1200);
      } else {
        message.error(res.data.error || '恢复失败');
      }
    } catch (e) {
      message.error(e.response?.data?.error || '恢复失败');
    } finally {
      setRestoreLoading(false);
    }
  };

  const matched = confirmText.trim() === CONFIRM_WORD;

  return (
    <div>
      {/* 一键备份 */}
      <Alert
        type="info"
        showIcon
        icon={<DatabaseOutlined />}
        message="一键备份（数据库 + 全部图片/视频）"
        description={
          <div style={{ lineHeight: 1.8 }}>
            将打包下载一个 <Typography.Text code>.zip</Typography.Text> 备份文件，内含完整的业务数据库
            （订单 / 客户 / 商品 / 库存 / 知识库 / 财务 / 配置等全部模块）以及所有上传的图片与视频。
            建议定期下载并保存到安全位置。
          </div>
        }
      />
      <div style={{ marginTop: 16 }}>
        <Button type="primary" icon={<DownloadOutlined />} loading={backupLoading} onClick={handleBackup}>
          一键备份并下载
        </Button>
      </div>

      <div style={{ marginTop: 32, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 24 }}>
        {/* 一键恢复 */}
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="一键恢复（从备份文件还原）"
          description={
            <div style={{ lineHeight: 1.8 }}>
              选择一个此前下载的 <Typography.Text code>.zip</Typography.Text> 备份文件，将其中的数据库与图片/视频覆盖回当前系统。
              恢复前系统会<strong>自动备份当前数据</strong>（可在服务器 <Typography.Text code>data/backups</Typography.Text> 目录找到），
              但恢复完成后需<strong>重新登录</strong>。
            </div>
          }
        />
        <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Upload
            accept=".zip"
            maxCount={1}
            beforeUpload={beforeUpload}
            onRemove={() => setFile(null)}
            showUploadList={{ showRemoveIcon: true }}
          >
            <Button icon={<UploadOutlined />}>选择备份文件 (.zip)</Button>
          </Upload>
          <Button danger type="primary" loading={restoreLoading} disabled={!file} onClick={openRestoreModal}>
            一键恢复
          </Button>
        </div>
        {file && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            已选择：{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）
          </Typography.Text>
        )}
      </div>

      <Modal
        title={<span style={{ color: '#cf1322' }}><WarningOutlined /> 确认恢复数据？</span>}
        open={open}
        onOk={doRestore}
        onCancel={() => !restoreLoading && setOpen(false)}
        okText="确认恢复"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: restoreLoading, disabled: !matched }}
        closable={!restoreLoading}
        maskClosable={!restoreLoading}
        destroyOnClose
      >
        <p>恢复将用备份文件<strong>覆盖</strong>当前所有数据与图片，且会重新登录。系统已自动备份当前数据，但请再次确认。</p>
        <p>请在下框输入 <Typography.Text strong>{CONFIRM_WORD}</Typography.Text> 以解锁「确认恢复」按钮：</p>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={`请输入：${CONFIRM_WORD}`}
          status={confirmText && !matched ? 'error' : ''}
          onPressEnter={doRestore}
        />
      </Modal>
    </div>
  );
}
