import { useState } from 'react';
import { Tabs, Card, Grid, Segmented } from 'antd';
import { ShopOutlined, HomeOutlined, GiftOutlined, DatabaseOutlined, SettingOutlined, AimOutlined } from '@ant-design/icons';
import UserManagement from './UserManagement';
import MonthlyTargets from './MonthlyTargets';
import DeliveryPersons from './DeliveryPersons';
import ContractSettings from './ContractSettings';
import BrandSettings from './BrandSettings';
import WecomSettings from './WecomSettings';
import PromoSettings from './PromoSettings';
import CouponManagement from './CouponManagement';
import BundleManagement from './BundleManagement';
import InventorySettings from './InventorySettings';
import PricingSettings from './PricingSettings';
import SystemMaintenance from './SystemMaintenance';
import DataBackup from './DataBackup';
import WarehouseSettings from './WarehouseSettings';
import StoreManagement from './StoreManagement';
import StorePerformance from './StorePerformance';
import { useAuth } from '../context/AuthContext';
import { useBrand } from '../context/BrandContext';
import PageHeader from '../components/PageHeader';

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { brand } = useBrand();
  const siteName = brand.site_name || '门店系统';
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  // ===== 五大分区（按业务域合并 16 项设置）=====
  const adminGroups = [
    {
      key: 'store',
      icon: <ShopOutlined />,
      label: '门店与团队',
      subs: [
        { key: 'store-mgmt', label: '门店管理', el: <StoreManagement /> },
        { key: 'store-perf', label: '分店业绩', el: <StorePerformance /> },
        { key: 'users', label: '用户管理', el: <UserManagement /> },
        { key: 'delivery-persons', label: '配送师傅', el: <DeliveryPersons /> },
        { key: 'targets', label: '每月任务', el: <MonthlyTargets /> },
      ],
    },
    {
      key: 'brand',
      icon: <HomeOutlined />,
      label: '品牌与单据',
      subs: [
        { key: 'brand', label: '品牌设置', el: <BrandSettings /> },
        { key: 'contract', label: '合同设置', el: <ContractSettings /> },
      ],
    },
    {
      key: 'promo',
      icon: <GiftOutlined />,
      label: '促销与优惠',
      subs: [
        { key: 'promo', label: '促销设置', el: <PromoSettings /> },
        { key: 'coupons', label: '优惠券', el: <CouponManagement /> },
        { key: 'bundles', label: '捆绑套餐', el: <BundleManagement /> },
      ],
    },
    {
      key: 'stock',
      icon: <DatabaseOutlined />,
      label: '库存与定价',
      subs: [
        { key: 'inventory', label: '库存设置', el: <InventorySettings /> },
        { key: 'warehouse', label: '库房设置', el: <WarehouseSettings /> },
        { key: 'pricing', label: '利润设置', el: <PricingSettings /> },
      ],
    },
    {
      key: 'system',
      icon: <SettingOutlined />,
      label: '系统与数据',
      subs: [
        { key: 'wecom', label: '企业微信', el: <WecomSettings /> },
        { key: 'data-backup', label: '数据备份', el: <DataBackup /> },
        // 危险操作仍置于末位
        { key: 'maintenance', label: '系统维护', el: <SystemMaintenance /> },
      ],
    },
  ];

  const groups = isAdmin
    ? adminGroups
    : [{ key: 'targets-only', icon: <AimOutlined />, label: '每月任务', subs: [{ key: 'targets', label: '每月任务', el: <MonthlyTargets /> }] }];

  // 每个分区内当前激活的子项
  const [subByGroup, setSubByGroup] = useState(() => {
    const m = {};
    groups.forEach(g => { m[g.key] = g.subs[0].key; });
    return m;
  });
  // 已访问过的子项（首次激活才挂载，切换后保留状态，模拟 Tabs 的 keep-alive）
  // 初始包含每个分区的第一个子项：分区面板被激活时（antd Tabs 懒挂载）首屏内容即渲染
  const [visited, setVisited] = useState(() => new Set(groups.map(g => `${g.key}:${g.subs[0].key}`)));

  const switchSub = (groupKey, subKey) => {
    setSubByGroup(prev => ({ ...prev, [groupKey]: subKey }));
    setVisited(prev => {
      if (prev.has(`${groupKey}:${subKey}`)) return prev;
      const next = new Set(prev);
      next.add(`${groupKey}:${subKey}`);
      return next;
    });
  };

  const renderGroup = (g) => {
    const activeSub = subByGroup[g.key] || g.subs[0].key;
    const showSubnav = g.subs.length > 1;
    return (
      <div className="settings-group">
        {showSubnav && (
          <div className="settings-subnav">
            <Segmented
              size={isMobile ? 'small' : 'middle'}
              value={activeSub}
              onChange={(v) => switchSub(g.key, v)}
              options={g.subs.map(s => ({ label: s.label, value: s.key }))}
            />
          </div>
        )}
        <div>
          {g.subs.filter(s => visited.has(`${g.key}:${s.key}`)).map(s => (
            <div key={s.key} style={{ display: s.key === activeSub ? undefined : 'none' }}>
              {s.el}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const items = groups.map(g => ({
    key: g.key,
    label: <span>{g.icon} {g.label}</span>,
    children: renderGroup(g),
  }));

  // 仅移动端附加样式，桌面端一律走 antd 默认
  const cardBodyStyle = isMobile ? { padding: 16 } : undefined;
  const tabsMobileProps = isMobile
    ? { tabBarGutter: 0, className: 'settings-tabs settings-tabs-mobile' }
    : {};

  return (
    <>
      <PageHeader title="系统设置" subtitle="门店 · 品牌 · 促销 · 库存 · 系统" />
      <Card styles={{ body: cardBodyStyle }}>
      <Tabs
        defaultActiveKey={groups[0].key}
        items={items}
        {...tabsMobileProps}
      />
    </Card>
    </>
  );
}
