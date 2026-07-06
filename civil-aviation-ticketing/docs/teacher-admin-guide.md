# 教师/管理员操作手册

## 教学目标

本系统用于讲解民航客票销售订座流程：查询、选舱、填写乘机人、确认、出票、退改签和规则查看。

## 本地运行

```bash
npm install
npm run dev
```

API 地址：`http://127.0.0.1:4176/api`

主要接口：

- `GET /api/cities`
- `GET /api/flights`
- `GET /api/rules`
- `POST /api/orders`
- `GET /api/orders`
- `POST /api/orders/:id/cancel`
- `POST /api/orders/:id/refund`
- `POST /api/orders/:id/change`

## 数据重置

开发环境删除以下文件即可清空订单：

```bash
rm -f .local-data/orders.json
```

Windows 桌面版订单保存在用户数据目录下的 `orders.json`，可在课堂前删除该文件重置。

## 授权管理

```bash
npm run license:keys -- --out-dir secrets/license
npm run license:invite -- --customer "某某培训学校" --max-devices 1 --license-days 365
CA_LICENSE_PRIVATE_KEY_PATH=secrets/license/license-private-key.pem \
CA_LICENSE_PUBLIC_URL=https://license.example.com \
CA_LICENSE_HOST=127.0.0.1 \
npm run license:server
```

- 私钥只保存在供应商环境，不放进 exe、不提交 Git。
- 客户端开发运行可通过 `CA_LICENSE_SERVER_URL` 指向授权服务完成首次激活；portable exe 可在 exe 同目录放 `license-config.json`：`{"licenseServerUrl":"https://license.example.com"}`。
- 激活成功后本地保存签名授权文件和联网复核状态，默认 30 天离线宽限期内可离线启动；复制到其他电脑会因设备指纹不匹配而锁定。
- 可用 `npx tsx scripts/license-admin.ts revoke-invite --code ...` 或 `npx tsx scripts/license-admin.ts revoke-license --license-id ...` 停用邀请码/授权；超过离线宽限期后客户端会通过签名授权文件中的 `licenseServerUrl` 访问 `/v1/check`，并校验服务端签名复核回执。
- `npm run license:keys` 生成的是新密钥对。正式发版时，授权服务私钥必须匹配客户端内置公钥 `server/license/publicKey.ts`；如更换公钥，需要同步更新并重打包 exe。
- 正式域名部署建议由 Nginx/Caddy 反代到本机 `127.0.0.1:8787`；如需服务直接监听外部网卡，可设置 `CA_LICENSE_HOST=0.0.0.0`，并确保 `CA_LICENSE_PUBLIC_URL` 使用 HTTPS 正式域名。

## 打包 Windows 桌面应用

```bash
npm run dist:win
npm run dist:win:arm64
```

已验证生成：

- `release/民航客票销售订座系统-1.1.0-x64.exe`
- `release/民航客票销售订座系统-1.1.0-arm64.exe`

普通 Windows 电脑优先使用 x64 版本；ARM 架构 Windows 设备使用 arm64 版本。

## 验收命令

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

2026-07-06 验收结果：57 个测试通过，类型检查通过，构建通过，生产依赖审计 `found 0 vulnerabilities`。

## 教学建议

- 第一节：只做成人票 P0 流程。
- 第二节：加入儿童、婴儿、UM，观察校验提示。
- 第三节：讲行李、退票、改签规则。
- 第四节：让学生导出/打印行程单，并说明真实系统与模拟系统差异。

## 已知限制

- 当前是教学模拟系统，未接入真实航司库存和支付。
- 订单存储为本地 JSON，适合单机和小班演示；多人正式部署建议迁移到关系型数据库。
- Windows exe 已配置自定义图标和授权门禁但未做代码签名，首次运行可能被系统提示需要确认。
