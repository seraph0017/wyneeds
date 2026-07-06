# Windows 桌面打包最终 Review

评审对象：Electron 主进程、electron-builder 配置、Windows release 产物。

## 总体结论

判定：**Pass，可交付 Windows x64/arm64 portable 试用。**

## 产物

- `release/民航客票销售订座系统-1.1.0-x64.exe`
- `release/民航客票销售订座系统-1.1.0-arm64.exe`

当前构建使用 Electron `41.7.1`。`file` 检查显示：

- portable exe 是 NSIS 自解压 stub，正常。
- `release/win-unpacked/民航客票销售订座系统.exe` 为 Windows x86-64 PE。
- `release/win-arm64-unpacked/民航客票销售订座系统.exe` 为 Windows AArch64 PE。

## 脚本

- x64：`npm run dist:win`
- arm64：`npm run dist:win:arm64`
- Web/Node 构建：`npm run build`

## 已修复项

- 桌面版启动本地 API 时默认启用授权门禁，未激活时业务 API 返回 `LICENSE_REQUIRED`。
- 授权采用 Ed25519 签名文件和设备 hash 绑定，客户端只内置公钥。
- 已提供邀请码管理脚本和可部署授权服务脚本；正式域名后续配置 `CA_LICENSE_SERVER_URL`。

- Electron 桌面模式不再关闭 CORS，允许 `file://` 页面访问本地随机端口 API。
- 主进程启动本地 API，使用 `app.getPath('userData')` 保存订单。
- 阻止外部导航、新窗口和权限请求。
- 打包不再生成/携带 `dist-node/*.map`。
- Windows exe、应用窗口和 Web favicon 已配置统一的自定义图标资源。

## 剩余限制

- 未配置代码签名证书。
- 未做自动更新，当前采用 portable 分发。
- 已在 macOS 上完成 Windows 交叉打包；发布前建议在真实 Windows x64 机器上双击运行做最终人工冒烟。


## 最终产物哈希

- x64 SHA256: `9fc9964e158e8a17219cbfce86faf152019c31954f48a962e334da5502e40674`
- arm64 SHA256: `8d1d4f3421ec02ecc2caa18a0b726c46a41734bc0449c1cadeb882defec39208`
