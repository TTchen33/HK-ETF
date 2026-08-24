# HK ETF Explorer — 首个数据来源字段映射（v0.1）

**来源：** HKEX ETP 公开目录、Global X Hong Kong ETF 产品页及其链接的基金事实表。  
**目标：** 将来源原始文字转换为 `01-data-contract.md` 定义的标准字段。

## 1. HKEX ETP 产品目录映射

| 来源字段/栏目 | 标准字段 | 处理规则 | 备注 |
|---|---|---|---|
| Stock Code | `listing_counter.stock_code` | 作为文本保存，保留前导零 | 不能转成整数 |
| Name of ETF | `etf.official_name_en` | 保存官方英文名称 | 中文名称另行补充 |
| Stock Short Name | `listing_counter.stock_short_name` | 原样保存 | 不用于唯一识别 |
| ETF Manager | `etf.issuer` | 映射至发行商标准名称 | 维护别名表 |
| Underlying Benchmark | `etf.underlying_benchmark` | 保存官方名称 | 主动 ETF 可为空 |
| Type of ETF | `etf.management_style` | 被动/主动/未知 | 不把 L&I 纳入 |
| Board Lot | `listing_counter.board_lot_size` | 解析为整数 | 缺失则空 |
| Trading Currency | `listing_counter.trading_currency` | 映射为 HKD/USD/RMB | 不等于基础币种 |
| Date of Listing | `listing_counter.listing_date` | 统一为 ISO 日期 | 记录原格式 |
| ETF Docs | `document.url` | 创建文档链接记录 | 文档类型待二次识别 |

## 2. Global X 产品页映射

| 页面栏目 | 标准字段 | 处理规则 | 校验 |
|---|---|---|---|
| Fund Inception Date | 暂存原始资料 | 首版不作为上市日期 | 与 SEHK 日期区分 |
| SEHK Listing Date | `listing_counter.listing_date` | 仅用于对应上市类别 | 不得晚于采集日 |
| NAV Per Share | `fund_snapshot.nav_per_share` | 读取数值及同列币种 | 数值必须大于 0 |
| Total Net Asset Value | `fund_snapshot.total_nav` | 读取数值及同列币种 | 数值必须非负 |
| Outstanding Units | `fund_snapshot.outstanding_units` | 读取数值 | 数值必须非负 |
| Management Fee | `fund_snapshot.management_fee_pct` | 百分比存为 0.45，不存 0.0045 | 0–100 区间 |
| Ongoing Charges Over A Year | `fund_snapshot.ongoing_charges_pct` | 百分比存为 0.68，不存 0.0068 | 0–100 区间 |
| Stock Code | `listing_counter.stock_code` | 每个 Listed Class / 交易柜台独立记录 | 与 HKEX 二次核对 |
| ISIN | `listing_counter.isin` | 关联对应柜台或份额类别 | 允许为空 |
| Board Lot Size | `listing_counter.board_lot_size` | 解析整数 | 与 HKEX 二次核对 |
| Trading Currency | `listing_counter.trading_currency` | 只取当前 Listed Class | 不默认继承 |
| Base Currency | `etf.base_currency` | 保存基金基础币种 | 与交易币种独立 |
| Underlying Index | `etf.underlying_benchmark` | 被动 ETF 写入 | 主动 ETF 使用策略 |
| Distribution Frequency | `etf.distribution_frequency` | 映射到标准枚举 | “at manager's discretion”保留备注 |
| Fact Sheet | `document` | 保存 URL、类型为 `fact_sheet` | 解析后产生表现记录 |

## 3. 基金事实表映射

| 文件栏目 | 标准字段 | 处理规则 |
|---|---|---|
| As of / Date | `performance_record.as_of_date` | 必须能解析日期，否则整组表现不发布 |
| Cumulative Return (%) | `performance_record.return_pct` | 每个期间拆为一条记录 |
| Fund NAV / Fund Performance | `performance_record.return_basis` | 映射为 `nav` |
| Market Price | `performance_record.return_basis` | 映射为 `market_price`；首版可不在前台显示 |
| Benchmark | `performance_record.return_basis` | 映射为 `benchmark`；仅作比较，不做推荐 |
| 1 Month / 3 Months / 1 Year | `performance_record.period` | 映射为 `1m` / `3m` / `1y` |

## 4. 字段来源优先级

| 字段 | 第一来源 | 备用来源 | 冲突处理 |
|---|---|---|---|
| 上市状态、股票代码、交易币种 | HKEX | 发行商产品页 | 优先 HKEX；冲突入人工核对队列 |
| 净值、基金规模、费用、派息 | 发行商产品页/事实表 | HKEXnews 文件 | 优先发行商最新标注日期 |
| 历史表现 | 发行商事实表 | 发行商产品页 | 优先带日期与口径的资料 |
| 追踪指数、投资目标 | 发行商产品页 | HKEX 产品目录 | 优先发行商；保留原文 |
| 上市日期 | HKEX | 发行商产品页 | 优先 HKEX |

## 5. 解析失败时的行为

- 页面请求失败：记录任务失败，不更新任何当前数据。
- 找不到字段：仅该字段留空，其他可确认字段正常更新。
- 单位或币种不明确：不写入数值；保留原始文字和待核对标签。
- 发现同一代码对应不同产品：停止写入该代码，进入人工核对队列。
- 文件日期缺失：可保存文件链接，但不从文件中发布表现数据。
