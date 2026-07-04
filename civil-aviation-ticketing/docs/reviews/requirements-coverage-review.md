# 需求覆盖最终 Review

评审对象：`civil-aviation-ticketing` 当前实现  
需求来源：`~/Downloads/民航客票销售订座系统_需求文档.docx`  
评审方式：分 agent 初审 + 整改后本地复核。

## 总体结论

判定：**Pass，可作为教学/实训模拟系统交付。**

系统已按方案 C 重新实现，旧 `hangkong.zip` 未作为主工程继续硬改。当前实现覆盖 P0/P1/P2 主流程，并已生成 Windows 桌面 portable 应用。

## 覆盖清单

| 模块 | 需求 | 状态 | 证据 |
|---|---|---|---|
| 首页查询 | 出发/到达机场或城市、三字码、日期、成人/儿童/婴儿人数、搜索按钮 | Pass | `src/App.tsx` 搜索页 |
| 机场数据 | 不少于 50 个机场/城市展示项，含名称、三字码、地区、机场 | Pass | `src/data/cities.ts` 72 条，覆盖用户指定 57 个三字码 |
| 下拉搜索 | 城市名、三字码、机场名搜索，点击自动全选，可用“换”按钮清空重选 | Pass | `CitySearchInput` + `datalist` |
| 城市校验 | 出发到达不能相同 | Pass | `validateFlightSearch`、`tests/domain.test.ts` |
| 航班查询 | 航班号、机场、时间、时长、机型、客座率/余票、舱位、价格、航司标识 | Pass | `src/App.tsx` 航班卡、`src/data/flights.ts`，10466 条模拟航班 |
| 排序 | 出发时间、价格、航程时长排序 | Pass | `sortedFlights` |
| 成人票 | 成人字段、证件、有效期、电话、邮箱、18-70 周岁 | Pass | `validatePassenger`、表单字段 |
| 儿童票 | 2-12 周岁、关联成人 | Pass | `validatePassenger`、测试 |
| 婴儿票 | 14 天-2 周岁、关联成人 | Pass | `validatePassenger`、测试 |
| UM | 5-12 周岁，送机人、接机人、备注 | Pass | `addUmPassenger`、UM 表单、测试 |
| 联系人 | 姓名、电话、邮箱 | Pass | `validateContact`、联系人表单 |
| 订单确认 | 航班、旅客、价格明细、规则摘要、二次确认 | Pass | `summary-panel`、`window.confirm` |
| 订单生成 | 订单号、PNR、票号 | Pass | `createOrder`、`tests/domain.test.ts` |
| 订单管理 | 列表、详情、取消、退票、改签模拟 | Pass | `src/App.tsx`、`server/orderStore.ts` |
| 运输规则 | 行李、退票、改签、特殊旅客、CAAC 参照依据 | Pass | `src/data/rules.ts`、规则页 |
| 电子客票/行程单 | PNR、票号、航班、时间、机场、旅客、二维码、登机口留空、打印/PDF 模拟 | Pass | `OrderTicket` |
| 非功能 | 蓝色主色、橙色强调、响应式、loading/error、字段级校验 | Pass | `src/styles.css`、Playwright 截图 |
| 交付物 | 源码、数据库设计、学生说明、教师手册、验收清单、测试数据 | Pass | `docs/*.md` |
| Windows 桌面 | x64/arm64 portable exe | Pass | `release/*.exe` |

## 剩余说明

- 当前是教学模拟系统，不连接真实航司、真实支付、真实票务。
- 数据库采用本地 JSON 持久化，文档中说明了迁移到关系型数据库的表结构建议。
- 改签流程为模拟操作，未实现真实航司改签库存锁定。
