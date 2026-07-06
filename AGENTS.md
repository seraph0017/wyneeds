# AGENTS.md

## 项目口径

- `civil-aviation-ticketing/` 是最终交付主工程。
- `hangkong.zip` 和旧包分析报告只作参考，不要再把旧包作为主代码基线硬改。
- 系统定位是教学/实训模拟系统，不连接真实航司、真实支付或真实票务。
- 对外说明时不要写成“生产级真实民航系统”，应写“教学/实训模拟版，可交付演示和课堂使用”。

## 常用命令

```bash
cd civil-aviation-ticketing
npm run dev
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
npm run dist:win
npm run dist:win:arm64
npm run license:invite -- --customer "客户名称"
npm run license:server
```

## 交付物

- 业务决策报告：`civil_aviation_rewrite_vs_modify_report.html`
- 新系统源码：`civil-aviation-ticketing/`
- Windows x64：`civil-aviation-ticketing/release/民航客票销售订座系统-1.1.0-x64.exe`
- Windows arm64：`civil-aviation-ticketing/release/民航客票销售订座系统-1.1.0-arm64.exe`
- 验收与 review：`civil-aviation-ticketing/docs/`

## 注意事项

- `.local-data/` 是本地订单数据目录，不要提交或打包为源码交付内容。
- `hangkong.zip`、`.analysis_tmp/` 是大体积本地参考/解包产物，不要加入 Git。
- Windows exe 未签名；已配置自定义图标和邀请码授权门禁，正式外发前可补代码签名。
- 授权私钥保存在本机 `civil-aviation-ticketing/secrets/license/license-private-key.pem`，不要提交；客户端只提交公钥。
- 正式授权域名待定；开发可通过 `CA_LICENSE_SERVER_URL` 指向部署后的授权服务，portable exe 可用 exe 同目录的 `license-config.json` 配置授权服务地址。
- dev/build 链全量 audit 可能仍有构建期风险；生产依赖审计已通过。
