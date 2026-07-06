# 民航客票销售订座系统交付说明

本目录保存旧包分析、建设路径报告和新系统源码。当前交付主线是 `civil-aviation-ticketing/`，旧 `hangkong.zip` 只作为参考资料，不再作为主工程继续改造。

## 关键结论

- 若只做旧系统演示，改 `hangkong.zip` 更快。
- 若要达到 `~/Downloads/民航客票销售订座系统_需求文档.docx` 的目标，重写更简单、更稳。
- 新系统已按教学/实训模拟口径实现，并生成 Windows x64 / arm64 portable 程序；桌面版 1.1.0 增加邀请码激活、设备绑定和本地签名授权校验。

## 主要文件

| 文件/目录 | 说明 |
|---|---|
| `civil-aviation-ticketing/` | 新系统源码和 Windows 打包产物 |
| `civil_aviation_rewrite_vs_modify_report.html` | 给业务方看的“改旧包 vs 重写”决策报告 |
| `civil_aviation_rewrite_vs_modify_final_report.html` | 同内容最终版副本 |
| `hangkong.zip` | 本地原始旧包，体积过大不纳入 GitHub，仅作分析参考 |
| `hangkong_analysis_report.html` / `.pdf` | 旧包技术评估报告 |
| `hangkong_business_report.html` / `.pdf` | 旧包业务模式报告 |
| `desktop_upgrade_plan.html` | Windows 桌面化与系统升级方案 |
| `output/playwright/` | 截图证据和报告预览截图 |

## 本地预览新系统

```bash
cd civil-aviation-ticketing
npm install
npm run dev
```

浏览器访问：

```text
http://127.0.0.1:5173/
```

## Windows 程序

优先发 x64 版本给普通 Windows 电脑：

```text
civil-aviation-ticketing/release/民航客票销售订座系统-1.1.0-x64.exe
civil-aviation-ticketing/release/民航客票销售订座系统-1.1.0-arm64.exe
```

当前程序未代码签名，首次运行可能出现 SmartScreen 提示。发布前建议在真实 Windows x64 机器上双击冒烟一次。

## 最终验收命令

```bash
cd civil-aviation-ticketing
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

2026-07-06 验收结果：57 个测试通过，类型检查通过，构建通过，生产依赖审计 `found 0 vulnerabilities`。
