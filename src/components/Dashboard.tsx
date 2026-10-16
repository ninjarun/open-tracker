import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import { useDatabase } from '@nozbe/watermelondb/hooks';
import { Database, Q } from '@nozbe/watermelondb';
import { CryptoIcon } from '@vnaidin/react-native-cryptocurrency-icons';
import { Asset, Transaction } from '../../database/models';
import { syncPriceData, backfillHistoricalPrices } from '../../database/utils/syncEngine';
import { PortfolioChart } from './PortfolioChart';
import { fetchPricePoints } from '../utils/priceHistory';
import {
  RANGES,
  RangeKey,
  AssetInput,
  SeriesTx,
  buildPortfolioSeries,
  computeAssetStats,
  getSeriesStart,
} from '../utils/portfolioSeries';

const THEMES = {
  light: {
    bg: '#f8f9fa',
    panel: '#ffffff',
    panel2: '#f1f3f5',
    text: '#212529',
    muted: '#6c757d',
    line: 'rgba(0, 0, 0, 0.08)',
    green: '#28a745',
    red: '#dc3545',
    blue: '#A9A9A9',
  },
  dark: {
    bg: '#0f1115',
    panel: '#161920',
    panel2: '#212631',
    text: '#f8f9fa',
    muted: '#98a2b3',
    line: 'rgba(255, 255, 255, 0.08)',
    green: '#2ed573',
    red: '#ff4757',
    blue: '#4b5563',
  },
};

type NavigationLike = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

interface DashboardProps {
  isDarkMode: boolean;
  navigation?: NavigationLike;
}

type AllocationRow = {
  id: string;
  ticker: string;
  name: string;
  type: string;
  holdings: number;
  price: number;
  value: number;
  profit: number;
  percent: number;
};

type DashboardData = {
  rows: AllocationRow[];
  totalValue: number;
  pnl: number;
  pnlPercent: number;
  series: number[];
};

const EMPTY_DATA: DashboardData = { rows: [], totalValue: 0, pnl: 0, pnlPercent: 0, series: [] };

function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price === 0) return '0.00';
  if (Math.abs(price) >= 1) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return price.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

/**
 * Reads transactions + saved prices and produces everything the screen shows.
 */
async function loadDashboardData(
  database: Database,
  portfolio: string,
  range: RangeKey
): Promise<DashboardData> {
  const txCollection = database.get<Transaction>('transactions');
  const txModels =
    portfolio === 'ALL'
      ? await txCollection.query().fetch()
      : await txCollection.query(Q.where('portfolio', portfolio)).fetch();

  const txByAsset = new Map<string, SeriesTx[]>();
  let firstTxTime: number | null = null;

  for (const tx of txModels) {
    const date = (tx.date ?? new Date()).getTime();
    if (firstTxTime === null || date < firstTxTime) firstTxTime = date;

    const list = txByAsset.get(tx.asset.id) || [];
    list.push({
      type: tx.type,
      amount: Number(tx.amount || 0),
      price: Number(tx.price || 0),
      fee: Number(tx.fee || 0),
      date,
    });
    txByAsset.set(tx.asset.id, list);
  }

  if (txByAsset.size === 0) return EMPTY_DATA;

  const now = Date.now();
  const seriesStart = getSeriesStart(range, now, firstTxTime);
  // For "ALL" the P&L covers your whole history even if the chart only shows the last year.
  const statsStart = range === 'ALL' && firstTxTime !== null ? firstTxTime : seriesStart;

  const assets = await database.get<Asset>('assets').query().fetch();
  const assetById = new Map(assets.map(a => [a.id, a]));

  const inputs: AssetInput[] = [];
  const rows: AllocationRow[] = [];
  let totalValue = 0;
  let totalPnl = 0;
  let totalBase = 0;

  for (const [assetId, txs] of txByAsset.entries()) {
    const asset = assetById.get(assetId);
    if (!asset) continue;

    const prices = await fetchPricePoints(database, assetId, seriesStart);
    const input: AssetInput = { txs, prices };
    inputs.push(input);

    const stats = computeAssetStats(input, statsStart, now);
    if (stats.hasPrices) {
      totalValue += stats.valueEnd;
      totalPnl += stats.pnl;
      totalBase += stats.base;
    }

    if (stats.holdingsNow > 0) {
      rows.push({
        id: asset.id,
        ticker: asset.ticker,
        name: asset.name,
        type: asset.type,
        holdings: stats.holdingsNow,
        price: stats.priceNow,
        value: stats.valueEnd,
        profit: stats.pnl,
        percent: stats.base > 0 ? (stats.pnl / stats.base) * 100 : 0,
      });
    }
  }

  const { values } = buildPortfolioSeries(inputs, seriesStart, now);

  return {
    rows,
    totalValue,
    pnl: totalPnl,
    pnlPercent: totalBase > 0 ? (totalPnl / totalBase) * 100 : 0,
    series: values,
  };
}

export const Dashboard = ({ isDarkMode, navigation }: DashboardProps) => {
  const database = useDatabase();
  const currentTheme = isDarkMode ? THEMES.dark : THEMES.light;

  const [refreshing, setRefreshing] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyIssue, setHistoryIssue] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<RangeKey>('ALL');
  const [portfolios, setPortfolios] = useState<string[]>(['ALL']);
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>('ALL');
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);

  // Downloads any missing price history and reports coins that could not be completed.
  const runHistoryBackfill = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const result = await backfillHistoricalPrices();
      setHistoryIssue(
        result.failedTickers.length > 0
          ? `Price history incomplete for ${result.failedTickers.join(', ')} (the price service is busy). Pull down to retry.`
          : null
      );
    } catch (err) {
      console.warn('History backfill failed:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Pull-to-refresh: fetch fresh prices (the screen updates by itself when the DB changes).
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncPriceData();
    } catch (error) {
      console.error('Pull-to-refresh price sync failed:', error);
    } finally {
      setRefreshing(false);
    }
    // Gap-fill / retry history in the background; do not keep the spinner up for it.
    runHistoryBackfill();
  }, [runHistoryBackfill]);

  // Download any missing price history in the background when the screen opens.
  useEffect(() => {
    runHistoryBackfill();
  }, [runHistoryBackfill]);

  // Auto price sync every 5 minutes.
  useEffect(() => {
    const intervalId = setInterval(() => {
      syncPriceData().catch(err => console.error('Auto-sync failed:', err));
    }, 5 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const sub = database
      .get<Transaction>('transactions')
      .query()
      .observe()
      .subscribe(txs => {
        const unique = Array.from(new Set(txs.map(t => t.portfolio).filter(Boolean)));
        setPortfolios(['ALL', ...unique]);
      });
    return () => sub.unsubscribe();
  }, [database]);

  // Recompute whenever the selection changes OR any relevant table changes
  // (new prices from a sync / backfill, new transactions, new assets).
  useEffect(() => {
    let disposed = false;
    let runId = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const recompute = () => {
      const myRun = ++runId;
      loadDashboardData(database, selectedPortfolio, timeRange)
        .then(result => {
          // ignore results from a stale run
          if (!disposed && myRun === runId) setData(result);
        })
        .catch(err => console.error('Dashboard load failed:', err));
    };

    const sub = database
      .withChangesForTables(['assets', 'transactions', 'price_history'])
      .subscribe(() => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(recompute, 400); // batch bursts of writes together
      });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      sub.unsubscribe();
    };
  }, [database, selectedPortfolio, timeRange]);

  const { rows, totalValue, pnl, pnlPercent, series } = data;
  const pnlColor = pnl >= 0 ? currentTheme.green : currentTheme.red;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={isDarkMode ? '#ffffff' : '#212529'}
            colors={[isDarkMode ? '#2ed573' : '#28a745']}
          />
        }
      >
        {/* PORTFOLIO SELECTOR */}
        <View style={styles.header}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {portfolios.map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => setSelectedPortfolio(p)}
                style={[
                  styles.tab,
                  { backgroundColor: currentTheme.panel2 },
                  selectedPortfolio === p && { backgroundColor: currentTheme.blue },
                ]}
              >
                <Text style={[styles.tabText, { color: currentTheme.text }]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* STATS */}
        <View style={styles.centerContainer}>
          <View style={{ flexDirection: 'column', alignItems: 'baseline', marginBottom: 10 }}>
            <Text style={[styles.netWorthLabel, { color: currentTheme.muted }]}>Current Balance</Text>
            <Text style={[styles.mainValue, { color: currentTheme.text }]}>
              ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: pnlColor }]}>
                {pnl >= 0 ? '+' : '-'}$
                {Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: pnlColor }]}>
                {pnlPercent >= 0 ? '+' : ''}
                {pnlPercent.toFixed(2)}%
              </Text>
            </View>
          </View>
        </View>

        {/* CHART */}
        <View style={styles.chartSection}>
          {series.length >= 2 ? (
            <PortfolioChart data={series} color={pnlColor} labelColor={currentTheme.muted} />
          ) : (
            <View style={styles.chartPlaceholder}>
              <Text style={{ color: currentTheme.muted, fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                {historyLoading
                  ? 'Downloading price history...'
                  : 'Not enough price history for this range yet.'}
              </Text>
            </View>
          )}
          {historyLoading && series.length >= 2 && (
            <Text style={[styles.historyNote, { color: currentTheme.muted }]}>Updating price history...</Text>
          )}
          {!historyLoading && historyIssue && (
            <Text style={[styles.historyNote, { color: currentTheme.red }]}>{historyIssue}</Text>
          )}
        </View>

        {/* TIMEFRAME BAR */}
        <View style={styles.rangeBar}>
          {RANGES.map(range => (
            <TouchableOpacity
              key={range}
              onPress={() => setTimeRange(range)}
              style={[
                styles.rangeBtn,
                { backgroundColor: currentTheme.panel2, paddingHorizontal: 10 },
                timeRange === range && { backgroundColor: currentTheme.blue },
              ]}
            >
              <Text
                style={[
                  styles.rangeText,
                  { color: currentTheme.text, fontSize: 11 },
                  timeRange === range && { color: '#ffffff' },
                ]}
              >
                {range}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ASSET TABLE */}
        <View style={[styles.panelCard, { backgroundColor: currentTheme.panel, borderColor: currentTheme.line }]}>
          {rows.length === 0 ? (
            <Text style={{ color: currentTheme.muted, paddingVertical: 20, textAlign: 'center' }}>
              No assets found in this portfolio.
            </Text>
          ) : (
            rows.map(item => (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.72}
                onPress={() =>
                  navigation?.navigate('AssetDetail', { assetId: item.id, marketType: item.type || 'crypto' })
                }
                style={[styles.tableRow, { borderBottomColor: currentTheme.line }]}
              >
                <View style={styles.colLeft}>
                  {item.type === 'stock' ? (
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        overflow: 'hidden',
                        backgroundColor: currentTheme.panel2,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 10, fontWeight: 'bold', color: currentTheme.text }}>
                        {item.ticker.slice(0, 2)}
                      </Text>
                    </View>
                  ) : (
                    <CryptoIcon symbol={item.ticker.toLowerCase()} size={32} />
                  )}

                  <View style={styles.tickerTextContainer}>
                    <Text style={[styles.tdTicker, { color: currentTheme.text }]}>{item.ticker}</Text>
                    <Text style={[styles.tdSecondary, { color: currentTheme.muted }]}>
                      {item.holdings.toLocaleString('en-US', { maximumFractionDigits: 4 })} | ${formatPrice(item.price)}
                    </Text>
                  </View>
                </View>

                <View style={styles.colRight}>
                  <Text style={[styles.tdValue, { color: currentTheme.text }]}>
                    ${item.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </Text>
                  <Text
                    style={[styles.tdProfit, { color: item.profit >= 0 ? currentTheme.green : currentTheme.red }]}
                  >
                    {item.profit >= 0 ? '+$' : '-$'}
                    {Math.abs(item.profit).toLocaleString(undefined, { maximumFractionDigits: 0 })} |{' '}
                    {item.percent >= 0 ? '+' : ''}
                    {item.percent.toFixed(1)}%
                  </Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  tab: { paddingVertical: 8, paddingHorizontal: 16, marginRight: 10, borderRadius: 20 },
  tabText: { fontWeight: 'bold', fontSize: 13 },
  centerContainer: { alignItems: 'flex-start', marginVertical: 15 },
  netWorthLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  mainValue: { fontSize: 42, fontWeight: '800' },
  statsRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  statItem: { marginRight: 20 },
  statValue: { fontSize: 18, fontWeight: '600' },
  chartSection: { marginVertical: 20 },
  chartPlaceholder: { height: 170, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  historyNote: { fontSize: 11, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  rangeBar: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  rangeBtn: { paddingVertical: 8, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flex: 1, marginHorizontal: 2 },
  rangeText: { fontWeight: '600' },
  panelCard: { borderRadius: 20, padding: 20, borderWidth: 1 },
  tableRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  tdTicker: { fontSize: 16, fontWeight: 'bold' },
  tdValue: { fontSize: 16, fontWeight: 'bold' },
  tdSecondary: { fontSize: 12, marginTop: 2 },
  tdProfit: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  colLeft: { flex: 1.4, flexDirection: 'row', alignItems: 'center' },
  colRight: { alignItems: 'flex-end', flex: 1 },
  tickerTextContainer: { marginLeft: 12, flexDirection: 'column' },
});
