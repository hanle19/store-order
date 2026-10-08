import { useState, useEffect, useMemo, useRef, lazy, Suspense, useCallback } from 'react';
import {
  Button, Badge, Drawer, Form, Empty, message, Grid, Segmented, Checkbox,
} from 'antd';
import {
  ShoppingCartOutlined, SearchOutlined, CloseOutlined, DeleteOutlined,
  ShopOutlined, FilterOutlined, PictureOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../api';
import { useCart } from '../context/CartContext';
import { useBrand } from '../context/BrandContext';
import { ProductCard, QtyStepper } from './ProductCard';
import { ProductDetailModal } from './ProductDetailModal';
import { displayPrice, itemDisplayPrice } from './Shop.constants';
import { fireConfetti } from '../components/Confetti';

const { useBreakpoint } = Grid;
const CheckoutView = lazy(() => import('./CheckoutView'));

const isCanceled = (err) =>
  err && (err.code === 'ERR_CANCELED' || err.name === 'CanceledError' || err.message === 'canceled');

export default function Shop() {
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isDesktop = !!screens.lg;

  const { brand } = useBrand();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [showAllNames, setShowAllNames] = useState(false);
  const [category, setCategory] = useState('all');
  const [selectedBrands, setSelectedBrands] = useState([]);
  const [sortBy, setSortBy] = useState('default');
  const [brands, setBrands] = useState([]);
  const {
    cart, setCart, addToCart: ctxAddToCart, updateCartQty, removeFromCart, clearCart,
    cartCount, cartTotal, checkoutItemsTotal,
  } = useCart();
  const [cartOpen, setCartOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState(null);
  const [detailQty, setDetailQty] = useState(1);
  const [checkoutMode, setCheckoutMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [salespersons, setSalespersons] = useState([]);
  const [form] = Form.useForm();
  const scrollRef = useRef(null);
  // 促销：开关式，默认全关，对现有价格/财务逻辑零影响
  const [promoFlags, setPromoFlags] = useState({ promo_enabled: false, promo_coupon_enabled: false, promo_bundle_enabled: false });
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponValid, setCouponValid] = useState(false);
  const [couponMsg, setCouponMsg] = useState('');
  const [verifyingCoupon, setVerifyingCoupon] = useState(false);
  const [externalAmt, setExternalAmt] = useState(0);
  const [amountManual, setAmountManual] = useState(false);
  const [bundles, setBundles] = useState([]);
  // 抖音订单 / 抖音券核销（独立于门店促销开关，按零售价自动核减 external_coupon_amount）
  const [isDouyin, setIsDouyin] = useState(false);
  const [douyinCode, setDouyinCode] = useState('');
  const [douyinDiscount, setDouyinDiscount] = useState(0);
  const [douyinValid, setDouyinValid] = useState(false);
  const [douyinMsg, setDouyinMsg] = useState('');
  const [verifyingDouyin, setVerifyingDouyin] = useState(false);

  const parseImages = (p) => {
    if (Array.isArray(p.images)) return p.images;
    try { return JSON.parse(p.images || '[]'); } catch { return []; }
  };

  const loadProducts = async (signal) => {
    setLoading(true);
    try {
      const res = await api.get('/products', { params: { active: 1 }, signal });
      setProducts(res.data.map(p => ({ ...p, images: parseImages(p) })));
    } catch (err) {
      if (isCanceled(err)) return;
      if (err.response && err.response.status === 401) return;
      // 网络错误自动重试一次
      try {
        const res2 = await api.get('/products', { params: { active: 1 }, signal });
        setProducts(res2.data.map(p => ({ ...p, images: parseImages(p) })));
      } catch (e2) {
        if (isCanceled(e2) || (e2.response && e2.response.status === 401)) return;
        message.error('加载商品失败');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadBrands = async () => {
    try { const res = await api.get('/products/brands/list'); setBrands(res.data || []); } catch { /* ignore */ }
  };
  const loadSalespersons = async () => {
    try { const res = await api.get('/users/salespersons'); setSalespersons(res.data); } catch { /* ignore */ }
  };

  useEffect(() => {
    const ac = new AbortController();
    loadProducts(ac.signal);
    loadBrands();
    loadSalespersons();
    loadPromoConfig();
    loadBundles();
    return () => ac.abort();
  }, []);

  // 读取促销开关（默认全关）
  const loadPromoConfig = async () => {
    try {
      const res = await api.get('/config');
      const c = res.data || {};
      setPromoFlags({
        promo_enabled: c.promo_enabled === '1',
        promo_coupon_enabled: c.promo_coupon_enabled === '1',
        promo_bundle_enabled: c.promo_bundle_enabled === '1',
      });
    } catch { /* ignore */ }
  };

  // 可用套餐（开单页一键选套餐）
  const loadBundles = async () => {
    try {
      const res = await api.get('/bundles', { params: { available: 1 } });
      setBundles(res.data || []);
    } catch { /* ignore */ }
  };

  // 券核销：后端重新计算减额（防前端造假）；仅记录，不强制改成交价
  const verifyCouponNow = async () => {
    const code = couponCode.trim();
    if (!code) { message.warning('请输入优惠券码'); return; }
    setVerifyingCoupon(true);
    setCouponValid(false);
    try {
      const productIds = cart.map(c => c.product?.id).filter(Boolean);
      const res = await api.post('/coupons/verify', { code, order_amount: checkoutItemsTotal, product_ids: productIds });
      if (res.data.valid) {
        setCouponDiscount(Number(res.data.discount_amount) || 0);
        setCouponValid(true);
        setCouponMsg(`校验通过，可减 ¥${res.data.discount_amount}`);
      } else {
        setCouponDiscount(0);
        setCouponMsg(res.data.msg || '券不可用');
      }
    } catch {
      setCouponDiscount(0);
      setCouponMsg('核销失败，请重试');
    } finally {
      setVerifyingCoupon(false);
    }
  };

  // 抖音券：自动选最优抖音券并按零售价核减（写入 external_coupon_amount）
  const autoDouyin = async () => {
    setVerifyingDouyin(true);
    setDouyinValid(false);
    try {
      const productIds = cart.map(c => c.product?.id).filter(Boolean);
      const res = await api.post('/coupons/auto', { channel: 'douyin', order_amount: checkoutItemsTotal, product_ids: productIds });
      if (res.data.valid) {
        setDouyinDiscount(Number(res.data.discount_amount) || 0);
        setExternalAmt(Number(res.data.discount_amount) || 0);
        setDouyinValid(true);
        setDouyinCode(res.data.code || '');
        setDouyinMsg(`抖音券[${res.data.code}]自动核减 ¥${res.data.discount_amount}`);
      } else {
        setDouyinDiscount(0);
        setExternalAmt(0);
        setDouyinMsg(res.data.msg || '暂无可用抖音券');
      }
    } catch {
      setDouyinDiscount(0);
      setExternalAmt(0);
      setDouyinMsg('抖音券自动核销失败，请重试');
    } finally {
      setVerifyingDouyin(false);
    }
  };

  // 抖音券：手动券码核销（覆盖自动选择）
  const verifyDouyinCode = async () => {
    const code = douyinCode.trim();
    if (!code) { message.warning('请输入抖音券码'); return; }
    setVerifyingDouyin(true);
    setDouyinValid(false);
    try {
      const productIds = cart.map(c => c.product?.id).filter(Boolean);
      const res = await api.post('/coupons/verify', { code, order_amount: checkoutItemsTotal, product_ids: productIds, channel: 'douyin' });
      if (res.data.valid) {
        setDouyinDiscount(Number(res.data.discount_amount) || 0);
        setExternalAmt(Number(res.data.discount_amount) || 0);
        setDouyinValid(true);
        setDouyinMsg(`抖音券校验通过，核减 ¥${res.data.discount_amount}`);
      } else {
        setDouyinDiscount(0);
        setExternalAmt(0);
        setDouyinMsg(res.data.msg || '抖音券不可用');
      }
    } catch {
      setDouyinDiscount(0);
      setExternalAmt(0);
      setDouyinMsg('抖音券核销失败，请重试');
    } finally {
      setVerifyingDouyin(false);
    }
  };

  // 抖音订单开关切换
  const toggleDouyin = (checked) => {
    setIsDouyin(checked);
    if (checked) {
      autoDouyin();
    } else {
      setDouyinValid(false);
      setDouyinDiscount(0);
      setDouyinCode('');
      setDouyinMsg('');
      setExternalAmt(0);
    }
  };

  // 选套餐：拆明细加入购物车（真实商品，供库存/出库），套餐价作为成交价默认值（可手改）
  const addBundle = (b) => {
    if (!b.items || b.items.length === 0) return;
    b.items.forEach(it => {
      const product = products.find(p => p.id === it.product_id) || {
        id: it.product_id, name: it.product_name, price: it.product_price || 0,
        brand: '', model: '', spec: '', images: [], category: 'order',
      };
      ctxAddToCart(product, it.qty || 1);
    });
    form.setFieldValue('actual_amount', b.combo_price);
    message.success({ content: `已加入套餐「${b.name}」，成交价已预填套餐价 ¥${b.combo_price}`, duration: 2.4 });
  };

  // 搜索防抖：避免每次键入都触发重渲染/过滤
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText), 250);
    return () => clearTimeout(t);
  }, [searchText]);

  const qtyOf = useMemo(() => {
    const map = {};
    cart.forEach(c => { map[c.product?.id] = (map[c.product?.id] || 0) + (c.quantity || 0); });
    return map;
  }, [cart]);

  const productNames = useMemo(() => {
    const names = [...new Set(products.map(p => p.name).filter(Boolean))];
    names.sort();
    return names;
  }, [products]);

  const categoryCount = useMemo(() => {
    const m = { all: products.length, sample: 0, gift: 0, order: 0 };
    products.forEach(p => { if (m[p.category] !== undefined) m[p.category] += 1; });
    return m;
  }, [products]);

  const filteredProducts = useMemo(() => {
    let list = products.filter(p => {
      if (category !== 'all' && p.category !== category) return false;
      if (selectedBrands.length && (!p.brand || !selectedBrands.includes(p.brand))) return false;
      if (selectedName && p.name !== selectedName) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const match = p.name?.toLowerCase().includes(q) ||
          p.brand?.toLowerCase().includes(q) ||
          p.model?.toLowerCase().includes(q) ||
          p.highlight?.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
    if (sortBy === 'price-asc') list.sort((a, b) => displayPrice(a) - displayPrice(b));
    else if (sortBy === 'price-desc') list.sort((a, b) => displayPrice(b) - displayPrice(a));
    else list.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));
    return list;
  }, [products, category, selectedBrands, selectedName, debouncedSearch, sortBy]);

  const addToCart = useCallback((product, quantity = 1, spec = '', variantPrice) => {
    ctxAddToCart(product, quantity, spec || product.spec || '', variantPrice);
    message.success({ content: '已加入购物车', duration: 1.2, icon: <ShoppingCartOutlined style={{ color: '#fff' }} /> });
  }, [ctxAddToCart]);

  const updateCheckoutItem = (idx, field, value) => {
    const newCart = [...cart];
    if (field === 'quantity') {
      newCart[idx].quantity = Math.max(1, parseInt(value) || 1);
    } else if (field === 'unit_price') {
      newCart[idx].unit_price_override = parseFloat(value) || 0;
    } else if (field === 'product_type') {
      newCart[idx].product_type = value;
    }
    setCart(newCart);
  };

  const actualAmount = Form.useWatch('actual_amount', form);
  // 自动核减应付：商品总价 − 门店券 − 抖音/外部券（9 折已含在商品总价内）
  const autoActualAmount = Math.max(0, (checkoutItemsTotal || 0) - (couponDiscount || 0) - (Number(externalAmt) || 0));
  useEffect(() => {
    // 用户未手动改过成交价时，应付金额自动跟随券核减；手改后标记 amountManual 不再覆盖
    if (checkoutMode && !amountManual) {
      form.setFieldValue('actual_amount', autoActualAmount);
    }
  }, [checkoutItemsTotal, couponDiscount, externalAmt, checkoutMode, amountManual, form]);

  const handleCheckout = async () => {
    if (!checkoutMode) return; // 防御：非结算态（如筛选栏/搜索框误操作）不触发下单
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const items = cart.map(c => ({
        product_id: c.product.id,
        product_name: c.product.name,
        product_model: c.product.model || '',
        product_type: c.product_type || c.product.category,
        spec: c.spec || c.product.spec || '',
        quantity: c.quantity,
        unit_price: c.unit_price_override !== undefined ? c.unit_price_override : (c.variant_price ?? c.product.price),
      }));
      const deliveryDate = values.delivery_date ? dayjs(values.delivery_date).format('YYYY-MM-DD') : null;
      await api.post('/orders', {
        ...values,
        delivery_date: deliveryDate,
        items,
        payment_method: values.payment_method || 'deposit',
        discount: 0,
        actual_amount: values.actual_amount || checkoutItemsTotal,
        amount_manual: amountManual,
        coupon_code: couponValid ? couponCode.trim().toUpperCase() : '',
        external_coupon_amount: Number(externalAmt) || 0,
      });
      message.success('下单成功！');
      fireConfetti();
      clearCart();
      setCartOpen(false);
      setCheckoutMode(false);
      form.resetFields();
      navigate('/orders');
    } catch (err) {
      if (err.response) message.error(err.response.data?.error || '下单失败');
    } finally {
      setSubmitting(false);
    }
  };

  // ============ 浏览视图 ============
  const renderBrowse = () => (
    <div className="shop-page-wrapper">
      {/* ===== 顶栏 ===== */}
      <header className="shop-header-bar">
        <div className="shop-header-inner">
          <div className="shop-brand" onClick={() => navigate('/')}>
            <div className="shop-logo-icon">
              <ShopOutlined />
            </div>
            {isDesktop && (
              <div className="shop-brand-text">
                <div className="shop-brand-name">{brand.site_name || '门店系统'}</div>
                <div className="shop-brand-sub">前台下单</div>
              </div>
            )}
          </div>

          <div className="shop-search-wrap">
            <SearchOutlined className="shop-search-icon" />
            <input
              className="shop-search-input"
              placeholder="搜索商品 / 品牌 / 型号"
              aria-label="搜索商品"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
            {searchText && (
              <button type="button" className="shop-search-clear" aria-label="清空搜索" onClick={() => setSearchText('')}>
                <CloseOutlined style={{ fontSize: 11 }} />
              </button>
            )}
          </div>

          <div className="shop-cart-trigger" onClick={() => setCartOpen(true)}>
            <Badge count={cartCount} offset={[-3, 3]} color={'var(--color-primary)'}>
              <div className="shop-cart-icon-btn">
                <ShoppingCartOutlined />
              </div>
            </Badge>
            {isDesktop && (
              <div className="shop-cart-info">
                <span className="shop-cart-label">购物车</span>
                <span className="shop-cart-price">¥{cartTotal.toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ===== 主体 ===== */}
      <div className="shop-main-layout">
        {/* 左侧筛选侧栏 */}
        {isDesktop && (
          <aside className="shop-sidebar">
            <div className="sidebar-title">
              <FilterOutlined /> 筛选
            </div>

            <div className="sidebar-section">
              <div className="sidebar-label">商品分类</div>
              <div className="sidebar-category-list">
                {[['all', '全部'], ['sample', '样品'], ['gift', '赠品'], ['order', '订货']].map(([key, label]) => (
                  <button type="button" key={key}
                    className={`sidebar-cat-item ${category === key ? 'active' : ''}`}
                    onClick={() => setCategory(key)}>
                    <span>{label}</span>
                    <span className="sidebar-cat-count">{categoryCount[key] ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>

            {brands.length > 0 && (
              <div className="sidebar-section">
                <div className="sidebar-label">品牌</div>
                <div className="sidebar-scroll-area">
                  <Checkbox.Group value={selectedBrands} onChange={setSelectedBrands} className="sidebar-checkbox-group">
                    {brands.map(b => (
                      <Checkbox key={b} value={b} className="sidebar-check-item">{b}</Checkbox>
                    ))}
                  </Checkbox.Group>
                </div>
              </div>
            )}

            <div className="sidebar-section">
              <div className="sidebar-label">商品名称</div>
              <div className={`sidebar-name-list${productNames.length > 20 ? ' name-list-overflow' : ''}`}>
                <button type="button"
                  className={`sidebar-name-item ${!selectedName ? 'active' : ''}`}
                  onClick={() => setSelectedName('')}>
                  全部名称
                </button>
                {(showAllNames ? productNames : productNames.slice(0, 10)).map(name => (
                  <button type="button" key={name}
                    className={`sidebar-name-item ${selectedName === name ? 'active' : ''}`}
                    onClick={() => setSelectedName(selectedName === name ? '' : name)}>
                    {name}
                  </button>
                ))}
              </div>
              {productNames.length > 10 && (
                <button type="button" className="sidebar-expand-btn"
                  onClick={() => setShowAllNames(v => !v)}>
                  {showAllNames ? '收起 ▲' : `展开全部 ${productNames.length} 个 ▼`}
                </button>
              )}
            </div>
          </aside>
        )}

        {/* 右侧商品区 */}
        <main className="shop-product-area" ref={scrollRef}>
          {/* 排序条 */}
          <div className="shop-sort-bar">
            <div className="shop-result-count">
              共 <strong>{filteredProducts.length}</strong> 款商品
            </div>
            <Segmented
              value={sortBy}
              onChange={setSortBy}
              options={[
                { label: '综合', value: 'default' },
                { label: '价格 ↑', value: 'price-asc' },
                { label: '价格 ↓', value: 'price-desc' },
              ]}
              className="shop-segmented"
            />
          </div>

          {loading ? (
            <div className="ec-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <div className="ec-skeleton-card" key={i}>
                  <div className="ec-skeleton-thumb shimmer" />
                  <div className="ec-skeleton-body">
                    <div className="ec-skeleton-line shimmer" style={{ width: '55%' }} />
                    <div className="ec-skeleton-line shimmer" style={{ width: '90%' }} />
                    <div className="ec-skeleton-line shimmer" style={{ width: '40%' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="shop-empty-wrap">
              <Empty description="没有符合条件的商品" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <div className="ec-grid">
              {filteredProducts.map((p, idx) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  qtyInCart={qtyOf[p.id] || 0}
                  isDesktop={isDesktop}
                  onAdd={addToCart}
                  onOpen={setDetailProduct}
                  index={idx}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {/* 移动端底部购物车栏 */}
      {!isDesktop && cartCount > 0 && (
        <div className="mobile-cart-bar">
          <div className="mobile-cart-left" onClick={() => setCartOpen(true)}>
            <Badge count={cartCount} offset={[-2, 2]} color={'var(--color-primary)'}>
              <div className="mobile-cart-circle"><ShoppingCartOutlined /></div>
            </Badge>
          </div>
          <div className="mobile-cart-mid" onClick={() => setCartOpen(true)}>
            <div className="mobile-cart-total">¥{cartTotal.toLocaleString()}</div>
            <div className="mobile-cart-hint">{cartCount}件商品 · 点击查看</div>
          </div>
          <Button type="primary" onClick={() => setCartOpen(true)}
            className="mobile-cart-checkout-btn">
            去结算
          </Button>
        </div>
      )}

      {/* 购物车抽屉 */}
      <Drawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        placement="right"
        width={isDesktop ? 480 : '100%'}
        styles={{ body: { padding: 0, background: 'var(--color-bg)' } }}
        title={
          <div className="drawer-header">
            <ShoppingCartOutlined className="drawer-header-icon" />
            <span>购物车 ({cartCount}件)</span>
          </div>
        }
        extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={clearCart}>清空</Button>}
        footer={cart.length > 0 ? (
          <div className="drawer-footer">
            <div className="drawer-total">
              <span className="drawer-total-label">合计</span>
              <span className="drawer-total-price">¥{cartTotal.toLocaleString()}</span>
            </div>
            <Button type="primary" onClick={() => { setCartOpen(false); setCheckoutMode(true); }}
              className="drawer-checkout-btn">
              去结算
            </Button>
          </div>
        ) : null}
      >
        {cart.length === 0 ? (
          <div className="drawer-empty"><Empty description="购物车空空如也" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
        ) : (
          <div className="drawer-cart-body">
            <div className="drawer-cart-title">商品清单</div>
            <div className="ec-scrollbar drawer-cart-list">
              {cart.map((item, idx) => {
                const imgs = item.product.images || [];
                const price = itemDisplayPrice(item);
                return (
                  <div key={`${item.product.id}__${item.spec || ''}`} className="drawer-cart-item">
                    <div className="drawer-item-thumb" onClick={() => { setDetailProduct(item.product); setCartOpen(false); }}>
                      {imgs.length > 0 ? (
                        <img src={imgs[0]} alt="" />
                      ) : (
                        <div className="drawer-item-noimg"><PictureOutlined /></div>
                      )}
                    </div>
                    <div className="drawer-item-info">
                      <div className="drawer-item-name">{item.product.name}</div>
                      <div className="drawer-item-spec">
                        {[item.product.brand, item.spec || item.product.spec, item.product.model].filter(Boolean).join(' · ') || '\u00A0'}
                      </div>
                      <div className="drawer-item-bottom">
                        <span className="drawer-item-price">¥{price.toLocaleString()}</span>
                        <div className="drawer-item-actions">
                          <QtyStepper value={item.quantity} onChange={(v) => updateCartQty(idx, v - item.quantity)} />
                          <DeleteOutlined className="drawer-item-del" onClick={() => removeFromCart(idx)} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Drawer>

      {/* 商品详情 */}
      <ProductDetailModal
        product={detailProduct}
        qty={detailQty}
        setQty={setDetailQty}
        isDesktop={isDesktop}
        onClose={() => setDetailProduct(null)}
        onAdd={(p, q, spec, vPrice) => { addToCart(p, q, spec, vPrice); setDetailProduct(null); }}
        onBuy={(p, q, spec, vPrice) => { addToCart(p, q, spec, vPrice); setDetailProduct(null); setCartOpen(true); }}
      />
    </div>
  );

  return (
    <Form form={form} layout="vertical" onFinish={handleCheckout} style={{ minHeight: '100vh' }}>
      {checkoutMode ? (
        <Suspense fallback={<div className="checkout-loading">加载中…</div>}>
          <CheckoutView
            form={form}
            cart={cart}
            salespersons={salespersons}
            isDesktop={isDesktop}
            checkoutItemsTotal={checkoutItemsTotal}
            actualAmount={actualAmount}
            submitting={submitting}
            onUpdateItem={updateCheckoutItem}
            onRemove={removeFromCart}
            onBack={() => setCheckoutMode(false)}
            promoFlags={promoFlags}
            couponCode={couponCode}
            couponDiscount={couponDiscount}
            couponValid={couponValid}
            couponMsg={couponMsg}
            verifyingCoupon={verifyingCoupon}
            onCouponCodeChange={setCouponCode}
            onVerifyCoupon={verifyCouponNow}
            externalAmt={externalAmt}
            onExternalAmtChange={setExternalAmt}
            onActualAmountChange={() => setAmountManual(true)}
            isDouyin={isDouyin}
            onToggleDouyin={toggleDouyin}
            douyinCode={douyinCode}
            onDouyinCodeChange={setDouyinCode}
            onVerifyDouyin={verifyDouyinCode}
            onAutoDouyin={autoDouyin}
            douyinValid={douyinValid}
            douyinDiscount={douyinDiscount}
            douyinMsg={douyinMsg}
            verifyingDouyin={verifyingDouyin}
            bundles={bundles}
            onAddBundle={addBundle}
          />
        </Suspense>
      ) : renderBrowse()}
    </Form>
  );
}
