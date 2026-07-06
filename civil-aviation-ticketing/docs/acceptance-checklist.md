# 验收清单

| 模块 | 要求 | 当前状态 | 证据 |
|---|---|---|---|
| ToB授权 | 首次联网邀请码激活、设备绑定、本地签名授权校验、联网复核停用/过期 | Pass | `server/license/*`、`tests/license-*.test.ts`、`tests/license-scripts-e2e.test.ts` |
| 首页查询 | 机场/城市、三字码、日期、成人/儿童/婴儿人数 | Pass | `src/App.tsx` 搜索表单 |
| 机场数据 | 覆盖国内主流与境外常用三字码，含名称、地区、机场 | Pass | `src/data/cities.ts` 72 条，含用户指定 57 个三字码 |
| 城市校验 | 出发到达不能相同 | Pass | `validateFlightSearch`、`tests/domain.test.ts` |
| 航班列表 | 航班号、机场、时间、时长、机型、余票、舱位、价格、航司标识 | Pass | `src/App.tsx` 航班卡片 |
| 排序 | 出发时间、价格、时长排序 | Pass | `sortedFlights` |
| 成人预订 | 成人字段和年龄校验 | Pass | `validatePassenger`、前端乘机人表单 |
| 儿童预订 | 2-12周岁并关联成人 | Pass | `validatePassenger`、测试 |
| 婴儿预订 | 14天-2周岁并关联成人 | Pass | `validatePassenger`、测试 |
| UM | 5-12周岁，送机/接机人 | Pass | 前端“添加UM儿童”、测试 |
| 联系人 | 姓名、电话、邮箱 | Pass | `src/App.tsx` 联系人信息 |
| 订单确认 | 航班、旅客、价格、规则摘要 | Pass | `summary-panel` |
| 舱位库存 | 下单后余票扣减、余票不足阻止下单 | Pass | `applyInventory`、`tests/api.test.ts` |
| 订单管理 | 列表、详情、取消、退票、同航线改签 | Pass | `src/App.tsx` 订单管理、`server/server.ts`、`tests/api.test.ts` |
| 运输规则 | 行李、退票、改签、特殊旅客 | Pass | `src/data/rules.ts`、规则页面 |
| 电子客票 | PNR、票号、航班/时间/机场、旅客证件、二维码区域、打印/PDF模拟 | Pass | `OrderTicket` |
| 响应式 | PC/平板/手机 | Pass | `src/styles.css` media queries |
| Loading/Error | 加载和错误提示 | Pass | `notice`、`loading` 状态 |
| 二次确认 | 关键操作确认 | Pass | `window.confirm` |
| Windows桌面 | Electron 打包 x64/arm64 exe，配置自定义图标 | Pass | `release/民航客票销售订座系统-1.1.0-x64.exe`、`release/民航客票销售订座系统-1.1.0-arm64.exe` |
| 测试 | 核心领域规则、API、机场/航线数据测试 | Pass | `npm test` 55 tests |
| 安全审计 | 生产依赖 audit 无 high/critical | Pass | `npm audit --omit=dev --audit-level=high` 通过；dev/build 链风险见 data/security review |
