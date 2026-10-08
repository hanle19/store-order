import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Modal, Input } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  DashboardOutlined, ShopOutlined, FileTextOutlined, UserOutlined,
  ShoppingCartOutlined, AppstoreOutlined, TruckOutlined, DatabaseOutlined,
  WalletOutlined, ReadOutlined, SettingOutlined, PlusOutlined,
  ReloadOutlined, BulbOutlined,
} from '@ant-design/icons';

// 导航项（与 Layout 菜单同源，按角色过滤）
const NAV = [
  { key: '/dashboard', label: '工作台', icon: <DashboardOutlined />, roles: ['admin', 'boss'] },
  { key: '/shop', label: '前台下单', icon: <ShopOutlined />, roles: ['admin', 'boss', 'sales'] },
  { key: '/daily', label: '销售日报', icon: <FileTextOutlined />, roles: ['admin', 'boss', 'sales'] },
  { key: '/customers', label: '客户管理', icon: <UserOutlined />, roles: ['admin', 'boss', 'sales'] },
  { key: '/orders', label: '订单管理', icon: <ShoppingCartOutlined />, roles: ['admin', 'boss', 'sales'] },
  { key: '/products', label: '商品管理', icon: <AppstoreOutlined />, roles: ['admin', 'boss'] },
  { key: '/purchases', label: '订货管理', icon: <TruckOutlined />, roles: ['admin', 'boss', 'sales'] },
  { key: '/inventory', label: '库存管理', icon: <DatabaseOutlined />, roles: ['admin', 'boss'] },
  { key: '/finance', label: '财务管理', icon: <WalletOutlined />, roles: ['admin', 'boss'] },
  { key: '/knowledge', label: '知识库', icon: <ReadOutlined />, roles: ['admin', 'boss', 'sales'] },
  { key: '/settings', label: '系统设置', icon: <SettingOutlined />, roles: ['admin'] },
];

/**
 * 全局命令面板。Ctrl/Cmd+K 唤起，支持跨页导航 + 快捷操作，键盘上下选择、回车跳转。
 * 角色过滤与 Layout 菜单一致——导购仅见其可用页面。
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { mode, setMode } = useTheme();
  const role = user?.role || 'sales';
  const inputRef = useRef(null);

  // 全局快捷键 Ctrl/Cmd + K
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 打开时重置并聚焦
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const actions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const navItems = NAV
      .filter((n) => n.roles.includes(role))
      .filter((n) => !q || n.label.toLowerCase().includes(q) || n.key.toLowerCase().includes(q))
      .map((n) => ({ ...n, group: '导航' }));

    const quick = [
      { key: 'qa-new-order', label: '新建订单', icon: <PlusOutlined />, group: '快捷操作', action: () => navigate('/orders') },
      { key: 'qa-new-customer', label: '新建客户', icon: <UserOutlined />, group: '快捷操作', action: () => navigate('/customers') },
      { key: 'qa-theme', label: mode === 'dark' ? '切换到亮色' : '切换到暗色', icon: <BulbOutlined />, group: '快捷操作', action: () => setMode(mode === 'dark' ? 'light' : 'dark') },
      { key: 'qa-reload', label: '刷新当前页', icon: <ReloadOutlined />, group: '快捷操作', action: () => window.location.reload() },
    ].filter((a) => !q || a.label.toLowerCase().includes(q));

    return [...navItems, ...quick];
  }, [query, role, mode, navigate, setMode]);

  useEffect(() => { setActive(0); }, [query]);

  const choose = (item) => {
    if (!item) return;
    setOpen(false);
    if (item.action) item.action();
    else if (item.key && item.key.startsWith('/')) navigate(item.key);
  };

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, actions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(actions[active]);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      closable={false}
      title={null}
      width={560}
      style={{ top: 80 }}
      destroyOnClose
      styles={{ body: { padding: 0 } }}
    >
      <div className="cmd-palette">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          variant="borderless"
          placeholder="搜索页面或快捷操作…（↑↓ 选择，Enter 跳转，Esc 关闭）"
          style={{ fontSize: 15, padding: '12px 16px', borderBottom: '1px solid var(--color-border-light)' }}
          prefix={<span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>Ctrl K</span>}
        />
        <div className="cmd-palette__list">
          {actions.length === 0 && <div className="cmd-palette__empty">无匹配结果</div>}
          {actions.map((item, i) => (
            <div
              key={item.key}
              className={`cmd-palette__item ${i === active ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
            >
              <span
                className="cmd-palette__icon"
                style={{ color: item.group === '导航' ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
              >
                {item.icon}
              </span>
              <span className="cmd-palette__label">{item.label}</span>
              <span className="cmd-palette__group">{item.group}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
