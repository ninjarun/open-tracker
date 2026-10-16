// src/utils/portfolioSeries.ts
//
// Pure functions (no database access) that turn transactions + price history
// into (a) a portfolio value-over-time series for the chart and (b) per-asset
// period P&L numbers for the header and the asset table.

export type RangeKey = '1HR' | '1D' | '1W' | '1M' | 'YTD' | '1YR' | 'ALL';
export const RANGES: RangeKey[] = ['1HR', '1D', '1W', '1M', 'YTD', '1YR', 'ALL'];

const HOUR_MS = 3600000;
export const DAY_MS = 86400000;
// CoinGecko's free API only serves ~365 days of history.
export const MAX_HISTORY_MS = 365 * DAY_MS;
export const DEFAULT_SAMPLES = 120;

export type PricePoint = { t: number; p: number };

export type SeriesTx = {
  type: string;
  amount: number;
  price: number;
  fee: number;
  date: number; // epoch ms
};

export type AssetInput = {
  txs: SeriesTx[];
  prices: PricePoint[]; // sorted ascending by t
};

export type AssetStats = {
  hasPrices: boolean;
  holdingsNow: number;
  priceNow: number;
  valueStart: number;
  valueEnd: number;
  netFlow: number; // cash put in (+) / taken out (-) during the window
  grossBuys: number; // cash spent on buys during the window
  pnl: number; // valueEnd - valueStart - netFlow
  base: number; // capital the percentage is measured against
};

/** Where the chart line starts for a given range. */
export function getSeriesStart(
  range: RangeKey,
  now: number,
  firstTxTime: number | null
): number {
  const floor = now - MAX_HISTORY_MS;
  switch (range) {
    case '1HR':
      return now - HOUR_MS;
    case '1D':
      return now - DAY_MS;
    case '1W':
      return now - 7 * DAY_MS;
    case '1M':
      return now - 30 * DAY_MS;
    case 'YTD':
      return Math.max(new Date(new Date(now).getFullYear(), 0, 1).getTime(), floor);
    case '1YR':
      return floor;
    case 'ALL':
    default:
      return firstTxTime !== null ? Math.max(firstTxTime, floor) : floor;
  }
}

function lastIndexAtOrBefore<T extends { t: number }>(arr: T[], t: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

type HoldingsEvent = { t: number; h: number };

/** Running balance after every BUY / SELL. Other tx types are ignored (same as pnl.ts). */
function buildHoldings(txs: SeriesTx[]): HoldingsEvent[] {
  const sorted = [...txs].sort((a, b) => a.date - b.date);
  const events: HoldingsEvent[] = [];
  let h = 0;
  for (const tx of sorted) {
    const type = String(tx.type || '').toUpperCase();
    if (type === 'BUY') {
      h += tx.amount;
    } else if (type === 'SELL') {
      h = Math.max(0, h - tx.amount);
    } else {
      continue;
    }
    events.push({ t: tx.date, h });
  }
  return events;
}

function holdingsAt(events: HoldingsEvent[], t: number): number {
  const i = lastIndexAtOrBefore(events, t);
  return i < 0 ? 0 : events[i].h;
}

/**
 * Price at time t, linearly interpolated between the two surrounding points.
 * Before the first point -> first price. After the last point -> last price.
 */
export function priceAt(prices: PricePoint[], t: number): number | null {
  if (prices.length === 0) return null;
  if (t <= prices[0].t) return prices[0].p;
  const i = lastIndexAtOrBefore(prices, t);
  if (i >= prices.length - 1) return prices[prices.length - 1].p;
  const a = prices[i];
  const b = prices[i + 1];
  const span = b.t - a.t;
  if (span <= 0) return a.p;
  return a.p + ((b.p - a.p) * (t - a.t)) / span;
}

/**
 * Portfolio value at `samples` evenly spaced moments between start and end,
 * using the holdings you actually had at each moment. Leading zeros (before
 * your first buy) are trimmed so the line starts when the portfolio does.
 */
export function buildPortfolioSeries(
  assets: AssetInput[],
  start: number,
  end: number,
  samples: number = DEFAULT_SAMPLES
): { times: number[]; values: number[] } {
  const prepared = assets
    .filter(a => a.prices.length > 0)
    .map(a => ({ events: buildHoldings(a.txs), prices: a.prices }));

  const span = Math.max(end - start, 1);
  const times: number[] = [];
  const values: number[] = [];

  for (let i = 0; i < samples; i++) {
    const t = start + (span * i) / (samples - 1);
    let total = 0;
    for (const a of prepared) {
      const h = holdingsAt(a.events, t);
      if (h > 0) {
        const p = priceAt(a.prices, t);
        if (p !== null) total += h * p;
      }
    }
    times.push(t);
    values.push(total);
  }

  const first = values.findIndex(v => v > 0);
  if (first < 0) return { times: [], values: [] };
  return { times: times.slice(first), values: values.slice(first) };
}

/**
 * Period performance for one asset between start and end.
 * pnl = (value at end) - (value at start) - (net cash added during the window)
 * so buying more during the period is not counted as profit.
 * For 'ALL', pass start = first transaction time (value at start is 0).
 */
export function computeAssetStats(input: AssetInput, start: number, end: number): AssetStats {
  const events = buildHoldings(input.txs);
  const holdingsNow = holdingsAt(events, end);

  let netFlow = 0;
  let grossBuys = 0;
  for (const tx of input.txs) {
    if (tx.date < start || tx.date > end) continue;
    const type = String(tx.type || '').toUpperCase();
    if (type === 'BUY') {
      const cost = tx.amount * tx.price + tx.fee;
      netFlow += cost;
      grossBuys += cost;
    } else if (type === 'SELL') {
      netFlow -= tx.amount * tx.price - tx.fee;
    }
  }

  const priceStart = priceAt(input.prices, start);
  const priceEnd = priceAt(input.prices, end);

  if (priceStart === null || priceEnd === null) {
    return {
      hasPrices: false,
      holdingsNow,
      priceNow: 0,
      valueStart: 0,
      valueEnd: 0,
      netFlow,
      grossBuys,
      pnl: 0,
      base: 0,
    };
  }

  const valueStart = holdingsAt(events, start - 1) * priceStart;
  const valueEnd = holdingsNow * priceEnd;

  return {
    hasPrices: true,
    holdingsNow,
    priceNow: priceEnd,
    valueStart,
    valueEnd,
    netFlow,
    grossBuys,
    pnl: valueEnd - valueStart - netFlow,
    base: valueStart + grossBuys,
  };
}
