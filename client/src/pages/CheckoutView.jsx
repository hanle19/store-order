import React from 'react';
import { Form, Input, Select, DatePicker, InputNumber, Button, Divider, Tag, Collapse, Alert, Space, Switch } from 'antd';
import {
  UserOutlined, PhoneOutlined, EnvironmentOutlined, ShoppingCartOutlined,
  ArrowLeftOutlined, DeleteOutlined, PictureOutlined, TagOutlined,
} from '@ant-design/icons';
import { C, paymentOptions, itemDisplayPrice } from './Shop.constants';

// ============ 区域标题 ============
function SectionTitle({ icon, title }) {
  return (
    <div className="section-title-bar">
      {icon}<span>{title}</span>
    </div>
  );
}

// ============ 结算视图 ============
export default function CheckoutView({
  form, cart, salespersons, isDesktop,
  checkoutItemsTotal, actualAmount, submitting,
  onUpdateItem, onRemove, onBack,
  promoFlags, couponCode, couponDiscount, couponValid, couponMsg,
  verifyingCoupon, onCouponCodeChange, onVerifyCoupon,
  externalAmt, onExternalAmtChange, onActualAmountChange,
  isDouyin, onToggleDouyin, douyinCode, onDouyinCodeChange,
  onVerifyDouyin, onAutoDouyin, douyinValid, douyinDiscount, douyinMsg, verifyingDouyin,
  bundles, onAddBundle,
}) {
  return (
    <div className="shop-page-wrapper">
      <div className="checkout-topbar">
        <button type="button" className="checkout-back-btn" aria-label="返回商品浏览" onClick={onBack}>
          <ArrowLeftOutlined />
        </button>
        <span className="checkout-topbar-title">确认订单</span>
      </div>

      <div className="checkout-layout">
        {/* 左：表单 */}
        <div className="checkout-form-col">
          <div className="checkout-card">
            <SectionTitle icon={<UserOutlined />} title="客户信息" />
            <Form.Item name="customer_name" rules={[{ required: true, message: '请输入客户姓名' }]} label="客户姓名">
              <Input placeholder="请输入客户姓名" />
            </Form.Item>
            <Form.Item name="customer_phone" label="联系电话">
              <Input placeholder="请输入联系电话" prefix={<PhoneOutlined style={{ color: C.textLight }} />} />
            </Form.Item>
            <Form.Item name="customer_address" label="送货地址">
              <Input.TextArea rows={2} placeholder="请输入送货地址" prefix={<EnvironmentOutlined style={{ color: C.textLight }} />} />
            </Form.Item>
            <Form.Item name="delivery_date" label="送货日期">
              <DatePicker style={{ width: '100%' }} placeholder="请选择送货日期" format="YYYY-MM-DD" />
            </Form.Item>
          </div>

          <div className="checkout-card">
            <SectionTitle icon={<UserOutlined />} title="销售导购" />
            <Form.Item name="salesperson_id" label="销售导购">
              <Select placeholder="请选择销售导购" showSearch optionFilterProp="label"
                options={salespersons.map(s => ({ value: s.id, label: `${s.display_name}${s.phone ? '（' + s.phone + '）' : ''}` }))}
                onChange={(value) => {
                  const sp = salespersons.find(s => s.id === value);
                  if (sp) { form.setFieldValue('salesperson_name', sp.display_name); form.setFieldValue('salesperson_phone', sp.phone || ''); }
                }} />
            </Form.Item>
            <Form.Item name="salesperson_name" hidden><Input /></Form.Item>
            <Form.Item name="salesperson_phone" hidden><Input /></Form.Item>
            {form.getFieldValue('salesperson_name') && (
              <div className="salesperson-chip">
                <UserOutlined className="sp-chip-icon" />
                <div>
                  <div className="sp-chip-name">{form.getFieldValue('salesperson_name')}</div>
                  {form.getFieldValue('salesperson_phone') && (
                    <div className="sp-chip-phone"><PhoneOutlined style={{ marginRight: 4 }} />{form.getFieldValue('salesperson_phone')}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="checkout-card">
            {/* 标题 + 分割线 */}
            <div className="checkout-list-header">
              <SectionTitle icon={<ShoppingCartOutlined />} title={`商品清单（共${cart.reduce((s, i) => s + i.quantity, 0)}件）`} />
              <div className="checkout-header-divider" />
            </div>

            {/* 全局表头 — 仅桌面端显示 */}
            {isDesktop && (
              <div className="checkout-table-header">
                <span className="checkout-th checkout-th-spec">规格</span>
                <span className="checkout-th checkout-th-type">类型</span>
                <span className="checkout-th checkout-th-qty">数量</span>
                <span className="checkout-th checkout-th-price">单价(¥)</span>
                <span className="checkout-th checkout-th-sub">小计</span>
                <span className="checkout-th checkout-th-action">操作</span>
              </div>
            )}

            {/* 商品卡片列表 */}
            <div className="checkout-items-body">
              {cart.map((item, idx) => {
                const imgs = item.product.images || [];
                const price = itemDisplayPrice(item);
                const itemTotal = price * item.quantity;
                return (
                  <div key={`${item.product?.id ?? 'p'}-${item.spec || ''}`} className="co-product-card">
                    {/* 卡片头部：图片 + 名称型号 + 删除按钮 */}
                    <div className="co-card-head">
                      <div className="co-card-left">
                        <div className="co-thumb">
                          {imgs.length > 0 ? (
                            <img src={imgs[0]} alt="" />
                          ) : (
                            <div className="co-noimg"><PictureOutlined /></div>
                          )}
                        </div>
                        <div className="co-info">
                          <div className="co-name">{item.product.name}</div>
                          <div className="co-model">{[item.product.brand, item.product.model].filter(Boolean).join(' · ') || '\u00A0'}</div>
                        </div>
                      </div>
                      <button type="button" className="co-del-btn" onClick={() => onRemove(idx)}>
                        <DeleteOutlined /> 删除该商品
                      </button>
                    </div>

                    {/* 规格行 — 与全局表头严格对齐，无重复标签 */}
                    <div className="co-spec-row">
                      <div className="co-cell co-cell-spec">
                        <Input value={item.spec || item.product.spec || ''} disabled placeholder="规格" />
                      </div>
                      <div className="co-cell co-cell-type">
                        <Select value={item.product_type || item.product.category} onChange={v => onUpdateItem(idx, 'product_type', v)}
                          options={[{ value: 'sample', label: '样品' }, { value: 'gift', label: '赠品' }, { value: 'order', label: '订货' }]} />
                      </div>
                      <div className="co-cell co-cell-qty">
                        <InputNumber value={item.quantity} onChange={v => onUpdateItem(idx, 'quantity', v)} min={1} />
                      </div>
                      <div className="co-cell co-cell-price">
                        <InputNumber value={price} onChange={v => onUpdateItem(idx, 'unit_price', v)} min={0} />
                      </div>
                      <div className="co-cell co-cell-sub">
                        <span className="co-subtotal">¥{itemTotal.toLocaleString()}</span>
                      </div>
                      <div className="co-cell co-cell-action" />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 底部汇总栏 */}
            <div className="co-summary-bar">
              <div className="co-summary-left">
                共 <b>{cart.length}</b> 种商品，合计 <b>{cart.reduce((s, i) => s + i.quantity, 0)}</b> 件
              </div>
              <div className="co-summary-right">
                <span className="co-summary-label">总计金额</span>
                <span className="co-summary-amount">¥{checkoutItemsTotal.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* 促销 / 优惠：总开关关闭时不渲染，对现有价格/财务逻辑零影响 */}
          {promoFlags?.promo_enabled && (
            <div className="checkout-card">
              <SectionTitle icon={<TagOutlined />} title="促销 / 优惠" />
              {promoFlags.promo_coupon_enabled && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: C.text, marginBottom: 8 }}>优惠券核销</div>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      placeholder="输入优惠券码"
                      value={couponCode}
                      onChange={(e) => onCouponCodeChange(e.target.value)}
                      onPressEnter={onVerifyCoupon}
                      disabled={submitting}
                    />
                    <Button type="primary" loading={verifyingCoupon} onClick={onVerifyCoupon} disabled={submitting}>
                      核销
                    </Button>
                  </Space.Compact>
                  {couponMsg && (
                    <div style={{ marginTop: 8, fontSize: 'var(--font-size-sm)', color: couponValid ? C.success : C.textLight }}>
                      {couponMsg}
                    </div>
                  )}
                  {couponValid && couponDiscount > 0 && (
                    <Alert style={{ marginTop: 8 }} type="info" showIcon
                      message={`优惠券可减 ¥${couponDiscount}，已记录；实际成交价以您填写的为准`} />
                  )}
                </div>
              )}

              {promoFlags.promo_coupon_enabled && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: C.text, marginBottom: 8 }}>外部券减额（手动，如其他平台券已抵扣金额）</div>
                  <InputNumber
                    style={{ width: '100%' }} min={0} precision={2} placeholder="外部券已抵扣金额"
                    value={externalAmt || undefined}
                    onChange={(v) => onExternalAmtChange(v || 0)}
                    addonBefore="¥"
                    disabled={submitting}
                  />
                </div>
              )}

              {promoFlags.promo_bundle_enabled && bundles && bundles.length > 0 && (
                <div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: C.text, marginBottom: 8 }}>捆绑套餐（一键加入）</div>
                  <Collapse size="small" ghost items={bundles.map((b) => ({
                    key: b.id,
                    label: (
                      <span>{b.name} <Tag color="orange">¥{b.combo_price}</Tag></span>
                    ),
                    children: (
                      <div>
                        <div style={{ fontSize: 12, color: C.textLight, marginBottom: 8 }}>
                          {(b.items || []).map((it) => `${it.product_name} ×${it.qty || 1}`).join('，')}
                        </div>
                        <Button type="primary" ghost onClick={() => onAddBundle(b)} disabled={submitting}>
                          加入购物车
                        </Button>
                      </div>
                    ),
                  }))} />
                </div>
              )}
            </div>
          )}

          {/* 抖音订单卡片：独立于门店促销开关，按零售价自动核减平台券 */}
          <div className="checkout-card">
            <SectionTitle icon={<TagOutlined />} title="抖音订单 / 抖音券" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Switch checked={isDouyin} onChange={onToggleDouyin} disabled={submitting} />
              <span style={{ fontSize: 'var(--font-size-sm)', color: C.text }}>本单为抖音渠道订单（核销抖音平台券，自动记录为外部券减额）</span>
            </div>
            {isDouyin ? (
              <div>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    placeholder="输入抖音券码（留空则自动选最优券）"
                    value={douyinCode}
                    onChange={(e) => onDouyinCodeChange(e.target.value)}
                    onPressEnter={onVerifyDouyin}
                    disabled={submitting}
                  />
                  <Button type="primary" loading={verifyingDouyin} onClick={onVerifyDouyin} disabled={submitting}>
                    核销
                  </Button>
                  <Button onClick={onAutoDouyin} disabled={submitting || verifyingDouyin}>
                    自动选券
                  </Button>
                </Space.Compact>
                {douyinMsg && (
                  <div style={{ marginTop: 8, fontSize: 'var(--font-size-sm)', color: douyinValid ? C.success : C.textLight }}>
                    {douyinMsg}
                  </div>
                )}
                {douyinValid && douyinDiscount > 0 && (
                  <Alert style={{ marginTop: 8 }} type="success" showIcon
                    message={`抖音券已自动核减 ¥${douyinDiscount}，将记录为外部券减额`} />
                )}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: C.text, marginBottom: 8 }}>外部券减额（手动，如其他平台券已抵扣金额）</div>
                <InputNumber
                  style={{ width: '100%' }} min={0} precision={2} placeholder="外部券已抵扣金额"
                  value={externalAmt || undefined}
                  onChange={(v) => onExternalAmtChange(v || 0)}
                  addonBefore="¥"
                  disabled={submitting}
                />
              </div>
            )}
          </div>

          <div className="checkout-card">
            <Form.Item name="payment_method" label="支付方式" rules={[{ required: true, message: '请选择支付方式' }]}>
              <Select placeholder="请选择支付方式" options={paymentOptions} />
            </Form.Item>
            <Form.Item name="note" label="订单备注">
              <Input.TextArea rows={3} placeholder="请输入订单备注信息" />
            </Form.Item>
          </div>
        </div>

        {/* 右：订单摘要（桌面 sticky） */}
        {isDesktop && (
          <div className="checkout-summary-col">
            <div className="checkout-summary-card">
              <div className="summary-title">订单摘要</div>
              <div className="summary-row">
                <span>商品总价</span>
                <span className="summary-val">¥{checkoutItemsTotal.toLocaleString()}</span>
              </div>
              <Form.Item name="actual_amount" label="实际成交价（可手动调整）" rules={[{ required: true, message: '请输入实际成交价' }]}>
                <InputNumber style={{ width: '100%' }} min={0} prefix={<span style={{ color: C.primary }}>¥</span>} placeholder="请输入实际成交价"
                  onChange={(v) => onActualAmountChange && onActualAmountChange(v)} />
              </Form.Item>
              <Divider style={{ margin: '10px 0 14px' }} />
              <div className="summary-total-row">
                <span>应付金额</span>
                <span className="summary-total-val">¥{(actualAmount || checkoutItemsTotal).toLocaleString()}</span>
              </div>
              {couponValid && couponDiscount > 0 && (
                <div className="summary-row" style={{ fontSize: 12, color: C.textLight, marginTop: -4 }}>
                  <span>优惠券已记录</span>
                  <span className="summary-val">减 ¥{couponDiscount}</span>
                </div>
              )}
              {Number(externalAmt) > 0 && (
                <div className="summary-row" style={{ fontSize: 12, color: C.textLight, marginTop: -4 }}>
                  <span>抖音/外部券核减</span>
                  <span className="summary-val">减 ¥{Number(externalAmt).toLocaleString()}</span>
                </div>
              )}
              <Button type="primary" block onClick={() => form.submit()} loading={submitting}
                className="summary-submit-btn">
                提交订单
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 移动端底部提交栏 */}
      {!isDesktop && (
        <div className="mobile-submit-bar">
          <div className="mobile-submit-left">
            <div className="mobile-submit-label">应付金额</div>
            <div className="mobile-submit-amount">¥{(actualAmount || checkoutItemsTotal).toLocaleString()}</div>
          </div>
          <Button type="primary" onClick={() => form.submit()} loading={submitting}
            className="mobile-submit-btn">
            提交订单
          </Button>
        </div>
      )}
    </div>
  );
}
