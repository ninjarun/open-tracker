// src/utils/priceHistory.ts
import { Database, Q, Query } from '@nozbe/watermelondb';
import { PriceHistory } from '../../database/models';
import { PricePoint } from './portfolioSeries';

function isValid(point: PricePoint): boolean {
  return Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0;
}

/**
 * Reads price points from a query. Uses WatermelonDB's raw fetch when
 * available (much faster for thousands of rows than building Model objects).
 */
async function readPoints(query: Query<PriceHistory>): Promise<PricePoint[]> {
  const anyQuery = query as any;

  if (typeof anyQuery.unsafeFetchRaw === 'function') {
    const rows: any[] = await anyQuery.unsafeFetchRaw();
    return rows
      .map(row => ({ t: Number(row.timestamp), p: Number(row.price) }))
      .filter(isValid);
  }

  const models = await query.fetch();
  return models
    .map(model => ({ t: model.timestamp.getTime(), p: Number(model.price) }))
    .filter(isValid);
}

/**
 * All saved prices for an asset from `start` onward (ascending), plus the one
 * most recent price BEFORE `start` so the line has a correct starting value.
 */
export async function fetchPricePoints(
  database: Database,
  assetId: string,
  start: number
): Promise<PricePoint[]> {
  const collection = database.get<PriceHistory>('price_history');

  const inRange = collection.query(
    Q.where('asset_id', assetId),
    Q.where('timestamp', Q.gte(start)),
    Q.sortBy('timestamp', Q.asc)
  );
  const before = collection.query(
    Q.where('asset_id', assetId),
    Q.where('timestamp', Q.lt(start)),
    Q.sortBy('timestamp', Q.desc),
    Q.take(1)
  );

  const [seed, rest] = await Promise.all([readPoints(before), readPoints(inRange)]);
  return [...seed, ...rest];
}
