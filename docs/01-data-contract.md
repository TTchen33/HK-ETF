# HK ETF Explorer — 数据合同（v0.1）

**状态：** 已确认的首版规范  
**更新时间：** 2026-08-22  
**适用范围：** 香港交易所上市的普通 ETF；首批仅接入 Global X Hong Kong 的公开产品资料。

## 1. 数据原则

1. 每个展示字段都必须有官方来源网址、来源数据日期（如有）和系统采集时间。
2. 净值（NAV）、交易价格、基金规模（AUM）和期间回报是不同指标，绝不互相替代。
3. 首版仅展示发行商明确公布的期间表现；不自行计算“总回报”。
4. 无法确认的字段保持空值，并在后台记录原因；不得猜测或用不同份额类别的数据补齐。
5. 交易柜台是独立对象。同一 ETF 的港币、美元、人民币柜台可能有不同股票代码，不能合并成一行。
6. 页面面向教育和资料探索，不包含推荐、预测、交易或个人化投资建议。

## 2. 产品边界

### 收录

- 在香港交易所上市的 ETF。
- 被动及主动管理 ETF 均可收录，但必须标明 `management_style`。
- ETF 的所有可确认上市交易柜台。

### 不收录（v0.1）

- 杠杆及反向产品（L&I Products）。
- 窝轮、牛熊证、结构性产品、REIT、债券证券。
- 实时行情、逐笔成交、完整历史交易价格。
- 未列于官方来源或无法确认产品状态的 ETF。

## 3. 标准数据模型

```text
ETF 产品（etf）
  ├─ 上市交易柜台（listing_counter，1 对多）
  ├─ 发行商每日指标快照（fund_snapshot，1 对多）
  ├─ 官方表现记录（performance_record，1 对多）
  └─ 文件与公告（document，1 对多）
```

### 3.1 ETF 产品：`etf`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `etf_id` | UUID | 是 | 系统内部唯一编号 |
| `issuer` | 文本 | 是 | 发行商标准名称，例如 Global X Hong Kong |
| `official_name_en` | 文本 | 是 | 官方英文产品名称 |
| `official_name_zh` | 文本 | 否 | 官方中文名称；没有则留空 |
| `issuer_product_url` | URL | 是 | 发行商产品主页 |
| `management_style` | 枚举 | 是 | `passive`、`active` 或 `unknown` |
| `asset_class` | 枚举 | 是 | `equity`、`fixed_income`、`commodity`、`money_market`、`multi_asset`、`other` |
| `investment_region` | 文本 | 否 | 例如 Hong Kong、China、US、Global、Asia Pacific ex Japan |
| `investment_objective` | 文本 | 否 | 官方投资目标的简短原文/摘要 |
| `underlying_benchmark` | 文本 | 否 | 追踪指数；主动 ETF 可以为空 |
| `base_currency` | ISO 4217 | 否 | 基金基础币种，例如 HKD、USD、RMB |
| `distribution_frequency` | 枚举 | 否 | `monthly`、`quarterly`、`semiannual`、`annual`、`none`、`discretionary`、`unknown` |
| `first_seen_at` | 时间戳 | 是 | 系统首次发现时间 |
| `last_checked_at` | 时间戳 | 是 | 最近成功核对时间 |

### 3.2 上市交易柜台：`listing_counter`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `counter_id` | UUID | 是 | 系统内部唯一编号 |
| `etf_id` | UUID | 是 | 关联 ETF 产品 |
| `exchange` | 固定文本 | 是 | 首版固定为 `HKEX` |
| `stock_code` | 文本 | 是 | 保留前导零的 HKEX 股票代码 |
| `stock_short_name` | 文本 | 否 | HKEX 股票简称 |
| `trading_currency` | ISO 4217 | 是 | HKD、USD 或 RMB |
| `isin` | 文本 | 否 | 发行商披露的 ISIN |
| `board_lot_size` | 整数 | 否 | 每手单位 |
| `listing_date` | 日期 | 否 | 在 HKEX 上市日期 |
| `counter_status` | 枚举 | 是 | `active`、`suspended`、`delisted`、`unknown` |

### 3.3 每日指标快照：`fund_snapshot`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `snapshot_id` | UUID | 是 | 系统内部唯一编号 |
| `etf_id` | UUID | 是 | 关联 ETF 产品 |
| `counter_id` | UUID | 否 | 如指标针对某一上市柜台则关联；否则仅关联 ETF |
| `as_of_date` | 日期 | 是 | 指标所对应的官方日期 |
| `nav_per_share` | 十进制 | 否 | 每单位净值 |
| `nav_currency` | ISO 4217 | 否 | 净值货币，不能默认等于交易币种 |
| `total_nav` | 十进制 | 否 | 总资产净值（AUM/NAV） |
| `total_nav_currency` | ISO 4217 | 否 | 总资产净值货币 |
| `outstanding_units` | 十进制 | 否 | 已发行单位数 |
| `management_fee_pct` | 十进制 | 否 | 年管理费百分比，例如 `0.45` 表示 0.45% |
| `ongoing_charges_pct` | 十进制 | 否 | 年持续费用百分比 |
| `source_url` | URL | 是 | 该记录直接来源 |
| `collected_at` | 时间戳 | 是 | 系统取得资料的时间 |

### 3.4 官方表现记录：`performance_record`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `performance_id` | UUID | 是 | 系统内部唯一编号 |
| `etf_id` | UUID | 是 | 关联 ETF 产品 |
| `counter_id` | UUID | 否 | 只有明确属于某柜台/上市类别时才关联 |
| `as_of_date` | 日期 | 是 | 发行商披露表现对应日期 |
| `period` | 枚举 | 是 | `1m`、`3m`、`6m`、`1y`、`3y`、`5y`、`ytd`、`calendar_year` |
| `return_pct` | 十进制 | 是 | 官方公布百分比，例如 `12.34` 表示 12.34% |
| `return_basis` | 枚举 | 是 | `nav`、`market_price`、`benchmark`、`unknown` |
| `includes_distribution` | 布尔 | 否 | 仅在官方明确披露时填写 |
| `source_url` | URL | 是 | 文件或网页来源 |
| `collected_at` | 时间戳 | 是 | 系统取得资料的时间 |

### 3.5 文件与来源：`document`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `document_id` | UUID | 是 | 系统内部唯一编号 |
| `etf_id` | UUID | 是 | 关联 ETF |
| `document_type` | 枚举 | 是 | `fact_sheet`、`prospectus`、`notice`、`annual_report`、`product_page` |
| `title` | 文本 | 是 | 官方文件标题 |
| `url` | URL | 是 | 官方链接 |
| `published_date` | 日期 | 否 | 官方发布日期 |
| `content_hash` | 文本 | 否 | 用于判断文件是否变更 |
| `first_seen_at` | 时间戳 | 是 | 系统首次发现时间 |
| `last_seen_at` | 时间戳 | 是 | 最近成功核对时间 |

## 4. 首批候选 ETF（Global X Hong Kong）

下列是首轮接入候选。实施前会以 HKEX 目录和发行商页面再次核验其当前上市状态、产品类型与交易柜台。

| 代码（候选主柜台） | 官方英文名称 | 初步类别 |
|---:|---|---|
| 2837 | Global X Hang Seng TECH ETF | 股票／香港科技 |
| 3040 | Global X MSCI China ETF | 股票／中国 |
| 3029 | Global X Hang Seng ESG ETF | 股票／香港 ESG |
| 3064 | Global X MSCI Asia Pacific ex Japan ETF | 股票／亚太（日本除外） |
| 3110 | Global X Hang Seng High Dividend Yield ETF | 股票／高股息 |
| 3116 | Global X Asia Pacific High Dividend Yield ETF | 股票／亚太高股息 |
| 3185 | Global X FinTech ETF | 股票／金融科技主题 |
| 3401 | Global X AI Infrastructure ETF | 股票／AI 主题 |
| 3402 | Global X G2 Tech ETF | 股票／科技主题 |
| 3422 | Global X Innovative Bluechip Top 10 ETF | 股票／全球主题 |
| 3041 | Global X FTSE China Policy Bank Bond ETF | 债券／中国 |
| 3059 | Global X Bloomberg MSCI Asia Ex Japan Green Bond ETF | 债券／绿色债券 |
| 3075 | Global X Asia USD Investment Grade Bond ETF | 债券／亚洲美元投资级 |
| 3137 | Global X USD Money Market ETF | 货币市场 |
| 3440 | Global X US Treasury 0-3 Month ETF | 债券／美国国债 |
| 3450 | Global X US Treasury 3-5 Year ETF | 债券／美国国债 |

## 5. 来源登记表

| 来源 | 用途 | 频率 | 取得方式 | 可写入字段 |
|---|---|---:|---|---|
| HKEX ETP 产品目录 | ETF 名单、股票代码、交易币种、上市日、发行商、产品类型 | 每周 | 官方网页/公开目录 | `listing_counter` 基础字段 |
| Global X 产品页面 | 净值、AUM、费用、交易柜台、产品目标、追踪指数、派息说明 | 每日（收市后） | 发行商公开产品页 | `etf`、`listing_counter`、`fund_snapshot` |
| Global X 基金事实表 | 官方期间表现、组合资料、费用、净值日期 | 每周 | 产品页所链接的官方文件 | `performance_record`、`document` |
| Global X 公告/文件 | 产品策略、文件或派息变更 | 每周 | 发行商文件中心 | `document`、更新事件 |

## 6. 更新与校验规则

### 6.1 更新频率

- 每周一：同步 HKEX ETF 目录，发现新增、除牌、交易柜台变更。
- 每个香港交易日收市后：同步已接入发行商的当前净值、基金规模和费用资料。
- 每周：检查基金事实表和公告的新增/变更。

### 6.2 写入前校验

- `stock_code` 必须为 HKEX 代码格式，且在同一时间只有一个有效柜台记录。
- 货币必须是明确披露的 HKD、USD 或 RMB；不得从名称推断。
- `as_of_date` 不得晚于采集日；若相差超过 10 个自然日，标记为“资料可能过期”。
- 净值、基金规模、费用和已发行单位必须是非负数。
- 回报记录必须有表现期间、对应日期和口径；没有口径的数值不在前台作为“回报”显示。
- 同一 ETF 不同柜台、不同份额类别或不同货币的数据不得互相覆盖。

### 6.3 变更处理

- 当日指标以“新增历史快照”保存，不覆盖旧记录。
- 基金名称、指数、费用、交易柜台等基础资料变更时，保留旧值和变更事件。
- 来源失效或解析失败时，保留最近一次有效资料，并将网站状态标为“更新延迟”。

## 7. 数据处理流程

```text
1. 获取官方页面或文件
2. 保存原始快照：来源网址、采集时间、内容摘要
3. 按来源进行解析：HKEX 解析器 / Global X 解析器
4. 映射到标准字段
5. 执行校验、去重与柜台归属检查
6. 写入历史记录和运行日志
7. 输出供网站使用的 ETF 列表、详情和比较资料
```

## 8. 第一版明确不做的计算

- 不自行计算含派息的总回报。
- 不用净值替代收市价格，也不用收市价格替代净值。
- 不将不同货币下的数值直接比较或汇总。
- 不根据历史表现生成“买入”“卖出”或“最值得投资”的结论。

## 9. 后续扩展门槛

只有在以下条件达成后，才接入第二家发行商：

1. Global X 的首批至少 15 只 ETF 成功导入。
2. 连续 14 天自动更新的成功率达到 95% 以上。
3. 每条前台数据都能显示官方来源和更新时间。
4. 已完成来源使用条款和署名要求的人工核对。
