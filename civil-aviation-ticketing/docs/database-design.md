# 数据库设计文档

当前实现使用本地 JSON 文件作为教学模拟数据库，便于 Windows 单机桌面运行；Web/机房部署时可把相同模型迁移到 MySQL/PostgreSQL。

## 存储位置

- 开发环境：`civil-aviation-ticketing/.local-data/orders.json`
- Windows 桌面环境：Electron `app.getPath('userData')/orders.json`
- 自定义目录：设置环境变量 `CA_TICKETING_DATA_DIR` 后，订单会写入该目录下的 `orders.json`

## 实体设计

### City 城市

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 城市名称 |
| code | string | 三字码，如 PEK |
| province | string | 省份/自治区/直辖市 |
| airport | string | 机场名称 |

数据文件：`src/data/cities.ts`，当前包含 72 个机场/城市展示项，覆盖用户指定 57 个国内主流与境外常用三字码。

### Flight 航班

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 航班内部 ID |
| flightNo | string | 航班号 |
| airline/logoText | string | 承运航司和展示标识 |
| fromCityCode/toCityCode | string | 出发/到达城市三字码 |
| fromAirport/toAirport | string | 出发/到达机场 |
| departureTime/arrivalTime | string | 起飞/到达时间 |
| durationMinutes | number | 飞行分钟数 |
| aircraft | string | 机型 |
| loadFactor | number | 客座率 |
| cabins | CabinInventory[] | 头等、公务、经济舱价格与余票 |

数据文件：`src/data/flights.ts` 与 `src/data/imported-flight-data.json`。当前运行时合计 10466 条模拟航班，其中合并下载文件中的 242 条结构化航班数据，并为机场两两组合生成至少 2 班可订座模拟航班。


### License 授权文件

桌面版授权文件保存在订单数据目录同级的 `license.json`。文件内容包含授权单位、设备 hash、有效期、功能列表和 Ed25519 签名；客户端只内置公钥，不能伪造新授权。授权服务邀请码数据库默认位于 `.license-server/invites.json`，部署时可通过 `CA_LICENSE_DB_PATH` 指定。

### Passenger 乘机人

支持成人、儿童、婴儿、无成人陪伴儿童。

| 字段 | 说明 |
|---|---|
| id/type/name/gender/birthDate | 基本信息 |
| documentType/documentNumber/documentExpiry | 证件信息 |
| phone/email | 联系方式 |
| linkedAdultId | 儿童/婴儿关联成人 |
| sender/receiver/note | UM 送机人、接机人、特殊说明 |

### Order 订单

| 字段 | 说明 |
|---|---|
| id/orderNo | 订单主键和订单号 |
| pnr | 6 位模拟 PNR |
| flightId/flightDate/route/cabinClass | 航程与舱位 |
| status | 下单成功/已取消/已退票/已改签 |
| passengers/contact | 乘机人与联系人 |
| tickets | 每名乘机人的模拟票号与票价 |
| totalAmount | 总金额 |
| refund/change | 退票/改签模拟结果 |

## 迁移到关系型数据库建议

- `cities(code PK)`
- `flights(id PK, from_city_code FK, to_city_code FK)`
- `cabins(id PK, flight_id FK, cabin_class, fare, remaining_seats)`
- `orders(id PK, order_no, pnr, status, total_amount, created_at)`
- `passengers(id PK, order_id FK, type, name, birth_date, document_type, document_number)`
- `tickets(ticket_no PK, order_id FK, passenger_id FK, fare)`
- `order_operations(id PK, order_id FK, type, fee, refund_amount, created_at)`

## 当前实现说明

- 航班、机场/城市和运输规则是代码内置教学数据，航班数据包含手工种子、下载文件合并数据与全航线生成数据。
- 订单由服务端派生票价、航线、航班快照和票号，不信任客户端传入价格。
- 写入 JSON 时使用临时文件加 rename，降低并发写入时文件损坏风险。
