# Config Drift CLI - 配置漂移侦测工具

一个运行在 Node.js 上的配置漂移侦测命令行工具，帮助运维团队定期抓取各环境配置快照、与基线版本做差异比对、按风险等级生成汇总结果，快速识别需要立即收敛的配置漂移。

## ✨ 功能特性

- **多源配置抓取**: 支持本地文件(JSON/YAML/ENV)、HTTP 接口、系统环境变量、命令执行结果
- **基线版本管理**: 创建、查看、列出、删除配置基线
- **深度差异比对**: 智能识别新增、删除、修改、数组变更等配置变化
- **风险等级评估**: 基于路径模式匹配规则，自动评估漂移风险等级(严重/高/中/低/信息)
- **多格式报告输出**: 控制台彩色表格、JSON、Markdown 格式报告
- **CI/CD 集成**: 支持指定风险等级阈值，超出则返回非零退出码

## 📦 安装

```bash
# 安装依赖
npm install

# 构建 TypeScript
npm run build

# 全局链接（可选）
npm link
```

## 🚀 快速开始

### 1. 初始化配置

```bash
# 使用默认配置
cdrift init

# 或直接使用示例配置
cp examples/cdrift.config.json ./cdrift.config.json
```

### 2. 查看配置源

```bash
cdrift sources

# 按环境筛选
cdrift sources -e production
```

### 3. 抓取配置快照

```bash
# 抓取所有环境
cdrift snapshot

# 抓取指定环境
cdrift snapshot -e production

# 保存快照到文件
cdrift snapshot -e production -o snapshots/prod.json
```

### 4. 创建配置基线

```bash
# 创建生产环境基线
cdrift baseline create -e production -n "prod-baseline-v1" -d "生产环境初始基线"

# 创建预发布环境基线
cdrift baseline create -e staging -n "staging-baseline-v1"
```

### 5. 查看基线列表

```bash
cdrift baseline list

# 按环境筛选
cdrift baseline list -e production
```

### 6. 扫描配置漂移

```bash
# 扫描所有环境（使用各环境最新基线）
cdrift scan

# 扫描指定环境
cdrift scan -e production

# 指定基线 ID
cdrift scan -e production -b <baseline-id>

# 只显示高风险及以上
cdrift scan -l high

# 导出 JSON 报告
cdrift scan -e production -o reports/drift-report.json

# 导出 Markdown 报告
cdrift scan -o reports/drift-report.md

# CI 模式：存在 critical 风险则失败
cdrift scan --fail-on critical
```

### 7. 查看基线详情

```bash
cdrift baseline show -i <baseline-id>
```

### 8. 删除基线

```bash
cdrift baseline delete -i <baseline-id>
```

## 📋 配置文件说明

`cdrift.config.json` 配置文件结构：

```json
{
  "storagePath": ".cdrift",
  "environments": ["production", "staging", "development"],
  "defaultRiskRules": [
    {
      "pathPattern": "database.**",
      "level": "critical",
      "description": "数据库配置变更"
    }
  ],
  "sources": [
    {
      "id": "app-config-prod",
      "name": "应用配置(生产)",
      "type": "file",
      "format": "json",
      "path": "examples/configs/production/app-config.json",
      "environment": "production",
      "ignorePaths": ["metadata.**", "timestamp"],
      "riskRules": [
        {
          "pathPattern": "app.port",
          "level": "critical",
          "description": "端口变更"
        }
      ]
    }
  ]
}
```

### 配置源类型 (type)

| 类型 | 说明 | path 示例 |
|------|------|-----------|
| `file` | 本地文件 | `/etc/app/config.json` |
| `http` | HTTP 接口 | `https://config.example.com/app/config` |
| `env` | 系统环境变量 | `APP_` (前缀) 或 `ALL` |
| `command` | 命令执行结果 | `kubectl get configmap app-config -o json` |

### 配置格式 (format)

| 格式 | 说明 |
|------|------|
| `json` | JSON 格式 |
| `yaml` | YAML 格式 |
| `env` | .env 环境变量格式 |
| `text` | 纯文本（解析为 `{ content: "..." }`） |

### 风险规则匹配

使用 glob 风格的路径匹配：

- `*` 匹配任意单层路径
- `**` 匹配任意多层路径
- `database.**` 匹配 database 下所有子路径
- `feature.*` 匹配 feature 下一级路径

### 风险等级

| 等级 | 说明 | 建议处理时效 |
|------|------|------------|
| `critical` | 严重风险 | 立即处理 |
| `high` | 高风险 | 24小时内 |
| `medium` | 中风险 | 排期处理 |
| `low` | 低风险 | 按需处理 |
| `info` | 信息 | 关注即可 |

## 🔧 命令行参数

### 全局参数

```
-c, --config <path>    指定配置文件路径 (默认: cdrift.config.json)
```

### `cdrift init`

初始化配置文件

### `cdrift snapshot`

```
-e, --environment <env>    指定环境
-o, --output <path>        输出快照到指定文件
```

### `cdrift baseline create`

```
-e, --environment <env>    环境名称 (必需)
-n, --name <name>          基线名称 (必需)
-d, --description <desc>   基线描述
```

### `cdrift baseline list`

```
-e, --environment <env>    按环境筛选
```

### `cdrift baseline show`

```
-i, --id <id>              基线 ID (必需)
```

### `cdrift baseline delete`

```
-i, --id <id>              基线 ID (必需)
```

### `cdrift scan`

```
-e, --environment <env>    指定环境
-b, --baseline <id>        指定基线 ID
-l, --level <level>        最低显示风险等级 (默认: info)
-o, --output <path>        输出报告文件
-f, --format <format>      输出格式: json|md|console (默认: console)
--fail-on <level>          该等级及以上漂移时退出码为 1
```

### `cdrift sources`

```
-e, --environment <env>    按环境筛选
```

## 📊 报告示例

### 控制台输出

```
================================================================================
配置漂移检测报告
生成时间: 2024-06-18 14:30:00
检测环境: production
================================================================================

📊 总体汇总
┌──────────────────────────────┬──────────────────────────────────────────────────┐
│ 指标                         │ 数值                                             │
├──────────────────────────────┼──────────────────────────────────────────────────┤
│ 配置源总数                   │ 3                                                │
│ 存在漂移的源                 │ 2                                                │
│ 漂移项总数                   │ 8                                                │
│ 严重 风险                    │ 1                                                │
│ 高 风险                      │ 2                                                │
│ 中 风险                      │ 3                                                │
│ 低 风险                      │ 2                                                │
└──────────────────────────────┴──────────────────────────────────────────────────┘

⚠️  存在 1 个严重风险漂移，建议立即处理！

🔍 环境: [production]
基线 ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
检测时间: 2024-06-18 14:30:00

漂移统计: 严重: 1, 高: 2, 中: 3, 低: 2
...
```

## 🤝 集成到 CI/CD

```yaml
# GitHub Actions 示例
name: Config Drift Check

on:
  schedule:
    - cron: '0 */4 * * *'  # 每4小时执行
  workflow_dispatch:

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci && npm run build
      
      - name: Run config drift scan
        run: |
          node dist/index.js scan \
            -e production \
            -o drift-report.md \
            --fail-on critical
        env:
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
      
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: drift-report
          path: drift-report.md
```

## 📁 项目结构

```
.
├── src/
│   ├── types.ts              # 类型定义
│   ├── utils.ts              # 工具函数
│   ├── configLoader.ts       # 配置加载与快照抓取
│   ├── baselineManager.ts    # 基线管理
│   ├── diffEngine.ts         # 差异比对引擎
│   ├── reportGenerator.ts    # 报告生成
│   └── index.ts              # CLI 入口
├── examples/
│   ├── cdrift.config.json    # 示例配置
│   └── configs/              # 示例配置文件
├── dist/                     # 编译输出
├── .cdrift/                  # 基线存储目录
└── cdrift.config.json        # 主配置文件
```

## 📝 License

MIT
