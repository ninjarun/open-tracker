// database/utils/syncEngine.ts
import { database } from '../index';
import { Asset, PriceHistory } from '../models';
import { Q } from '@nozbe/watermelondb';

/**
 * Ensures the database is instantiated
 */
function getActiveDatabase() {
  if (!database) throw new Error("Database not initialized.");
  return database;
}

// In-memory cache for the coin registry
let cachedCoinList: { id: string, symbol: string, name: string }[] = [];

/**
 * Algorithmic matching resolver that scales infinitely without hardcoding
 */
export async function resolveCoinGeckoId(ticker: string, assetName: string): Promise<string> {
  if (cachedCoinList.length === 0) {
    const response = await fetch('https://api.coingecko.com/api/v3/coins/list');
    cachedCoinList = await response.json();
  }

  const cleanTicker = ticker.toLowerCase().trim();
  const cleanName = assetName.toLowerCase().trim();

  const matches = cachedCoinList.filter(c => c.symbol.toLowerCase() === cleanTicker);

  if (matches.length === 1) return matches[0].id;

  if (matches.length > 1) {
    const exactIdMatch = matches.find(c => c.id.toLowerCase() === cleanTicker);
    if (exactIdMatch) return exactIdMatch.id;

    const structuralMatch = matches.find(c => 
      cleanName.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(cleanName)
    );
    if (structuralMatch) return structuralMatch.id;

    return matches.sort((a, b) => a.id.length - b.id.length)[0].id;
  }

  try {
    const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${cleanTicker}`);
    const searchData = await searchRes.json();
    if (searchData.coins && searchData.coins.length > 0) {
      return searchData.coins[0].id; 
    }
  } catch (e) {
    console.error(`Infinite scaling resolver could not track asset down: ${ticker}`);
  }

  return cleanTicker; 
}

/**
 * Bulk syncs real-time price feeds utilizing smart dynamic resolution
 */
export async function syncPriceData(byokKey?: string): Promise<void> {
  try {
    const db = getActiveDatabase();
    const assets = await db.get<Asset>('assets').query().fetch();
    if (assets.length === 0) return;

    const assetIdMap = new Map<string, Asset>();
    const apiIds: string[] = [];

    for (const asset of assets) {
      const apiId = await resolveCoinGeckoId(asset.ticker, asset.name || asset.ticker);
      assetIdMap.set(apiId, asset);
      apiIds.push(apiId);
    }

    const uniqueIds = Array.from(new Set(apiIds));
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${uniqueIds.join(',')}&vs_currencies=usd`;
    const headers: HeadersInit = byokKey ? { 'x-cg-pro-api-key': byokKey } : {};
    
    const response = await fetch(url, { headers });
    const data = await response.json();

    await db.write(async () => {
      const now = new Date();
      const operations = [];
      const phCollection = db.get<PriceHistory>('price_history');

      for (const [apiId, asset] of assetIdMap.entries()) {
        const priceData = data[apiId];
        if (priceData && priceData.usd) {
          const op = phCollection.prepareCreate((record: any) => {
            record.asset.set(asset);
            record.price = priceData.usd;
            record.timestamp = now;
          });
          operations.push(op);
        }
      }
      await db.batch(...operations);
    });
    
    console.log('Dynamic price sync successfully handled via heuristic resolution.');
  } catch (error) {
    console.error('Algorithmic Sync Engine hit a bottleneck:', error);
    throw error;
  }
}

/**
 * Backfills historical data (up to 365 days) for assets that don't have it yet.
 * Call this once when a new asset is added, or via a "Sync History" button.
 */
export async function backfillHistoricalPrices(days: number = 365, byokKey?: string): Promise<void> {
  try {
    const db = getActiveDatabase();
    const assets = await db.get<Asset>('assets').query().fetch();
    if (assets.length === 0) return;

    const phCollection = db.get<PriceHistory>('price_history');

    for (const asset of assets) {
      // Check if we already have a healthy amount of history for this asset to avoid duplicate API spam
      const historyCount = await phCollection.query(Q.where('asset_id', asset.id)).fetchCount();
      if (historyCount > 50) {
        console.log(`Skipping history backfill for ${asset.ticker}, already has ${historyCount} records.`);
        continue; 
      }

      console.log(`Fetching ${days} days of history for ${asset.ticker}...`);
      const apiId = await resolveCoinGeckoId(asset.ticker, asset.name || asset.ticker);
      
      const url = `https://api.coingecko.com/api/v3/coins/${apiId}/market_chart?vs_currency=usd&days=${days}`;
      const headers: HeadersInit = byokKey ? { 'x-cg-pro-api-key': byokKey } : {};

      const response = await fetch(url, { headers });
      const data = await response.json();

      if (data && data.prices && data.prices.length > 0) {
        await db.write(async () => {
          // We will map the array of [timestamp, price] from CoinGecko into DB operations
          const operations = data.prices.map(([ts, price]: [number, number]) => {
            return phCollection.prepareCreate((record: any) => {
              record.asset.set(asset);
              record.price = price;
              record.timestamp = new Date(ts);
            });
          });

          // WatermelonDB batch insert
          await db.batch(...operations);
        });
        console.log(`Successfully backfilled history for ${asset.ticker}`);
      }

      // CoinGecko Free Tier Rate Limit Protection: Wait 1.5 seconds between each coin's history request
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (error) {
    console.error('Historical Sync Engine encountered an error:', error);
    throw error;
  }
}