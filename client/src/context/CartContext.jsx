import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

const CartContext = createContext(null);

// 购物车持久化到 sessionStorage：
// - 切换模块（Shop 卸载/重挂）时由 Provider 保活，不会清空
// - 同一标签页内整页刷新也可恢复
// - 关闭标签页/浏览器自动清除（符合"当班会话购物车"语义）
const STORAGE_KEY = 'store_order_cart';

function safeParseJSON(txt, fallback) {
  try { return txt ? JSON.parse(txt) : fallback; } catch { return fallback; }
}

function readInitialCart() {
  try { return safeParseJSON(sessionStorage.getItem(STORAGE_KEY), []); } catch { return []; }
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState(readInitialCart);

  useEffect(() => {
    try {
      if (cart && cart.length) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore quota / private mode */ }
  }, [cart]);

  // 加入购物车：相同 product.id + spec 合并数量
  const addToCart = (product, quantity = 1, spec = '', variantPrice) => {
    setCart(prev => {
      const idx = prev.findIndex(c => c.product?.id === product.id && c.spec === spec);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: (next[idx].quantity || 0) + quantity };
        return next;
      }
      return [...prev, { product, quantity, spec, variant_price: variantPrice || undefined, product_type: product.category }];
    });
  };

  // 增减 1（最小 1）
  const updateCartQty = (idx, delta) => {
    setCart(prev => {
      const next = [...prev];
      if (next[idx]) next[idx].quantity = Math.max(1, (next[idx].quantity || 0) + delta);
      return next;
    });
  };

  // 直接设置数量（最小 1）
  const setCartQty = (idx, val) => {
    setCart(prev => {
      const next = [...prev];
      if (next[idx]) next[idx].quantity = Math.max(1, val);
      return next;
    });
  };

  const removeFromCart = (idx) => setCart(prev => prev.filter((_, i) => i !== idx));
  // 仅"手动清空"或"下单成功"调用；切换模块不会触发
  const clearCart = () => setCart([]);

  const cartCount = useMemo(() => cart.reduce((s, c) => s + (c.quantity || 0), 0), [cart]);
  // 价格优先级：variant_price（规格价）> unit_price_override（手动改单价）> product.price（零售价）
  const itemPrice = (c) => {
    if (c.variant_price !== undefined && c.variant_price !== null) return c.variant_price;
    if (c.unit_price_override !== undefined) return c.unit_price_override;
    return c.product?.price || 0;
  };
  const cartTotal = useMemo(() => cart.reduce((s, c) => s + itemPrice(c) * (c.quantity || 0), 0), [cart]);
  const checkoutItemsTotal = useMemo(() => cart.reduce((s, c) => {
    const price = c.unit_price_override !== undefined ? c.unit_price_override : itemPrice(c);
    return s + price * (c.quantity || 0);
  }, 0), [cart]);

  return (
    <CartContext.Provider value={{ cart, setCart, addToCart, updateCartQty, setCartQty, removeFromCart, clearCart, cartCount, cartTotal, checkoutItemsTotal }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const c = useContext(CartContext);
  if (!c) throw new Error('useCart must be used within CartProvider');
  return c;
}
