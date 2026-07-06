# 数据与安全最终 Review

评审对象：Express API、领域校验、本地 JSON 存储、Electron 配置、依赖审计。

## 总体结论

判定：**Pass，适合本机教学模拟交付；不建议存放真实个人信息或直接用于生产。**

## 已解决项

- 畸形订单输入返回 422，不再抛 500：`tests/api.test.ts` 覆盖。
- 服务端根据 `flightId` 和 `cabinClass` 派生票价、航线、余票、航班快照，不再信任客户端提交的 `baseFare`、`route`。
- 生产依赖审计通过：`npm audit --omit=dev --audit-level=high` 返回 `found 0 vulnerabilities`。
- Express 使用 `helmet`、`rate-limit`、`express.json({ limit: '200kb' })`，关闭 `x-powered-by`。
- CORS 只放行本机来源和 Electron `Origin: null`。
- Electron 启用 `contextIsolation`、`nodeIntegration:false`、`sandbox:true`，并禁止新窗口、非 file 导航和权限请求。
- 本地订单 JSON 使用写队列和临时文件 rename，降低并发/损坏风险。
- `.gitignore` 已加入 `.local-data/`、`.env`、密钥文件等。
- 未发现硬编码密码、API key、真实第三方接口。
- 授权私钥不进入客户端；客户端只内置公钥并校验 Ed25519 签名授权文件。
- 授权服务激活接口有限流；邀请码生成使用加密随机数，数据库参数会校验设备数、授权天数和日期格式。
- 客户端超过离线宽限期后通过签名授权文件里的授权服务地址访问 `/v1/check`，并校验服务端 Ed25519 签名复核回执；复核状态保存在本机 `license-state.json`。
- Electron 每次启动会生成随机本地 API 会话 token，前端请求携带 `X-CA-Session`，降低其他 localhost/file 页面直接调用本地业务 API 的风险。

## 剩余风险

- 全量 `npm audit` 仍报告 dev/build 链风险，主要是 `electron-builder@25.1.8`、`vitest@2.1.8`、`vite/esbuild`。生产依赖已清零，Electron 运行时已升级到 41.7.1。
- Windows exe 未代码签名，首次运行可能出现 SmartScreen 提示。
- 本地 JSON 明文保存课堂填写的信息，系统已定位为模拟数据；如要保存真实身份信息，应加密、脱敏并加权限。
- API 无登录鉴权，仅适合本机或课堂内网演示。
