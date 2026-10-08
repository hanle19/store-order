import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button, Dropdown, Avatar, Grid } from 'antd';
import {
  DashboardOutlined, ShoppingCartOutlined, AppstoreOutlined,
  DatabaseOutlined, TruckOutlined, SettingOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, LogoutOutlined, UserOutlined, ShopOutlined,
  HomeOutlined, UnorderedListOutlined, WalletOutlined, BarChartOutlined,
  ReadOutlined, FormOutlined, FileTextOutlined,
} from '@ant-design/icons';
import api from '../api';
import ThemeToggle from './ThemeToggle';
import StoreSwitcher from './StoreSwitcher';
import { useAuth } from '../context/AuthContext';
import { useBrand } from '../context/BrandContext';
import pkg from '../../package.json';

const { Header, Sider, Content } = AntLayout;
const { useBreakpoint } = Grid;

// 页脚版本标识：取「主版本.次版本」(如 4.2.0 → v4.2)，与 package.json 同步
const APP_VERSION = pkg.version.split('.').slice(0, 2).join('.');

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const { user } = useAuth();
  const { brand } = useBrand();
  const siteName = brand.site_name || '门店系统';
  const userRole = user?.role || 'sales';

  const isShopPage = location.pathname.startsWith('/shop');
  const isMobile = !screens.md;

  // 角色中文
  const roleLabel =
    userRole === 'admin' ? '管理员' : userRole === 'boss' ? '老板' : '导购';

  // 菜单项
  const allMenuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '工作台' },
    { key: '/shop', icon: <ShopOutlined />, label: '前台下单' },
    { key: '/daily', icon: <FileTextOutlined />, label: '销售日报' },
    { key: '/customers', icon: <UserOutlined />, label: '客户管理' },
    { key: '/orders', icon: <ShoppingCartOutlined />, label: '订单管理' },
    { key: '/products', icon: <AppstoreOutlined />, label: '商品管理' },
    { key: '/purchases', icon: <TruckOutlined />, label: '订货管理' },
    { key: '/inventory', icon: <DatabaseOutlined />, label: '库存管理' },
    { key: '/finance', icon: <WalletOutlined />, label: '财务管理' },
    { key: '/analytics', icon: <BarChartOutlined />, label: '经营分析' },
    { key: '/knowledge', icon: <ReadOutlined />, label: '知识库' },
    { key: '/knowledge/admin', icon: <FormOutlined />, label: '知识管理', adminOnly: true },
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
  ];

  const menuItems = allMenuItems.filter(item => {
    if (item.adminOnly && userRole !== 'admin') return false;
    if (userRole === 'sales') {
      // 导购仅可见：前台下单、销售日报、知识库
      return ['/shop', '/daily', '/knowledge'].includes(item.key);
    }
    if (userRole !== 'admin') {
      return item.key !== '/settings';
    }
    return true;
  });

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const selectedKey = location.pathname.startsWith('/knowledge/admin') || location.pathname.startsWith('/knowledge/editor')
    ? '/knowledge/admin'
    : '/' + location.pathname.split('/')[1];

  // ============================================
  // 前台下单 — 全屏移动布局
  // ============================================
  if (isShopPage) {
    return (
      <AntLayout style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
        <Header style={{
          background: 'var(--color-bg-white)', padding: '0 16px', height: 56, lineHeight: '56px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--color-border-light)',
          position: 'sticky', top: 0, zIndex: 101,
        }}>
          <div className="header-control-group">
            <Button type="text" icon={<MenuUnfoldOutlined />}
              onClick={() => navigate('/dashboard')}
              style={{ fontSize: 18, color: 'var(--color-text)' }} />
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--color-text)' }}>前台下单</span>
          </div>
          <div className="header-control-group">
            <StoreSwitcher />
            <ThemeToggle />
          </div>
          <Dropdown menu={{
            items: [
              { key: 'role', label: `${user?.display_name} (${roleLabel})`, disabled: true },
              { type: 'divider' },
              { key: 'dashboard', label: '返回管理后台', onClick: () => navigate('/dashboard') },
              { key: 'orders', label: '订单管理', onClick: () => navigate('/orders') },
              ...(userRole !== 'sales' ? [{ key: 'products', label: '商品管理', onClick: () => navigate('/products') }] : []),
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: handleLogout },
            ],
          }}>
            <Button type="text" icon={<UserOutlined />} />
          </Dropdown>
        </Header>
        <Content style={{ overflow: 'auto', background: 'var(--color-bg)' }}>
          <Outlet />
        </Content>
      </AntLayout>
    );
  }

  // ============================================
  // 移动端管理后台 — 顶部 Header + 底部 Tab
  // ============================================
  if (isMobile) {
    const mainTabs = menuItems.slice(0, 4);
    const moreTabs = menuItems.slice(4);
    const isMoreActive = moreTabs.some(m => m.key === selectedKey);

    return (
      <AntLayout style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
        <Header style={{
          background: 'var(--color-bg-white)', padding: '0 16px', height: 56, lineHeight: '56px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--color-border-light)',
          position: 'sticky', top: 0, zIndex: 101,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <HomeOutlined style={{ fontSize: 18, color: 'var(--color-primary)' }} />
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--color-text)', letterSpacing: 1 }}>{siteName}</span>
          </div>
          <div className="header-control-group">
            <StoreSwitcher />
            <ThemeToggle />
          </div>
          <Dropdown menu={{
            items: [
              { key: 'role', label: `${user?.display_name} (${roleLabel})`, disabled: true },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: handleLogout },
            ],
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <Avatar size={28} style={{ background: 'var(--color-primary)', fontSize: 12, fontWeight: 500 }}>
                {user?.display_name?.charAt(0) || 'A'}
              </Avatar>
            </div>
          </Dropdown>
        </Header>

        <Content style={{ overflow: 'auto', background: 'var(--color-bg)', paddingBottom: 104, display: 'flex', flexDirection: 'column' }}>
          <div className="app-admin-content" style={{ flex: 1 }}>
            <Outlet />
          </div>
          <footer style={{
            marginTop: 16, paddingTop: 12,
            textAlign: 'center', fontSize: 11,
            color: 'var(--color-text-tertiary)',
            userSelect: 'none',
          }}>
            v{APP_VERSION} · 门店管理系统
          </footer>
        </Content>

        {/* 底部 Tab — 88px */}
        <div className="mobile-tab-bar" style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
          background: 'var(--color-bg-white)', borderTop: '1px solid var(--color-border-light)',
          display: 'flex', justifyContent: 'space-around', alignItems: 'stretch',
          height: 88, paddingBottom: 'env(safe-area-inset-bottom, 0)',
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
        }}>
          {mainTabs.map(item => {
            const active = selectedKey === item.key;
            return (
              <div key={item.key} onClick={() => navigate(item.key)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 4,
                  cursor: 'pointer', minWidth: 0,
                  color: active ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                  fontWeight: active ? 600 : 400,
                  transition: 'color 0.2s ease',
                }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{item.icon}</span>
                <span style={{ fontSize: 12, whiteSpace: 'nowrap', lineHeight: 1 }}>{item.label}</span>
              </div>
            );
          })}
          {moreTabs.length > 0 && (
          <Dropdown menu={{
            items: moreTabs.map(m => ({
              key: m.key, label: m.label, icon: m.icon, onClick: () => navigate(m.key),
            })),
          }} placement="topRight">
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 4,
              cursor: 'pointer', minWidth: 0,
              color: isMoreActive ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
              fontWeight: isMoreActive ? 600 : 400,
              transition: 'color 0.2s ease',
            }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>
                <UnorderedListOutlined />
              </span>
              <span style={{ fontSize: 12, whiteSpace: 'nowrap', lineHeight: 1 }}>更多</span>
            </div>
          </Dropdown>
          )}
        </div>
      </AntLayout>
    );
  }

  // ============================================
  // PC 桌面端 — 固定左侧栏
  // ============================================
  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        collapsedWidth="0"
        width={240}
        style={{
          background: 'var(--color-sidebar)',
          borderRight: '1px solid var(--color-border-light)',
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 10,
        }}
      >
        {/* Logo */}
        <div style={{
          height: 60, display: 'flex', alignItems: 'center',
          justifyContent: 'center', gap: 8,
          borderBottom: '1px solid var(--color-border-light)',
        }}>
          <HomeOutlined style={{ fontSize: 22, color: 'var(--color-primary)' }} />
          {!collapsed && (
            <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', letterSpacing: 2 }}>
              {siteName}
            </span>
          )}
        </div>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => { navigate(key); isMobile && setCollapsed(true); }}
          style={{ background: 'transparent', borderInlineEnd: 'none', paddingTop: 8 }}
        />
      </Sider>

      <AntLayout style={{ marginLeft: collapsed ? 0 : 240, transition: 'margin-left 0.2s ease' }}>
        <Header style={{
          background: 'var(--color-bg-white)', padding: '0 24px', height: 60, lineHeight: '60px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--color-border-light)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
          position: 'sticky', top: 0, zIndex: 9,
        }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ color: 'var(--color-text-tertiary)', fontSize: 18 }}
          />

          <div className="header-control-group" style={{ gap: 12 }}>
            <StoreSwitcher />
            <ThemeToggle />
          </div>

          <Dropdown menu={{
            items: [
              { key: 'role', label: `角色: ${roleLabel}`, disabled: true },
              { type: 'divider' },
              { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: handleLogout },
            ],
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer', padding: '4px 12px', borderRadius: 8,
              transition: 'background 0.2s ease',
            }}>
              <Avatar size={30} style={{ background: 'var(--color-primary)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                {user?.display_name?.charAt(0) || 'A'}
              </Avatar>
              <span style={{ fontSize: 14, color: 'var(--color-text)', fontWeight: 500 }}>
                {user?.display_name}
              </span>
            </div>
          </Dropdown>
        </Header>

        <Content style={{
          padding: 24, minHeight: 'calc(100vh - 60px)',
          background: 'var(--color-bg)', overflow: 'auto',
          display: 'flex', flexDirection: 'column',
        }}>
          <div className="app-admin-content" style={{ flex: 1 }}>
            <Outlet />
          </div>
          <footer style={{
            marginTop: 24, paddingTop: 16,
            textAlign: 'center', fontSize: 12,
            color: 'var(--color-text-tertiary)',
            borderTop: '1px solid var(--color-border-light)',
            userSelect: 'none',
          }}>
            v{APP_VERSION} · 门店管理系统
          </footer>
        </Content>
      </AntLayout>
    </AntLayout>
  );
}
