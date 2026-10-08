import { useState, useRef } from 'react';
import { Button, Dropdown, message } from 'antd';
import {
  DownloadOutlined, UploadOutlined, FileExcelOutlined, FileTextOutlined,
} from '@ant-design/icons';
import api from '../api';

const C = {
  primary: 'var(--color-primary)',
  border: '#EAE6E2',
  text: '#333333',
  textLight: '#888888',
};

/**
 * ExcelImportExport component
 * @param {string} module - 'orders' | 'products' | 'inventory' | 'purchases' | 'finance'
 * @param {object} params - extra query params for export (e.g. { year, month })
 * @param {function} onImported - callback after successful import (e.g. reload data)
 * @param {boolean} compact - show compact button (just icon)
 */
export default function ExcelImportExport({ module, params = {}, onImported, compact = false, buttonStyle = {} }) {
  const [importOpen, setImportOpen] = useState(false);
  const fileRef = useRef(null);

  const handleExport = async () => {
    try {
      message.loading({ content: '正在导出...', key: 'excel-export', duration: 0 });
      const res = await api.get(`/excel/export/${module}`, {
        params,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers['content-disposition'] || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      a.download = match ? decodeURIComponent(match[1]) : `${module}_export.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      message.success({ content: '导出成功', key: 'excel-export' });
    } catch (err) {
      console.error('导出失败:', err);
      message.error({ content: '导出失败', key: 'excel-export' });
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await api.get(`/excel/template/${module}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${module}_导入模板.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      message.error('下载模板失败');
    }
  };

  const handleImport = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    // For finance, pass year/month
    if (module === 'finance' && params.year && params.month) {
      formData.append('year', params.year);
      formData.append('month', params.month);
    }

    const hide = message.loading('正在导入...', 0);
    try {
      const res = await api.post(`/excel/import/${module}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      hide();
      message.success(res.data.message || '导入成功');
      if (onImported) onImported();
    } catch (err) {
      hide();
      message.error(err.response?.data?.error || '导入失败');
    }
    return false; // prevent auto upload
  };

  const menuItems = [
    { key: 'export', icon: <DownloadOutlined />, label: '导出 Excel', onClick: handleExport },
    { key: 'import', icon: <UploadOutlined />, label: '导入 Excel', onClick: () => fileRef.current?.click() },
    { key: 'template', icon: <FileTextOutlined />, label: '下载模板', onClick: handleDownloadTemplate },
  ];

  if (compact) {
    return (
      <>
        <Dropdown menu={{ items: menuItems }} placement="bottomRight">
          <Button icon={<FileExcelOutlined />} style={{ borderColor: C.border, ...buttonStyle }}>Excel</Button>
        </Dropdown>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files[0];
            if (file) handleImport(file);
            e.target.value = '';
          }}
        />
      </>
    );
  }

  return (
    <>
      <Dropdown menu={{ items: menuItems }} placement="bottomRight">
        <Button icon={<FileExcelOutlined />} style={{ borderColor: C.border, color: C.text, ...buttonStyle }}>
          Excel 导入导出
        </Button>
      </Dropdown>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files[0];
          if (file) handleImport(file);
          e.target.value = '';
        }}
      />
    </>
  );
}
