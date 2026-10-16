// database/utils/syncEngine.ts
import { database } from '../index';
import { Asset, PriceHistory, Transaction } from '../models';
import { Q } from '@nozbe/watermelondb';

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
// Pause between CoinGecko history calls (free tier is rate limited).
const HISTORY_CALL_PACE_MS = 3500;

/**
 * Ensures the database is instantiated
 */
function getActiveDatabase() {
  if (!database) throw new Error('Database not initialized.');
  return database;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type FetchOptions = { retries?: number; waitMs?: number };

/**
 * fetch + JSON with an HTTP status check. Rate limits (429) and server errors
 * (5xx) are retried with a growing wait (waitMs, 2*waitMs, ...).
 */
async function fetchJson(
  url: string,
  headers: HeadersInit = {},
  options: FetchOptions = {},
  attempt: number = 1
): Promise<any> {
  const { retries = 1, waitMs = 15000 } = options;
  const response = await fetch(url, { headers });

  if ((response.status === 429 || response.status >= 500) && attempt <= retries) {
    await sleep(waitMs * attempt);
    return fetchJson(url, headers, options, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

/** Demo keys ("CG-...") and Pro keys use different header names. */
function apiHeaders(key?: string): HeadersInit {
  if (!key) return {};
  return key.startsWith('CG-') ? { 'x-cg-demo-api-key': key } : { 'x-cg-pro-api-key': key };
}

// In-memory caches
let cachedCoinList: { id: string; symbol: string; name: string }[] = [];
const resolvedIds = new Map<string, string>();

/**
 * Algorithmic matching resolver that scales infinitely without hardcoding
 */
export async function resolveCoinGeckoId(ticker: string, assetName: string): Promise<string> {
  const cleanTicker = ticker.toLowerCase().trim();
  const cleanName = assetName.toLowerCase().trim();
  const cacheKey = `${cleanTicker}|${cleanName}`;

  const cached = resolvedIds.get(cacheKey);
  if (cached) return cached;

  const remember = (id: string) => {
    resolvedIds.set(cacheKey, id);
    return id;
  };

  if (cachedCoinList.length === 0) {
    try {
      const list = await fetchJson('https://api.coingecko.com/api/v3/coins/list');
      if (Array.isArray(list)) cachedCoinList = list;
    } catch (e) {
      console.warn('Could not download the CoinGecko coin list:', e);
    }
  }

  const matches = cachedCoinList.filter(c => c.symbol.toLowerCase() === cleanTicker);

  if (matches.length === 1) return remember(matches[0].id);

  if (matches.length > 1) {
    const exactIdMatch = matches.find(c => c.id.toLowerCase() === cleanTicker);
    if (exactIdMatch) return remember(exactIdMatch.id);

    const structuralMatch = matches.find(
      c => cleanName.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(cleanName)
    );
    if (structuralMatch) return remember(structuralMatch.id);

    return remember([...matches].sort((a, b) => a.id.length - b.id.length)[0].id);
  }

  try {
    const searchData = await fetchJson(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(cleanTicker)}`
    );
    if (searchData.coins && searchData.coins.length > 0) {
      return remember(searchData.coins[0].id);
    }
  } catch (e) {
    console.error(`Resolver could not track asset down: ${ticker}`);
  }

  // Not cached on purpose: this may just be a temporary network failure.
  return cleanTicker;
}

/**
 * Bulk syncs real-time price feeds. Stocks are skipped (CoinGecko is crypto only).
 */
export async function syncPriceData(byokKey?: string): Promise<void> {
  try {
    const db = getActiveDatabase();
    const allAssets = await db.get<Asset>('assets').query().fetch();
    const assets = allAssets.filter(a => a.type !== 'stock');
    if (assets.length === 0) return;

    // Several assets can resolve to the same CoinGecko id, so keep a list per id.
    const assetsByApiId = new Map<string, Asset[]>();
    for (const asset of assets) {
      const apiId = await resolveCoinGeckoId(asset.ticker, asset.name || asset.ticker);
      const list = assetsByApiId.get(apiId) || [];
      list.push(asset);
      assetsByApiId.set(apiId, list);
    }

    const ids = Array.from(assetsByApiId.keys()).map(id => encodeURIComponent(id));
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
    const data = await fetchJson(url, apiHeaders(byokKey));

    await db.write(async () => {
      const now = new Date();
      const operations: any[] = [];
      const phCollection = db.get<PriceHistory>('price_history');

      for (const [apiId, group] of assetsByApiId.entries()) {
        const price = data?.[apiId]?.usd;
        if (typeof price !== 'number' || !(price > 0)) continue;

        for (const asset of group) {
          operations.push(
            phCollection.prepareCreate((record: any) => {
              record.asset.set(asset);
              record.price = price;
              record.timestamp = now;
            })
          );
        }
      }

      if (operations.length > 0) await db.batch(...operations);
    });

    console.log('Price sync complete.');
  } catch (error) {
    console.error('Sync engine hit a bottleneck:', error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Historical backfill
// ---------------------------------------------------------------------------
//
// CoinGecko picks the granularity from the `days` parameter:
//   days = 1       -> ~5 minute points
//   days = 2..90   -> hourly points
//   days > 90      -> daily points
// Each tier is only kept for the time window where it is the best resolution.
// Instead of trusting "did we ever finish?", every run MEASURES how many saved
// rows exist per window and downloads only the windows that are thin, so a
// failed download (rate limit, offline...) heals itself on the next run.

type RawPoint = [number, number]; // [timestamp ms, price]

export type BackfillResult = { inserted: number; failedTickers: string[] };

const SIX_HOURS_MS = 6 * 60 * MINUTE_MS;
const FAILURE_COOLDOWN_MS = 3 * MINUTE_MS;

let backfillInFlight: Promise<BackfillResult> | null = null;
// Per asset+tier: earliest time we are allowed to try again (avoids hammering the API).
const nextAllowed = new Map<string, number>();
const canRun = (key: string, force: boolean) => force || Date.now() >= (nextAllowed.get(key) ?? 0);
const markTier = (key: string, ok: boolean, okCooldownMs: number) =>
  nextAllowed.set(key, Date.now() + (ok ? okCooldownMs : FAILURE_COOLDOWN_MS));

async function edgeTimestamp(assetId: string, direction: 'asc' | 'desc'): Promise<number | null> {
  const db = getActiveDatabase();
  const rows = await db
    .get<PriceHistory>('price_history')
    .query(
      Q.where('asset_id', assetId),
      Q.sortBy('timestamp', direction === 'asc' ? Q.asc : Q.desc),
      Q.take(1)
    )
    .fetch();
  return rows[0] ? rows[0].timestamp.getTime() : null;
}

async function countRows(assetId: string, from: number, to: number): Promise<number> {
  const db = getActiveDatabase();
  return db
    .get<PriceHistory>('price_history')
    .query(Q.where('asset_id', assetId), Q.where('timestamp', Q.between(from, to)))
    .fetchCount();
}

/**
 * Inserts points that are not already represented. A point is skipped when an
 * existing row falls in the same time bucket (bucket size = gapMs).
 */
async function insertPoints(asset: Asset, points: RawPoint[], gapMs: number): Promise<number> {
  if (points.length === 0) return 0;
  const db = getActiveDatabase();
  const collection = db.get<PriceHistory>('price_history');

  let lo = Infinity;
  let hi = -Infinity;
  for (const [t] of points) {
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }

  const existing = await collection
    .query(Q.where('asset_id', asset.id), Q.where('timestamp', Q.between(lo - gapMs, hi + gapMs)))
    .fetch();
  const seen = new Set<number>(existing.map(row => Math.floor(row.timestamp.getTime() / gapMs)));

  const fresh: RawPoint[] = [];
  for (const [t, p] of points) {
    if (!Number.isFinite(t) || !Number.isFinite(p) || !(p > 0)) continue;
    const bucket = Math.floor(t / gapMs);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    fresh.push([t, p]);
  }

  const CHUNK = 1000;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK);
    await db.write(async () => {
      const ops = chunk.map(([t, p]) =>
        collection.prepareCreate((record: any) => {
          record.asset.set(asset);
          record.price = p;
          record.timestamp = new Date(t);
        })
      );
      await db.batch(...ops);
    });
  }

  return fresh.length;
}

async function runBackfill(byokKey?: string, force: boolean = false): Promise<BackfillResult> {
  const db = getActiveDatabase();
  const [assets, transactions] = await Promise.all([
    db.get<Asset>('assets').query().fetch(),
    db.get<Transaction>('transactions').query().fetch(),
  ]);

  // Only assets you actually hold/held matter for the portfolio chart.
  const heldAssetIds = new Set<string>(transactions.map(tx => tx.asset.id));
  const targets = assets.filter(a => a.type !== 'stock' && heldAssetIds.has(a.id));

  const headers = apiHeaders(byokKey);
  let madeApiCall = false;
  let inserted = 0;
  const failedTickers: string[] = [];

  const fetchChart = async (apiId: string, days: number): Promise<RawPoint[]> => {
    if (madeApiCall) await sleep(HISTORY_CALL_PACE_MS);
    madeApiCall = true;
    const data = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(apiId)}/market_chart?vs_currency=usd&days=${days}`,
      headers,
      { retries: 3, waitMs: 20000 }
    );
    return Array.isArray(data?.prices) ? (data.prices as RawPoint[]) : [];
  };

  for (const asset of targets) {
    try {
      const now = Date.now();
      const [newest, recentCount, hourlyCount, dailyCount] = await Promise.all([
        edgeTimestamp(asset.id, 'desc'),
        countRows(asset.id, now - DAY_MS, now), // expect ~288 (5 min)
        countRows(asset.id, now - 30 * DAY_MS, now - DAY_MS), // expect ~696 (hourly)
        countRows(asset.id, now - 365 * DAY_MS, now - 90 * DAY_MS), // expect ~275 (daily)
      ]);

      const hourlyKey = `${asset.id}:hourly`;
      const intradayKey = `${asset.id}:intraday`;
      const dailyKey = `${asset.id}:daily`;

      const wantHourly = hourlyCount < 400 && canRun(hourlyKey, force);
      const wantIntraday =
        (newest === null || now - newest > 10 * MINUTE_MS || recentCount < 100) && canRun(intradayKey, force);
      const wantDaily = dailyCount < 150;

      if (!wantHourly && !wantIntraday && !wantDaily) continue;

      const apiId = await resolveCoinGeckoId(asset.ticker, asset.name || asset.ticker);
      let assetFailed = false;
      let hourlyMissing = hourlyCount < 400;

      // 1) Hourly (last 90 days) - the most valuable tier for 1W / 1M / YTD charts, so it goes first.
      if (wantHourly) {
        try {
          const points = await fetchChart(apiId, 90);
          inserted += await insertPoints(
            asset,
            points.filter(([t]) => t >= now - 90 * DAY_MS && t < now - DAY_MS),
            30 * MINUTE_MS
          );
          markTier(hourlyKey, true, SIX_HOURS_MS);
          hourlyMissing = false;
        } catch (error) {
          console.warn(`Hourly history failed for ${asset.ticker}:`, error);
          markTier(hourlyKey, false, 0);
          assetFailed = true;
        }
      }

      // 2) Last 24 hours at ~5 minute detail / fills the hole since the last saved price.
      if (wantIntraday) {
        try {
          const points = await fetchChart(apiId, 1);
          inserted += await insertPoints(asset, points, 4 * MINUTE_MS);
          markTier(intradayKey, true, 10 * MINUTE_MS);
        } catch (error) {
          console.warn(`Intraday history failed for ${asset.ticker}:`, error);
          markTier(intradayKey, false, 0);
          assetFailed = true;
        }
      }

      // 3) Daily points. Also used as a fallback when the hourly download failed, so
      //    the chart gets at least one point per day instead of a straight line.
      if ((wantDaily || hourlyMissing) && canRun(dailyKey, force)) {
        try {
          const points = await fetchChart(apiId, 365);
          const cutoff = hourlyMissing ? now - DAY_MS : now - 90 * DAY_MS;
          inserted += await insertPoints(
            asset,
            points.filter(([t]) => t < cutoff),
            12 * 60 * MINUTE_MS
          );
          markTier(dailyKey, true, SIX_HOURS_MS);
        } catch (error) {
          console.warn(`Daily history failed for ${asset.ticker}:`, error);
          markTier(dailyKey, false, 0);
          assetFailed = true;
        }
      }

      if (assetFailed) failedTickers.push(asset.ticker);
    } catch (error) {
      console.warn(`History backfill failed for ${asset.ticker}:`, error);
      failedTickers.push(asset.ticker);
    }
  }

  console.log(
    `History backfill finished: ${inserted} new price points` +
      (failedTickers.length ? `, incomplete for: ${failedTickers.join(', ')}` : '')
  );
  return { inserted, failedTickers };
}

/**
 * Downloads dense price history for every held crypto asset, but only the
 * windows that are thin. Cheap to call repeatedly (it only touches the network
 * when something is missing) and safe to call concurrently (callers share one
 * run). Resolves with how many points were added and which coins are still
 * incomplete (for example because CoinGecko was rate limiting).
 */
export function backfillHistoricalPrices(byokKey?: string, force: boolean = false): Promise<BackfillResult> {
  if (backfillInFlight) return backfillInFlight;

  backfillInFlight = runBackfill(byokKey, force).finally(() => {
    backfillInFlight = null;
  });
  return backfillInFlight;
}
