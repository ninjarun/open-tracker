import { Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';
import { Asset, PriceAlert, PriceHistory } from '../../database/models';
import { dispatchLocalPriceAlertNotification } from './notifications';

export type AlertDirection = 'ABOVE' | 'BELOW';
export type MarketType = 'crypto' | 'stock';

export type PriceAlertRow = {
  id: string;
  assetId: string;
  ticker: string;
  name: string;
  direction: AlertDirection;
  threshold: number;
  enabled: boolean;
  triggeredAt?: Date;
  currentPrice: number;
};

type PriceLookupAsset = Pick<Asset, 'id' | 'ticker' | 'name' | 'type'>;

type YahooChartResult = {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        previousClose?: number;
      };
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

function normalizeMarketType(type?: string): MarketType {
  return type === 'stock' ? 'stock' : 'crypto';
}

function normalizeStockSymbol(assetIdOrTicker: string): string {
  return assetIdOrTicker
    .replace(/^stock[:-]/i, '')
    .trim()
    .toUpperCase();
}

async function fetchCryptoPrice(assetId: string): Promise<number> {
  const id = encodeURIComponent(assetId.trim().toLowerCase());
  const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
  const data = await response.json();

  return Number(data?.[assetId]?.usd ?? data?.[assetId.toLowerCase()]?.usd ?? 0);
}

async function fetchStockPrice(assetIdOrTicker: string): Promise<number> {
  const symbol = encodeURIComponent(normalizeStockSymbol(assetIdOrTicker));
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`);
  const data = await response.json() as YahooChartResult;
  const result = data.chart?.result?.[0];
  const closes = (result?.indicators?.quote?.[0]?.close || [])
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price));

  return Number(result?.meta?.regularMarketPrice ?? closes[closes.length - 1] ?? 0);
}

export async function fetchGlobalPrice(
  asset: string | PriceLookupAsset,
  type: MarketType | string = 'crypto'
): Promise<number> {
  const assetId = typeof asset === 'string' ? asset : asset.id;
  const ticker = typeof asset === 'string' ? asset : asset.ticker;
  const marketType = normalizeMarketType(typeof asset === 'string' ? type : asset.type);

  if (marketType === 'stock') {
    return fetchStockPrice(ticker || assetId);
  }

  return fetchCryptoPrice(assetId);
}

async function getLatestPrice(database: Database, assetId: string): Promise<number> {
  const rows = await database.get<PriceHistory>('price_history')
    .query(Q.where('asset_id', assetId), Q.sortBy('timestamp', Q.desc), Q.take(1))
    .fetch();

  return rows[0] ? Number(rows[0].price || 0) : 0;
}

export async function listPriceAlerts(database: Database): Promise<PriceAlertRow[]> {
  const alerts = await database.get<PriceAlert>('price_alerts')
    .query(Q.sortBy('created_at', Q.desc))
    .fetch();

  return Promise.all(alerts.map(async alert => {
    const asset = await alert.asset.fetch() as Asset;
    const currentPrice = await getLatestPrice(database, asset.id);

    return {
      id: alert.id,
      assetId: asset.id,
      ticker: asset.ticker,
      name: asset.name,
      direction: alert.direction,
      threshold: alert.threshold,
      enabled: alert.enabled,
      triggeredAt: alert.triggeredAt,
      currentPrice,
    };
  }));
}

// export async function createPriceAlert(database: Database, params: {
//   assetId: string;
//   direction: AlertDirection;
//   threshold: number;
// }): Promise<void> {
//   const asset = await database.get<Asset>('assets').find(params.assetId);

//   await database.write(async () => {
//     await database.get<PriceAlert>('price_alerts').create((alert: any) => {
//       alert.asset.set(asset);
//       alert.direction = params.direction;
//       alert.threshold = Number(params.threshold);
//       alert.enabled = true;
//       alert.createdAt = new Date();
//       alert.updatedAt = new Date();
//     });
//   });
// }
export async function createPriceAlert(database: Database, params: {
  assetId: string;       // global coin id or stock/ETF ticker: e.g. 'solana' or 'AAPL'
  ticker: string;        // e.g. 'SOL' or 'AAPL'
  name: string;          // e.g. 'Solana' or 'Apple Inc.'
  direction: AlertDirection;
  threshold: number;
  type?: string;         // 'crypto' | 'stock'; defaults to crypto for existing callers
}): Promise<void> {
  const marketType = normalizeMarketType(params.type);

  await database.write(async () => {
    // 1. Ensure the asset exists in our local dictionary table so the relation doesn't break
    let assetRow;
    try {
      assetRow = await database.get<Asset>('assets').find(params.assetId);
    } catch {
      const now = new Date();
      // Asset doesn't exist in our portfolio ledger yet! Create a watch-only placeholder row
      assetRow = await database.get<Asset>('assets').create((newAsset: any) => {
        newAsset._raw.id = params.assetId; // Lock the IDs together
        newAsset.ticker = params.ticker;
        newAsset.name = params.name;
        newAsset.type = marketType;
        newAsset.createdAt = now;
        newAsset.updatedAt = now;
      });
    }

    // 2. Create the price alert exactly like before
    await database.get<PriceAlert>('price_alerts').create((alert: any) => {
      alert.asset.set(assetRow);
      alert.direction = params.direction;
      alert.threshold = Number(params.threshold);
      alert.enabled = true;
      alert.createdAt = new Date();
      alert.updatedAt = new Date();
    });
  });
}

export async function disablePriceAlert(database: Database, alertId: string): Promise<void> {
  const alert = await database.get<PriceAlert>('price_alerts').find(alertId);

  await database.write(async () => {
    await alert.update((record: any) => {
      record.enabled = false;
      record.updatedAt = new Date();
    });
  });
}

export async function checkPriceAlerts(database: Database): Promise<number> {
  const alerts = await database.get<PriceAlert>('price_alerts')
    .query(Q.where('enabled', true))
    .fetch();

  let triggered = 0;

  for (const alert of alerts) {
    const asset = await alert.asset.fetch() as Asset;
    let currentPrice = await fetchGlobalPrice(asset);

    // Keep local price history as a safe fallback for offline/rate-limited checks.
    if (currentPrice <= 0) {
      currentPrice = await getLatestPrice(database, asset.id);
    }
    if (currentPrice <= 0) continue;

    const direction = alert.direction;
    const threshold = Number(alert.threshold || 0);
    const breached = direction === 'ABOVE'
      ? currentPrice >= threshold
      : currentPrice <= threshold;

    if (!breached) continue;

    await dispatchLocalPriceAlertNotification({
      ticker: asset.ticker,
      direction,
      threshold,
      currentPrice,
    });

    await database.write(async () => {
      await alert.update((record: any) => {
        record.enabled = false;
        record.triggeredAt = new Date();
        record.updatedAt = new Date();
      });
    });

    triggered += 1;
  }

  return triggered;
}
