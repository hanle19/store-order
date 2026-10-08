import { Dropdown } from 'antd';
import { ShopOutlined, DownOutlined, CheckOutlined } from '@ant-design/icons';
import { useRef, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';

export default function StoreSwitcher() {
  const { user } = useAuth();
  const { stores, storeId, switchStore, loading } = useStore();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const [menuMinWidth, setMenuMinWidth] = useState(undefined);
  const role = user?.role || 'sales';

  // sales：只读显示自身门店名，视觉高度与 admin 触发器保持一致
  if (role === 'sales') {
    const myStore = stores.find(s => String(s.id) === String(user?.store_id));
    return (
      <div className="header-store-readonly">
        <ShopOutlined style={{ color: 'var(--color-text-tertiary)', fontSize: 14 }} />
        <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
          {myStore?.name || '默认门店'}
        </span>
      </div>
    );
  }

  // admin/boss：按钮式 Dropdown 切换（替代 Select，视觉与主题切换控件统一）
  const activeStores = stores.filter(s => s.is_active);
  const currentKey = String(storeId ?? 'all');
  const currentLabel =
    currentKey === 'all'
      ? '全部门店'
      : activeStores.find(s => String(s.id) === currentKey)?.name || '全部门店';

  const renderItemLabel = (name, selected) => (
    <span className="header-store-menu-label">
      <span className="header-store-menu-check">
        {selected ? <CheckOutlined /> : null}
      </span>
      {name}
    </span>
  );

  const items = [
    { key: 'all', label: renderItemLabel('全部门店', currentKey === 'all') },
    ...activeStores.map(s => ({
      key: String(s.id),
      label: renderItemLabel(s.name, String(s.id) === currentKey),
    })),
  ];

  const menu = {
    items,
    selectedKeys: [currentKey],
    style: menuMinWidth ? { minWidth: menuMinWidth } : undefined,
    onClick: ({ key }) => {
      switchStore(key);
      setOpen(false);
    },
  };

  const handleOpenChange = (o) => {
    setOpen(o);
    // 展开时测量触发器宽度，菜单最小宽度与触发器对齐
    if (o && triggerRef.current) {
      setMenuMinWidth(triggerRef.current.offsetWidth);
    }
  };

  return (
    <Dropdown
      menu={menu}
      open={open}
      onOpenChange={handleOpenChange}
      trigger={['click']}
      placement="bottomRight"
      overlayClassName="header-store-menu"
      disabled={loading}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`header-store-trigger${open ? ' is-open' : ''}`}
      >
        <ShopOutlined className="header-store-trigger-icon" />
        <span className="header-store-trigger-label">{currentLabel}</span>
        <DownOutlined className="header-store-trigger-caret" />
      </button>
    </Dropdown>
  );
}
