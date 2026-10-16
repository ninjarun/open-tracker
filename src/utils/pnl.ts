export type TransactionInput = {
  type: string;
  amount: number;
  price: number;
  fee?: number;
  date: Date;
};

export type PnLSummary = {
  holdings: number;
  costBasis: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  avgCost: number;
  marketValue: number;
};

/**
 * Client-side average-cost PnL calculator.
 *
 * BUY:
 * - increases holdings
 * - increases remaining cost basis by amount * price + fee
 *
 * SELL:
 * - realizes PnL against current average cost basis
 * - reduces holdings and remaining cost basis
 * - subtracts fee from sale proceeds
 *
 * TRANSFER and unknown types are ignored for PnL because the current schema
 * does not include transfer cost-basis metadata.
 */
export function calculatePnL(
  transactions: TransactionInput[],
  currentPrice: number
): PnLSummary {
  const sorted = [...transactions].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  let holdings = 0;
  let costBasis = 0;
  let realizedPnL = 0;

  for (const tx of sorted) {
    const type = String(tx.type || '').toUpperCase();
    const amount = Number(tx.amount || 0);
    const price = Number(tx.price || 0);
    const fee = Number(tx.fee || 0);

    if (amount <= 0) continue;

    if (type === 'BUY') {
      holdings += amount;
      costBasis += amount * price + fee;
      continue;
    }

    if (type === 'SELL') {
      if (holdings <= 0) continue;

      const sellAmount = Math.min(amount, holdings);
      const avgCost = costBasis / holdings;
      const soldCostBasis = avgCost * sellAmount;
      const proceeds = sellAmount * price - fee;

      realizedPnL += proceeds - soldCostBasis;
      holdings -= sellAmount;
      costBasis -= soldCostBasis;

      if (holdings <= 0.00000001) {
        holdings = 0;
        costBasis = 0;
      }
    }
  }

  const safeCurrentPrice = Number(currentPrice || 0);
  const marketValue = holdings * safeCurrentPrice;
  const unrealizedPnL = marketValue - costBasis;

  return {
    holdings,
    costBasis,
    realizedPnL,
    unrealizedPnL,
    totalPnL: realizedPnL + unrealizedPnL,
    avgCost: holdings > 0 ? costBasis / holdings : 0,
    marketValue,
  };
}
