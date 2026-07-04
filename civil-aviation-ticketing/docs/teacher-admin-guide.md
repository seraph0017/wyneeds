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

## 打包 Windows 桌面应用

```bash
npm run dist:win
npm run dist:win:arm64
```

已验证生成：

- `release/民航客票销售订座系统-1.0.3-x64.exe`
- `release/民航客票销售订座系统-1.0.3-arm64.exe`

普通 Windows 电脑优先使用 x64 版本；ARM 架构 Windows 设备使用 arm64 版本。

## 验收命令

```bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

2026-07-04 验收结果：26 个测试通过，类型检查通过，构建通过，生产依赖审计 `found 0 vulnerabilities`。

## 教学建议

- 第一节：只做成人票 P0 流程。
- 第二节：加入儿童、婴儿、UM，观察校验提示。
- 第三节：讲行李、退票、改签规则。
- 第四节：让学生导出/打印行程单，并说明真实系统与模拟系统差异。

## 已知限制

- 当前是教学模拟系统，未接入真实航司库存和支付。
- 订单存储为本地 JSON，适合单机和小班演示；多人正式部署建议迁移到关系型数据库。
- Windows exe 已配置自定义图标但未做代码签名，首次运行可能被系统提示需要确认。
