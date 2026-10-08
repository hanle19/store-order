import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from './AuthContext';

const StoreContext = createContext(null);
const STORAGE_KEY = 'selected_store_id';

export function StoreProvider({ children }) {
  const { user } = useAuth();
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'all'; } catch (e) { return 'all'; }
  });
  const [loading, setLoading] = useState(true);

  // 拉取门店列表
  const refreshStores = useCallback(async () => {
    try {
      const res = await api.get('/stores');
      setStores(res.data?.stores || []);
    } catch (e) {
      // 后端可能未重启 /stores 路由，兜底默认门店
      setStores([{ id: 1, name: '默认门店', is_active: 1 }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshStores(); }, [refreshStores]);

  // 用户就绪后：sales 锁定自身店、admin/boss 校验选中店有效性
  useEffect(() => {
    if (!user || !stores.length) return;
    if (user.role === 'sales') {
      const sid = user.store_id;
      if (sid && String(storeId) !== String(sid)) {
        setStoreId(String(sid));
        try { localStorage.setItem(STORAGE_KEY, String(sid)); } catch (e) {}
      }
    } else {
      // admin/boss：如果选中的店已停用或不存在，重置为全部
      const activeIds = stores.filter(s => s.is_active).map(s => String(s.id));
      if (storeId !== 'all' && !activeIds.includes(String(storeId))) {
        setStoreId('all');
        try { localStorage.setItem(STORAGE_KEY, 'all'); } catch (e) {}
      }
    }
  }, [user, stores]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchStore = useCallback((id) => {
    setStoreId(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) {}
  }, []);

  // 返回 API 用的 store_id 参数：'all' → undefined（不传），具体 id → 数字
  const getStoreParam = useCallback(() => {
    if (storeId === 'all') return undefined;
    const sid = parseInt(storeId, 10);
    return sid > 0 ? sid : undefined;
  }, [storeId]);

  const currentStore = stores.find(s => String(s.id) === String(storeId));
  const isAllStores = storeId === 'all';

  return (
    <StoreContext.Provider value={{
      stores, storeId, currentStore, isAllStores,
      switchStore, getStoreParam, loading, refreshStores,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const c = useContext(StoreContext);
  if (!c) throw new Error('useStore must be used within StoreProvider');
  return c;
}
