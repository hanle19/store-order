## 变更说明 / Description
<!-- 简述本次 PR 改了什么、为什么 -->

## 关联 Issue / Related Issue
<!-- 例如 closes #12 -->

## 变更类型 / Type
- [ ] 缺陷修复 (bug fix)
- [ ] 新功能 (new feature)
- [ ] 文档 (docs)
- [ ] 重构 (refactor)
- [ ] 其他 (other)

## 自检清单 / Checklist
- [ ] 后端改动已重启验证
- [ ] 前端改动已 `node build-safe.mjs` 重新构建并生效
- [ ] 新增 / 修改接口已手测
- [ ] 运行 `npm run verify` 通过（如涉及后端）
- [ ] 未提交生产数据库、密钥、日志

## 安全提醒 / Security
- 请勿在 PR 中提交真实业务数据（`*.db`）、密钥（`.jwt_secret`、`.env`）或 `nodejs/` 运行时目录。
