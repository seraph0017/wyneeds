# 民航客票销售订座系统

教学/实训用途的民航客票销售订座模拟系统。系统支持浏览器访问，也可以打包成 Windows 桌面应用。

## 功能范围

- ToB 授权：桌面版首次打开需联网输入邀请码，激活后绑定本机并离线校验签名授权。
- 首页航班查询：机场/城市可搜索下拉、三字码输入、日期、成人/儿童/婴儿人数。
- 航班列表：航班号、机场、时间、时长、机型、余票、舱位和价格。
- 客票预订：成人、儿童、婴儿、无成人陪伴儿童（UM）和联系人信息。
- 订单确认：价格明细、运输规则摘要、二次确认。
- 订单管理：列表、详情、取消、退票、同航线改签模拟。
- 电子客票/行程单：PNR、票号、航班、旅客证件、二维码区域、打印/PDF 模拟。
- 运输规则：行李、退票、改签、特殊旅客规则。

## 技术栈

- React + Vite + TypeScript
- Express API
- Electron + electron-builder
- Vitest
- 本地 JSON 订单持久化

## 本地运行

```bash
npm install
npm run dev
```

访问：

```text
http://127.0.0.1:5173/
```

开发 API 默认监听：

```text
http://127.0.0.1:4176/api
```

## 测试与构建

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

2026-07-06 验收结果：

- `npm test`：55 个测试通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm audit --omit=dev --audit-level=high`：`found 0 vulnerabilities`。

## 授权激活

桌面版默认启用授权门禁。首次启动需要配置授权服务地址并输入邀请码：

```bash
# 生成供应商授权密钥，私钥不要提交或外发
npm run license:keys -- --out-dir secrets/license

# 创建一个客户邀请码
npm run license:invite -- --customer "某某培训学校" --max-devices 1 --license-days 365

# 启动可部署授权服务；正式域名部署时设置 PUBLIC_URL，并按需要开放 HOST
CA_LICENSE_PRIVATE_KEY_PATH=secrets/license/license-private-key.pem \
CA_LICENSE_PUBLIC_URL=https://license.example.com \
CA_LICENSE_HOST=127.0.0.1 \
npm run license:server

# 客户端/桌面程序激活时指向授权服务
CA_LICENSE_SERVER_URL=http://127.0.0.1:8787 npm run electron:dev
```

正式打包后的 portable exe 双击启动时不方便依赖环境变量，可在 exe 同目录、`resources` 目录或 Electron `userData` 目录放置：

```json
{
  "licenseServerUrl": "https://license.example.com"
}
```

说明：

- 授权文件保存在 Electron `userData/license.json`，联网复核状态保存在 `userData/license-state.json`。复制 exe 到其他电脑后，设备指纹不匹配，无法进入业务系统。
- 默认离线宽限期为 30 天；超过宽限期后会连接签名授权文件里的 `licenseServerUrl` 并校验服务端签名复核回执。复核地址缺失、回执签名不正确或授权被停用时，系统会锁定业务功能。
- `npm run license:keys` 会生成一对新密钥。正式发版时，授权服务私钥必须匹配客户端内置公钥 `server/license/publicKey.ts`；如果更换公钥，必须同步更新该文件并重新打包 exe。
- 邀请码服务默认提供 `/v1/activate` 和 `/v1/check`，支持设备数限制、邀请码/授权停用、过期检查、签名复核回执和基础限流。正式部署到公网时建议由 Nginx/Caddy 反代到 `127.0.0.1:8787`；如需直接监听网卡，可设置 `CA_LICENSE_HOST=0.0.0.0`。
- 授权脚本使用 `tsx` 运行，`tsx` 已放入生产依赖；按源码部署授权服务时可使用 `npm ci --omit=dev` 后运行上述 npm scripts。

## Windows 打包

```bash
npm run dist:win
npm run dist:win:arm64
```

已生成：

```text
release/民航客票销售订座系统-1.1.0-x64.exe
release/民航客票销售订座系统-1.1.0-arm64.exe
```

普通 Windows 电脑优先使用 x64 版本。arm64 仅用于 ARM 架构 Windows 设备。

## 数据位置

- 开发环境：`.local-data/orders.json`
- Windows 桌面版：Electron `app.getPath('userData')/orders.json`
- 可用环境变量 `CA_TICKETING_DATA_DIR` 指定订单数据目录。

## 文档

- `docs/requirements.md`：需求摘要
- `docs/database-design.md`：数据模型与迁移建议
- `docs/student-guide.md`：学生使用说明
- `docs/teacher-admin-guide.md`：教师/管理员手册
- `docs/acceptance-checklist.md`：验收清单
- `docs/reviews/`：需求、UI、安全、桌面打包 review

## 交付说明

当前版本是教学/实训模拟系统，不连接真实航司、真实支付或真实票务。Windows exe 已配置自定义图标和授权门禁但未代码签名，正式外发前建议在真实 Windows x64 机器上双击冒烟一次。
