import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, Component } from 'react';
import Login from './pages/Login';
import Layout from './components/Layout';
import { useAuth } from './context/AuthContext';
import { useBrand } from './context/BrandContext';
import SetupWizard from './pages/SetupWizard';
import Confetti from './components/Confetti';
import PageSkeleton from './components/PageSkeleton';
import CommandPalette from './components/CommandPalette';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Shop = lazy(() => import('./pages/Shop'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const Products = lazy(() => import('./pages/Products'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Finance = lazy(() => import('./pages/Finance'));
const Settings = lazy(() => import('./pages/Settings'));
const KnowledgeFeed = lazy(() => import('./pages/KnowledgeFeed'));
const KnowledgeDetail = lazy(() => import('./pages/KnowledgeDetail'));
const KnowledgeAdmin = lazy(() => import('./pages/KnowledgeAdmin'));
const KnowledgeEditor = lazy(() => import('./pages/KnowledgeEditor'));
const DailyReport = lazy(() => import('./pages/DailyReport'));
const CustomerManagement = lazy(() => import('./pages/CustomerManagement'));
const Analytics = lazy(() => import('./pages/Analytics'));

// ── 路由级错误边界：某个页面崩了只影响自己，不拖垮整棵树 ──
class RouteErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) {
    console.error('[RouteErrorBoundary]', error.message || error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 60, textAlign: 'center', color: 'var(--color-error, #CF1322)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: 300,
        }}>
          <div style={{ fontSize: 16, marginBottom: 12 }}>该页面加载出错</div>
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)', marginBottom: 20, maxWidth: 400 }}>
            {this.state.error?.message || '未知错误'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 24px', borderRadius: 8, border: '1px solid var(--color-primary)',
              background: 'transparent', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 14,
            }}
          >
            重试
          </button>
          <button
            onClick={() => { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.href = '/login'; }}
            style={{
              padding: '8px 24px', borderRadius: 8, border: 'none',
              background: 'transparent', color: 'var(--color-text-tertiary)', cursor: 'pointer', fontSize: 14, marginLeft: 12,
            }}
          >
            退出登录
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// 用法：<WithErrBoundary><LazyComponent /></WithErrBoundary>
function WithErrBoundary({ children }) {
  return <RouteErrorBoundary>{children}</RouteErrorBoundary>;
}

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token');
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

// 角色路由守卫：仅允许指定角色访问
function RoleRoute({ children, allow }) {
  const { user } = useAuth();
  const role = user?.role || null;
  if (!allow.includes(role)) {
    return <Navigate to={role === 'sales' ? '/daily' : '/dashboard'} replace />;
  }
  return children;
}

// 登录后落地页：导购进入销售日报，其余进入工作台
function Landing() {
  const { user } = useAuth();
  const role = user?.role || null;
  return <Navigate to={role === 'sales' ? '/daily' : '/dashboard'} replace />;
}

export default function App() {
  const { user } = useAuth();
  const { brand, loaded } = useBrand();
  // 初始化向导：仅 admin 且尚未完成初始化时强制弹出（复位/首次部署后）
  const showWizard = loaded && user?.role === 'admin' && brand.setup_completed !== '1';
  if (showWizard) return <SetupWizard />;

  return (
    <>
      <Confetti />
      <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Landing />} />
          <Route path="dashboard" element={<WithErrBoundary><RoleRoute allow={['admin', 'boss']}><Dashboard /></RoleRoute></WithErrBoundary>} />
          <Route path="shop" element={<WithErrBoundary><Shop /></WithErrBoundary>} />
          <Route path="orders" element={<WithErrBoundary><Orders /></WithErrBoundary>} />
          <Route path="orders/:id" element={<WithErrBoundary><OrderDetail /></WithErrBoundary>} />
          <Route path="products" element={<WithErrBoundary><RoleRoute allow={['admin', 'boss']}><Products /></RoleRoute></WithErrBoundary>} />
          <Route path="inventory" element={<WithErrBoundary><RoleRoute allow={['admin', 'boss']}><Inventory /></RoleRoute></WithErrBoundary>} />
          <Route path="purchases" element={<WithErrBoundary><Purchases /></WithErrBoundary>} />
          <Route path="finance" element={<WithErrBoundary><RoleRoute allow={['admin', 'boss']}><Finance /></RoleRoute></WithErrBoundary>} />
          <Route path="knowledge" element={<WithErrBoundary><KnowledgeFeed /></WithErrBoundary>} />
          <Route path="knowledge/detail/:id" element={<WithErrBoundary><KnowledgeDetail /></WithErrBoundary>} />
          <Route path="knowledge/admin" element={<WithErrBoundary><RoleRoute allow={['admin']}><KnowledgeAdmin /></RoleRoute></WithErrBoundary>} />
          <Route path="knowledge/editor" element={<WithErrBoundary><RoleRoute allow={['admin']}><KnowledgeEditor /></RoleRoute></WithErrBoundary>} />
          <Route path="knowledge/editor/:id" element={<WithErrBoundary><RoleRoute allow={['admin']}><KnowledgeEditor /></RoleRoute></WithErrBoundary>} />
          <Route path="daily" element={<WithErrBoundary><DailyReport /></WithErrBoundary>} />
          <Route path="customers" element={<WithErrBoundary><CustomerManagement /></WithErrBoundary>} />
          <Route path="analytics" element={<WithErrBoundary><RoleRoute allow={['admin', 'boss']}><Analytics /></RoleRoute></WithErrBoundary>} />
          <Route path="settings" element={<WithErrBoundary><RoleRoute allow={['admin']}><Settings /></RoleRoute></WithErrBoundary>} />
        </Route>
      </Routes>
      <CommandPalette />
    </Suspense>
    </>
  );
}
