# 电价分档计算系统（峰平谷版）

本项目提供一个基于 Next.js 的电价分档计算与可视化工具，支持导入 24 小时用电量数据，自动按“峰/平/谷”进行分档，计算满足期望总收入的分时电价，并支持月份配置与分组调整。

## 功能概览

- 导入 Excel/CSV 数据并自动解析为 24 小时用电量汇总与企业明细（后端解析见 `server/pages/api/upload.js:1`）。
- 按“峰/平/谷”规则对 24 小时进行分档（算法见 `server/pages/index.jsx:9`）。
- 输入期望总收入，计算满足目标的分时电价（计算逻辑见 `server/pages/index.jsx:18`）。
- 12 个月配置：每月固定一套“峰谷数量”规则，支持来回切换（状态定义见 `server/pages/index.jsx:47-48`）。
 - 12 个月配置：每月固定一套“峰谷数量”规则，支持来回切换，并在浏览器本地持久化保存（状态与持久化见 `server/pages/index.jsx:46-48, 270-292, 300-308`）。
- 交互分组：选择小时列，按组设置“调整电价”与“倍数”，最终电价为二者相乘的结果（应用逻辑见 `server/pages/index.jsx:272-292`）。
- 导出结果：生成带有时间、分档、用电量、分时电价、小时收入与合计的 Excel（导出逻辑见 `server/pages/index.jsx:204-222`）。
- 图表展示：用电量柱状与电价折线复合图（`server/pages/index.jsx:138-147`）。

## 规则管理与模板

- 模板管理页面：`/rules`（`server/pages/rules.jsx`）
  - 保存模板：`server/pages/rules.jsx:46-62`
  - 查看列表与刷新：`server/pages/rules.jsx:117-132, 170-186`
  - 载入到编辑：`server/pages/rules.jsx:134-150`
  - 更新模板：`server/pages/rules.jsx:152-165`
  - 删除模板：`server/pages/rules.jsx:167-186`
- 模板优先原则与期望值保持：
  - 合并函数（模板优先覆盖，其余小时按用电量补齐到模板设定的峰谷数量）：`server/pages/index.jsx:29-48`
  - 收入保持（按权重计算系数确保总收入等于期望值）：`server/pages/index.jsx:11-21`
  - 应用时机：首次计算 `server/pages/index.jsx:268-281`、切换公司/汇总 `server/pages/index.jsx:284-302`、切换月份 `server/pages/index.jsx:459-484`、调整峰谷数量 `server/pages/index.jsx:493-515`、手动应用模板 `server/pages/index.jsx:359-374`

## 公司数据查看

- 在首页“数据范围”卡片选择“汇总”或具体公司：`server/pages/index.jsx:440-451`
- 切换后重算分档与电价：`server/pages/index.jsx:284-302`

## 使用步骤

1. 安装并启动
   - `cd server`
   - `npm install`
   - `npm run dev`
   - 打开 `http://localhost:3000/`

2. 导入数据
   - 点击“选择文件”或拖拽到“导入数据”卡片中。
   - 支持 `.xlsx/.xls/.csv`。

3. 参数设置
   - 配置月份（1–12），每月可独立设置“峰谷数量”。
   - 输入“期望总收入（元）”。
   - 点击“计算结果”。

4. 分组与调整
   - 在表格表头点击选择小时列（可按住 Shift 连选）。
   - “添加为组”，为该组设置“调整电价”和“倍数”，最终电价为二者相乘的结果。

5. 导出结果
   - 点击“导出表格结果”生成 Excel，文件包含时间、分档、用电量、分时电价、小时收入与总收入。

## 数据格式说明

- Excel：每个工作表代表一个月份，首列为企业名称（或标识），最后 24 列为 24 小时用电量。系统会同时生成该工作表的汇总（所有企业求和）。解析逻辑参考 `server/pages/api/upload.js:31-57` 与 `server/pages/index.jsx:64-99`。
- CSV：第一列为企业名称，最后 24 列为 24 小时用电量（数值）。解析逻辑参考 `server/pages/index.jsx:100-132` 与 `server/pages/api/upload.js:42-57`。

## 分档与电价计算

- 分档算法（`server/pages/index.jsx:9-16`）：
  - 将 24 小时用电量按大小排序；取前 `count` 个为“峰”、后 `count` 个为“谷”，中间为“平”。
  - 标签为“峰/平/谷”。
- 电价计算（`server/pages/index.jsx:18-26`）：
  - 权重：谷 `wLow = 1`，平 `wMid = 1.5`，峰 `wHigh = 2`。
  - 计算系数 `k = 期望总收入 / (Σ(用电量 × 权重))`，得到分档电价 `pLow/pMid/pHigh`。
  - 生成 24 小时分时电价，并计算小时收入与总收入。

## 月份配置

 - 每月固定一套“峰谷数量”规则，默认值为 3（`server/pages/index.jsx:46-48`），并通过浏览器 `localStorage` 持久化保存与读取（`server/pages/index.jsx:300-308`）。
- 切换月份时会根据该月配置重新分档和计算（`server/pages/index.jsx:337-351`）。

## 分组调整

- 添加组后，组内每个小时的电价按以下顺序计算（`server/pages/index.jsx:272-292`）：
  - 若设置了“调整电价”，先覆盖为该值；
  - 若设置了“倍数”，再在当前值上乘以“倍数”；
  - 最终结果用于更新分时电价与总收入。

## 开发与设计

- 技术栈：Next.js 14、React、Chart.js、xlsx。
- 页面结构：
  - “导入数据”卡片：文件选择与拖拽（`server/pages/index.jsx:320-343`）。
  - “参数设置”卡片：月份、峰谷数量、期望总收入（`server/pages/index.jsx:333-385`）。
  - “分组与调整”卡片：选择小时列、添加组、组列表（`server/pages/index.jsx:391-432`）。
  - 表格与图表展示（`server/pages/index.jsx:434-451`）。
- 视觉与样式：统一按钮主次样式与卡片化布局（`server/pages/index.module.css:44-72, 74-87`）。

## 部署

- Vercel/Netlify 均可；项目包含基础配置文件：
  - `vercel.json`（位于项目根目录）
  - `netlify.toml`（位于项目根目录）

### Netlify 部署

- 构建配置：`netlify.toml:1-10`
  - 基目录 `base = "server"`
  - 构建命令 `command = "npm run build"`
  - 发布目录 `publish = ".next"`
  - 插件 `@netlify/plugin-nextjs`
- 环境变量（Site settings → Build & deploy → Environment variables）：
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- 新增或修改环境变量后，务必执行一次 “Clear cache and deploy site” 以确保前端包包含最新 `NEXT_PUBLIC_*` 变量。

### Supabase 配置与脚本

- 客户端初始化（包含首尾引号/反引号与空格清理）：`server/lib/supabase.js:1-20`
- 在线诊断：`/api/ping`（`server/pages/api/ping.js:1-14`），返回 `{ ok: true, count: ... }` 表示连接与表访问正常。
- SQL 脚本集中在：
  - `server/supabase/001_create_rule_templates.sql`（建表与启用 RLS）
  - `server/supabase/002_rls_policies.sql`（演示用匿名策略：select/insert/update/delete）
- 生产建议：将 RLS 收紧为“仅认证用户可写/删”，并按操作者 UID 隔离行。

## 常见问题

- 不能计算分档电价：检查是否已导入有效文件，且“期望总收入”填写为正数。
- 手动输入“峰谷数量”无效：确保输入为 1–11 的整数并且 2×数量 ≤ 24。
- 文件无法解析：确认最后 24 列为数值（小时用电量），首列为企业名称或标识。
- Netlify 上提示“未配置 Supabase”：
  - 检查环境变量键名严格为 `NEXT_PUBLIC_SUPABASE_URL` 与 `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - 检查值不包含引号/反引号与前后空格；必要时重新部署并清缓存
  - 用 `https://<your-site>.netlify.app/api/ping` 验证连接

---

如需定制分档权重、视觉风格或导出格式，请提出具体要求，我将进一步适配实现。

## 操作员使用说明书

### 角色与目标
- 角色：电价核算操作员
- 目标：导入数据→设置参数→计算结果→分组调整（可选）→导出报表。

### 操作流程
- 打开系统：访问 `http://localhost:3000/`。
- 导入数据：点击“选择文件”或拖拽到“导入数据”卡片区域，支持 `.xlsx/.xls/.csv`。
- 设置参数：选择“配置月份”，输入“峰谷数量（个）”和“期望总收入（元）”，点击“计算结果”。
- 分组与调整（可选）：在表格表头选择小时列（支持 Shift 连选），点击“添加为组”，在组内设置“调整电价”和“倍数”。最终小时电价按照“覆盖电价后再乘倍数”的规则计算。
- 导出报表：点击“导出表格结果”生成 Excel。

### 界面说明
- 导入数据卡片：自定义按钮触发文件选择，右侧显示文件名；拖拽区域支持点击选择。
- 参数设置卡片：包含“配置月份”、“峰谷数量（个）”、“期望总收入（元）”与“计算结果”。
- 分组与调整卡片：显示已选小时，提供“添加为组”“清除全部组”，并列出已添加组的“调整电价”“倍数”“删除”。
- 结果区：统计卡片、表格（时间/价格梯度/电量/电价/小时收入/合计）、图表（用电量+电价）。

### 注意事项
- 峰谷数量范围建议为 1–11，且需满足 2×数量 ≤ 24。
- 期望总收入需为正数；无效输入会提示错误。
- 月份切换会使用该月的“峰谷数量”重新计算，互不影响。
- 分组调整会实时影响分时电价与总收入，可随时清除或删除。

### 数据模板建议
- Excel：每工作表一个月份；首列为企业名称；最后 24 列为 1–24 点用电量（数值）。
- CSV：第一列企业名称；最后 24 列为 1–24 点用电量（逗号或制表符分隔）。
