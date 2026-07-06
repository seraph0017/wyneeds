# ToB 授权激活设计

## 目标

为 `civil-aviation-ticketing` 增加 ToB 销售可控授权：客户首次打开软件必须联网输入邀请码激活，激活成功后绑定当前设备并保存本地签名授权文件；后续启动尽量离线可用。域名、正式服务器部署地址和正式私钥由后续商业部署配置，本次实现完整协议、客户端校验、本地授权服务脚本和测试。

## 授权边界

- 不能阻止 exe 文件被复制；目标是复制到未授权设备后无法进入业务系统。
- 客户端只内置授权公钥，不内置私钥。
- 授权服务持有私钥、邀请码库和设备绑定记录。
- 本地授权文件被篡改、过期、签名不匹配、设备不匹配时，应用保持锁定。
- 在线复核采用“首次联网、默认 30 天离线宽限期”模式：激活后在宽限期内离线可用；超过宽限期后连接签名授权文件里的授权服务地址执行 `/v1/check`，并校验服务端签名复核回执。正式域名未定时可用 `license-config.json` 或环境变量配置授权服务；如缺少复核地址且已超过宽限期，客户端锁定业务功能。

## 架构

### 客户端桌面应用

Electron 主进程启动本地 Express API。API 新增授权接口：

- `GET /api/license/status`：返回当前授权状态、设备码摘要、授权单位、到期时间、是否需要激活。
- `POST /api/license/activate`：接收邀请码，读取当前设备指纹，请求远端授权服务签发 license，校验签名后写入本地授权文件。
- `POST /api/license/offline-import`：预留给供应商线下签发授权文件后导入，作为不能联网时的补救能力。

业务 API 在未授权时返回 `403 LICENSE_REQUIRED`，但 `/api/health`、`/api/license/*` 保持可访问。

### 授权核心

新增 `server/license/`：

- 设备指纹：优先读取 Windows `MachineGuid`、macOS `IOPlatformUUID`、Linux `/etc/machine-id`；失败时使用 hostname/user/cpu/os 组合。最终只保存 SHA-256 hash。
- 签名：Ed25519。签名内容使用稳定 canonical JSON，防止字段顺序导致校验失败。
- 授权文件：保存在订单数据目录同级 `license.json`，Windows 桌面版位于 Electron `userData/license.json`。
- 校验：schemaVersion、appId、product、deviceHash、expiresAt、signature 全部必须通过。

### 授权服务脚本

新增可部署脚本：

- `scripts/license-admin.ts`
  - 生成 Ed25519 keypair 到本地 `secrets/`。
  - 创建邀请码，写入授权服务 JSON 数据库。
  - 列出邀请码和激活设备数。
  - 吊销邀请码或指定 license。
- `scripts/license-server.ts`
  - 提供 `POST /v1/activate`。
  - 提供 `POST /v1/check`。
  - 从环境变量读取私钥路径、邀请码数据库路径、监听端口。
  - 一码可配置 `maxDevices`，默认 1 台。
  - 同一设备重复激活幂等返回授权；超过设备数拒绝。

正式域名后续只需要把开发环境变量 `CA_LICENSE_SERVER_URL` 指向正式服务；portable exe 可通过同目录 `license-config.json` 配置授权服务地址。

## 前端体验

React 应用启动后先请求 `/api/license/status`：

- 未激活：显示授权激活页，不显示订票业务。
- 激活中：按钮 loading。
- 激活失败：显示明确错误，如邀请码无效、设备数已满、授权服务不可达。
- 已激活：显示授权单位和到期时间，进入原业务系统。

授权页文案保持 ToB 交付口径：教学/实训模拟版，不连接真实航司。

## 版本与交付

功能完成、测试和 review 达标后再把版本号升到 `1.1.0`，重新生成：

- `release/民航客票销售订座系统-1.1.0-x64.exe`
- `release/民航客票销售订座系统-1.1.0-arm64.exe`

`.gitignore` 同步只保留 1.1.0 最新 exe。

## 测试要求

- 授权核心单元测试：签名、篡改检测、过期检测、设备不匹配检测。
- 授权服务测试：邀请码一次绑定、同设备幂等、超设备数拒绝、吊销拒绝。
- API 测试：未授权业务 API 403、授权接口可访问、激活后业务 API 可访问。
- 前端至少通过构建和类型检查。
- 最终执行：`npm test`、`npm run typecheck`、`npm run build`、`npm audit --omit=dev --audit-level=high`、`npm run dist:win`、`npm run dist:win:arm64`。
