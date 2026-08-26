"""Collect delayed HK ETF market data from Yahoo Finance via yfinance.

This collector deliberately keeps market data separate from issuer product data.
It is intended for an educational portfolio project, not for trading execution.
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "catalog-latest.json"
SYMBOL_PATH = ROOT / "config" / "yfinance-symbols.json"
JSON_OUTPUT = ROOT / "data" / "market-yfinance-latest.json"
JS_OUTPUT = ROOT / "data" / "market-yfinance-latest.js"
FX_PAIRS = {
    "USD/HKD": {"symbol": "HKD=X", "baseCurrency": "USD", "quoteCurrency": "HKD"},
    "RMB/HKD": {"symbol": "CNYHKD=X", "baseCurrency": "RMB", "quoteCurrency": "HKD"},
}


def finite_number(value: Any, digits: int = 4) -> float | int | None:
    if value is None or pd.isna(value):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    rounded = round(number, digits)
    return int(rounded) if rounded.is_integer() else rounded


def iso_timestamp(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("Asia/Hong_Kong")
    return timestamp.isoformat()


def default_symbol(stock_code: str) -> str:
    normalized = stock_code.lstrip("0") or "0"
    return f"{normalized.zfill(4)}.HK"


def moving_average(values: list[float | None], window: int) -> list[float | None]:
    series = pd.Series(values, dtype="float64")
    return [finite_number(value) for value in series.rolling(window).mean().tolist()]


def candle_rows(history: pd.DataFrame) -> list[dict[str, Any]]:
    if history.empty:
        return []
    frame = history.dropna(subset=["Open", "High", "Low", "Close"]).tail(66).copy()
    closes = [finite_number(value) for value in frame["Close"].tolist()]
    ma5 = moving_average(closes, 5)
    ma20 = moving_average(closes, 20)
    rows: list[dict[str, Any]] = []
    for position, (index, row) in enumerate(frame.iterrows()):
        rows.append(
            {
                "date": pd.Timestamp(index).date().isoformat(),
                "open": finite_number(row["Open"]),
                "high": finite_number(row["High"]),
                "low": finite_number(row["Low"]),
                "close": finite_number(row["Close"]),
                "volume": finite_number(row.get("Volume"), 0),
                "ma5": ma5[position],
                "ma20": ma20[position],
            }
        )
    return rows


def fx_rate_rows(history: pd.DataFrame) -> list[dict[str, Any]]:
    """Keep date-aligned FX closes used to translate historical NAV into HKD."""
    if history.empty or "Close" not in history:
        return []
    frame = history.dropna(subset=["Close"]).tail(90)
    return [
        {"date": pd.Timestamp(index).date().isoformat(), "close": finite_number(row["Close"], 6)}
        for index, row in frame.iterrows()
    ]


def latest_intraday_session(history: pd.DataFrame) -> pd.DataFrame:
    if history.empty:
        return history
    frame = history.dropna(subset=["Open", "Close"]).copy()
    if frame.empty:
        return frame
    dates = pd.Index(frame.index).date
    latest_date = max(dates)
    return frame[[date == latest_date for date in dates]]


def flow_proxy(session: pd.DataFrame) -> dict[str, Any]:
    buy_turnover = 0.0
    sell_turnover = 0.0
    neutral_turnover = 0.0
    for _, row in session.iterrows():
        turnover = float(row["Close"]) * float(row.get("Volume", 0) or 0)
        if row["Close"] > row["Open"]:
            buy_turnover += turnover
        elif row["Close"] < row["Open"]:
            sell_turnover += turnover
        else:
            neutral_turnover += turnover
    directional = buy_turnover + sell_turnover
    return {
        "buyTurnover": finite_number(buy_turnover, 2),
        "sellTurnover": finite_number(sell_turnover, 2),
        "neutralTurnover": finite_number(neutral_turnover, 2),
        "netTurnover": finite_number(buy_turnover - sell_turnover, 2),
        "buyRatio": finite_number((buy_turnover / directional) * 100, 2) if directional else None,
        "method": "5 分钟 K 线按收盘价相对开盘价方向归类的成交额估算；并非 ETF 申购赎回数据。",
    }


def ticker_frame(batch: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if batch.empty:
        return pd.DataFrame()
    if not isinstance(batch.columns, pd.MultiIndex):
        return batch.dropna(how="all")
    level_zero = batch.columns.get_level_values(0)
    level_one = batch.columns.get_level_values(1)
    if symbol in level_zero:
        return batch[symbol].dropna(how="all")
    if symbol in level_one:
        return batch.xs(symbol, axis=1, level=1).dropna(how="all")
    return pd.DataFrame()


def batch_history(symbols: list[str], period: str, interval: str) -> pd.DataFrame:
    delays = [0, 15, 45]
    last = pd.DataFrame()
    for attempt, delay in enumerate(delays, start=1):
        if delay:
            print(f"Yahoo rate-limit/backoff: waiting {delay}s before attempt {attempt}...")
            time.sleep(delay)
        try:
            last = yf.download(
                symbols,
                period=period,
                interval=interval,
                auto_adjust=False,
                actions=False,
                group_by="ticker",
                threads=True,
                progress=False,
                timeout=30,
            )
            if not last.empty:
                return last
        except Exception as error:
            print(f"Batch attempt {attempt} failed: {error}")
    return last


def collect_record(stock_code: str, symbol: str, name: str, daily: pd.DataFrame, intraday: pd.DataFrame) -> dict[str, Any]:
    base = {"stockCode": stock_code, "yahooSymbol": symbol, "name": name}
    try:
        candles = candle_rows(daily)
        if not candles:
            raise RuntimeError("No daily price history returned")

        session = latest_intraday_session(intraday)
        latest_daily = candles[-1]
        previous_close = candles[-2]["close"] if len(candles) > 1 else None
        last_price = finite_number(session.iloc[-1]["Close"]) if not session.empty else latest_daily["close"]
        if previous_close in (None, 0) or last_price is None:
            change = change_pct = None
        else:
            change = finite_number(last_price - previous_close)
            change_pct = finite_number((last_price / previous_close - 1) * 100)

        if not session.empty:
            open_price = finite_number(session.iloc[0]["Open"])
            high_price = finite_number(session["High"].max())
            low_price = finite_number(session["Low"].min())
            volume = finite_number(session["Volume"].sum(), 0)
            turnover = finite_number((session["Close"] * session["Volume"]).sum(), 2)
            as_of = iso_timestamp(session.index[-1])
        else:
            open_price = latest_daily["open"]
            high_price = latest_daily["high"]
            low_price = latest_daily["low"]
            volume = latest_daily["volume"]
            turnover = finite_number((latest_daily["close"] or 0) * (latest_daily["volume"] or 0), 2)
            as_of = f"{latest_daily['date']}T16:00:00+08:00"

        return {
            **base,
            "status": "ok",
            "currency": "HKD",
            "exchangeTimezone": "Asia/Hong_Kong",
            "lastPrice": last_price,
            "previousClose": previous_close,
            "change": change,
            "changePct": change_pct,
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "volume": volume,
            "turnoverEstimate": turnover,
            "asOf": as_of,
            "candles": candles,
            "flowProxy": flow_proxy(session),
        }
    except Exception as error:
        return {**base, "status": "error", "error": str(error), "candles": [], "flowProxy": None}


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    overrides = json.loads(SYMBOL_PATH.read_text(encoding="utf-8"))
    previous_records: dict[str, dict[str, Any]] = {}
    previous_fx: dict[str, dict[str, Any]] = {}
    if JSON_OUTPUT.exists():
        try:
            previous = json.loads(JSON_OUTPUT.read_text(encoding="utf-8"))
            previous_records = {
                record["stockCode"]: record
                for record in previous.get("records", [])
                if record.get("status") == "ok"
            }
            previous_fx = {item["pair"]: item for item in previous.get("fxRates", []) if item.get("rates")}
        except (json.JSONDecodeError, KeyError):
            previous_records = {}
            previous_fx = {}

    requested = []
    for catalog_record in catalog.get("records", []):
        stock_code = str(catalog_record["listingCounter"]["stockCode"])
        if stock_code not in overrides:
            continue
        requested.append(
            {
                "stockCode": stock_code,
                "name": catalog_record["etf"]["officialNameEn"],
                "symbol": overrides[stock_code],
            }
        )
    symbols = [item["symbol"] for item in requested]
    daily_symbols = symbols + [pair["symbol"] for pair in FX_PAIRS.values()]
    print(f"Downloading daily history for {len(daily_symbols)} ETF and FX symbols in one batch...")
    daily_batch = batch_history(daily_symbols, period="6mo", interval="1d")
    print(f"Downloading 5-minute history for {len(symbols)} symbols in one batch...")
    intraday_batch = batch_history(symbols, period="5d", interval="5m")

    records = []
    fresh = 0
    for item in requested:
        print(f"Normalizing {item['stockCode']} ({item['symbol']})...")
        record = collect_record(
            item["stockCode"],
            item["symbol"],
            item["name"],
            ticker_frame(daily_batch, item["symbol"]),
            ticker_frame(intraday_batch, item["symbol"]),
        )
        if record["status"] == "ok":
            fresh += 1
        elif item["stockCode"] in previous_records:
            record = {
                **previous_records[item["stockCode"]],
                "stale": True,
                "refreshError": record.get("error"),
            }
        records.append(record)

    fx_rates = []
    for pair, config in FX_PAIRS.items():
        rates = fx_rate_rows(ticker_frame(daily_batch, config["symbol"]))
        if rates:
            fx_rates.append(
                {
                    "pair": pair,
                    "yahooSymbol": config["symbol"],
                    "baseCurrency": config["baseCurrency"],
                    "quoteCurrency": config["quoteCurrency"],
                    "rates": rates,
                }
            )
        elif pair in previous_fx:
            fx_rates.append({**previous_fx[pair], "stale": True})

    available = sum(record["status"] == "ok" for record in records)
    if not records or fresh == 0:
        raise RuntimeError("Market refresh returned no usable ETF records; previous output was preserved.")

    payload = {
        "schemaVersion": "market-yfinance-v2",
        "provider": "Yahoo Finance via yfinance",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "quoteType": "delayed_or_end_of_bar",
        "recordsRequested": len(records),
        "recordsAvailable": available,
        "recordsFresh": fresh,
        "records": records,
        "fxRatesAvailable": len(fx_rates),
        "fxRates": fx_rates,
        "disclaimer": "数据来自 yfinance 使用的 Yahoo Finance 公开接口，可能延迟、缺失或调整，仅供教育与研究展示。",
    }
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    JSON_OUTPUT.write_text(serialized, encoding="utf-8")
    JS_OUTPUT.write_text(f"window.HK_ETF_MARKET = {serialized.rstrip()};\n", encoding="utf-8")
    print(f"Saved {available}/{len(records)} available records ({fresh} fresh).")


if __name__ == "__main__":
    main()
