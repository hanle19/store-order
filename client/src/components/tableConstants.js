// 表格横向滚动阈值统一约定
// 替代各页面手填的魔法数（曾出现 600/780/800/860/900/1000/1100/1300/'max-content' 等散落值），
// 让「何时开始横向滚动」与列宽策略保持一致，未来调整只需改这里。
//
// 用法：
//   import { TABLE_SCROLL_X } from '../components/tableConstants';
//   <Table scroll={{ x: TABLE_SCROLL_X.standard }} />
export const TABLE_SCROLL_X = {
  compact: 900,        // 少数列：客户管理 / 日客资 / 优惠券 / 财务小表
  standard: 1100,      // 标准：订货 / 库存 / 知识管理 / 应收账款
  dense: 1300,         // 多列密集：商品管理
  fit: 'max-content',  // 列宽随内容自适应，仅在超宽时横向滚动（订单详情等）
};
