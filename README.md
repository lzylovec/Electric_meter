# 电价分档计算系统（尖峰平谷深谷版）

本项目提供一个基于 Next.js 的电价分档计算与可视化工具，支持导入 24 小时用电量数据，自动按“尖峰/峰/平/谷/深谷”进行五级分档，计算满足期望总收入的分时电价，并支持规则模板管理与系数调整。

## 功能概览

- **数据导入**：支持 Excel/CSV 格式，自动解析为 24 小时用电量汇总与企业明细。
- **五级分档**：支持“尖峰/峰/平/谷/深谷”五级时段划分（算法支持模板定义或自动排序）。
- **电价反算**：输入期望总收入，结合各时段系数（如尖峰 2.0 倍、谷 0.3 倍）自动反推各时段电价。
- **规则模板**：支持创建包含 12 个月分时定义及电价系数的模板，一键应用。
- **系数调整**：在计算结果页实时微调尖峰、峰、谷、深谷的电价系数，即时预览收入变化。
- **结果导出**：生成包含时间、分档、用电量、分时电价、小时收入与合计的 Excel 报表。
- **图表展示**：直观的用电量（柱状图）与电价（折线图）复合图表。

## 规则管理与模板

- **管理页面**：`/rules`
- **功能**：
  - 定义 12 个月的分时规则（每月可独立设置各小时所属时段）。
  - 配置电价系数：默认尖峰 2.0 / 峰 1.7 / 平 1.0 / 谷 0.3 / 深谷 0.1。
  - 模板导出：支持将规则模板导出为 Excel 备份。
- **应用逻辑**：
  - 计算时选择模板，系统优先使用模板定义的时段与系数。
  - 若无模板，默认按用电量排序自动分配峰/平/谷。

## 使用步骤

1. **启动项目**
   ```bash
   cd server
   npm install
   npm run dev
   # 访问 http://localhost:3000/
   ```

2. **导入数据**
   - 点击“选择文件”或拖拽上传 Excel/CSV 文件。
   - 文件需包含 24 小时用电量数据（格式见下文）。

3. **参数设置**
   - **规则模板**：选择预先配置好的模板（推荐），或留空使用默认策略。
   - **期望总收入**：输入目标总收入金额（元）。
   - 点击 **“开始计算”**。

4. **查看与调整**
   - 系统展示分档结果、各时段电价及总收入预览。
   - **系数调整**：在结果区“系数调整”面板修改尖峰、峰、谷、深谷系数，平段固定为 1。修改后自动重算。

5. **导出结果**
   - 点击 **“导出表格结果”** 下载 Excel 文件。

## 数据格式说明

- **Excel (.xlsx/.xls)**：
  - 每个工作表代表一个月份。
  - 第一列：企业名称/标识。
  - 最后 24 列：01:00 - 24:00 的小时用电量（数值）。
  - 系统会自动计算该工作表的总用电量。
- **CSV (.csv)**：
  - 逗号分隔。
  - 规则同上，第一列为名称，最后 24 列为数值。

## 部署说明

### 基础环境
- Node.js 18+
- Supabase (用于存储规则模板)

### 环境变量 (.env.local 或平台配置)
```bash
NEXT_PUBLIC_SUPABASE_URL=你的Supabase地址
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的Supabase公钥
```

### Supabase 数据库配置
1. 创建 `rule_templates` 表。
2. 确保包含 `factors` 列（JSONB 类型）用于存储系数。

SQL 参考：
```sql
-- 创建表
create table rule_templates (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  months jsonb, -- 存储12个月的分时配置
  factors jsonb default '{"flat":1,"spike":2,"peak":1.7,"valley":0.3,"deep":0.1}'::jsonb,
  created_at timestamptz default now()
);

-- 开启 RLS (根据需要配置策略)
alter table rule_templates enable row level security;
create policy "Public select" on rule_templates for select using (true);
create policy "Public insert" on rule_templates for insert with check (true);
create policy "Public update" on rule_templates for update using (true);
create policy "Public delete" on rule_templates for delete using (true);
```

## 常见问题

- **计算结果显示 --**：请检查是否输入了有效的“期望总收入”。
- **模板不显示**：请检查 Supabase 连接是否正常，环境变量是否配置。
- **系数调整无效**：确保输入的是有效数字，且平段系数固定为 1 不可调。

---

## 操作员手册

### 核心流程
1. **准备数据**：整理用户的 24 小时用电量 Excel。
2. **系统计算**：导入数据 -> 选择模板 -> 输入目标收入 -> 计算。
3. **微调确认**：检查各时段电价是否合理，必要时在页面下方微调系数。
4. **生成报表**：导出 Excel 交付或归档。

### 界面指南
- **数据源卡片**：负责文件上传与查看范围切换（汇总/单户）。
- **计算参数卡片**：核心控制区，决定分档规则与价格基准。
- **结果展示区**：
  - **统计卡片**：核心指标一览（各段电价、总收）。
  - **系数调整区**：快速试算不同系数下的电价结果。
  - **表格与图表**：详细数据透视。
