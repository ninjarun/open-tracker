// database/utils/calculations.ts
import { Q } from '@nozbe/watermelondb';
import { database } from '../index';
import { Transaction } from '../models';

/**
 * Ensures the database is instantiated before making queries
 */
function getActiveDatabase() {
  if (!database) {
    throw new Error("Database has not been initialized yet.");
  }
  return database;
}

/**
 * Calculates total rolling tokens/shares currently held for a specific asset.
 */
export async function calculateCurrentHoldings(assetId: string): Promise<number> {
  const db = getActiveDatabase();
  const transactions = await db
    .get<Transaction>('transactions')
    .query(Q.where('asset_id', assetId))
    .fetch();

  let totalHoldings = 0;

  for (const tx of transactions) {
    if (tx.type === 'BUY') {
      totalHoldings += tx.amount;
    } else if (tx.type === 'SELL') {
      totalHoldings -= tx.amount;
    }
  }

  return totalHoldings;
}

/**
 * Calculates the net Average Cost Basis (DCA) using a rolling accounting method.
 * Sells reduce the position size but preserve the existing average cost basis.
 */
export async function calculateAverageCost(assetId: string): Promise<number> {
  const db = getActiveDatabase();
  const transactions = await db
    .get<Transaction>('transactions')
    .query(Q.where('asset_id', assetId), Q.sortBy('date', Q.asc))
    .fetch();

  let remainingTokens = 0;
  let totalCostBasis = 0;

  for (const tx of transactions) {
    if (tx.type === 'BUY') {
      const txCost = tx.amount * tx.price + tx.fee;
      totalCostBasis += txCost;
      remainingTokens += tx.amount;
    } else if (tx.type === 'SELL') {
      if (remainingTokens > 0) {
        const currentAvgPrice = totalCostBasis / remainingTokens;
        remainingTokens -= tx.amount;
        totalCostBasis = remainingTokens * currentAvgPrice;
      }
    }
  }

  return remainingTokens > 0 ? totalCostBasis / remainingTokens : 0;
}