import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View, Dimensions } from 'react-native';
import { useDatabase } from '@nozbe/watermelondb/hooks';
import { Q } from '@nozbe/watermelondb';
import { LineChart } from 'react-native-chart-kit';
import { Asset, PriceHistory, Transaction } from '../../database/models';
import { fetchGlobalPrice, MarketType } from '../utils/priceAlerts';

type Theme = {
  bg: string;
  panel: string;
  panel2: string;
  text: string;
  muted: string;
  line: string;
  green: string;
  red: string;
  blue: string;
};

type AssetDetailRoute = {
  params?: {
    assetId?: string;
    marketType?: MarketType | string;
  };
};

type NavigationLike = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack?: () => void;
};

type Props = {
  route: AssetDetailRoute;
  navigation: NavigationLike;
  isDarkMode: boolean;
};

type Timeframe = '24h' | '7d' | '30d' | '1y';

type AssetProfile = {
  id: string;
  ticker: string;
  name: string;
  type: MarketType;
};

type Metrics = {
  balance: number;
  averageBuyPrice: number;
  totalInvestmentCost: number;
  currentPrice: number;
  livePnl: number;
  totalMarketValue: number; 
  owned: boolean;
};

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

const { width } = Dimensions.get('window');
const DAY_MS = 86400000;

function normalizeMarketType(type?: string): MarketType {
  return type === 'stock' ? 'stock' : 'crypto';
}

function timeframeStart(timeframe: Timeframe): number {
  const now = Date.now();
  if (timeframe === '24h') return now - DAY_MS;
  if (timeframe === '7d') return now - DAY_MS * 7;
  if (timeframe === '30d') return now - DAY_MS * 30;
  return now - DAY_MS * 365;
}

function timeframeExternalRange(timeframe: Timeframe): { range: string; interval: string; days: string } {
  if (timeframe === '24h') return { range: '1d', interval: '30m', days: '1' };
  if (timeframe === '7d') return { range: '7d', interval: '1h', days: '7' };
  if (timeframe === '30d') return { range: '1mo', interval: '1d', days: '30' };
  return { range: '1y', interval: '1wk', days: '365' };
}

function compactChartData(values: number[], maxPoints: number = 60): number[] {
  const cleaned = values.filter(value => Number.isFinite(value) && value > 0);
  if (cleaned.length === 0) return [];
  if (cleaned.length === 1) return [cleaned[0], cleaned[0]];
  if (cleaned.length <= maxPoints) return cleaned;

  const step = cleaned.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, index) => cleaned[Math.floor(index * step)]);
}

async function fetchExternalHistory(profile: AssetProfile, timeframe: Timeframe): Promise<number[]> {
  const { range, interval, days } = timeframeExternalRange(timeframe);

  if (profile.type === 'stock') {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(profile.ticker)}?range=${range}&interval=${interval}`);
    const data = await response.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    return compactChartData(closes.filter((price: unknown) => typeof price === 'number'));
  }

  const response = await fetch(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(profile.id)}/market_chart?vs_currency=usd&days=${days}`);
  const data = await response.json();
  const prices = Array.isArray(data?.prices) ? data.prices.map((point: [number, number]) => point[1]) : [];
  return compactChartData(prices);
}

async function findAssetProfile(database: ReturnType<typeof useDatabase>, assetId: string, marketType: MarketType): Promise<{ profile: AssetProfile; asset: Asset | null }> {
  let asset: Asset | null = null;

  try {
    // Primary fallback: Attempt standard internal ID lookup
    asset = await database.get<Asset>('assets').find(assetId.trim());
  } catch {
    // Secondary fallback: If passed an accidental ticker instead of ID, catch and fetch by ticker
    try {
      const assetsByTicker = await database.get<Asset>('assets')
        .query(Q.where('ticker', assetId.trim().toUpperCase()))
        .fetch();
      if (assetsByTicker.length > 0) {
        asset = assetsByTicker[0];
      }
    } catch (e) {
      // Ignore inner lookup fail
    }
  }

  if (asset) {
    return {
      asset,
      profile: {
        id: asset.id,
        ticker: asset.ticker,
        name: asset.name,
        type: normalizeMarketType(asset.type),
      },
    };
  }

  // Tertiary fallback: Missing entirely
  const fallbackTicker = assetId.toUpperCase();
  return {
    asset: null,
    profile: {
      id: assetId,
      ticker: fallbackTicker,
      name: fallbackTicker,
      type: marketType,
    },
  };
}

export function AssetDetail({ route, navigation, isDarkMode }: Props) {
  const database = useDatabase();
  const theme = isDarkMode ? THEMES.dark : THEMES.light;
  const assetId = route.params?.assetId || '';
  const marketType = normalizeMarketType(route.params?.marketType);

  const [profile, setProfile] = useState<AssetProfile>({ id: assetId, ticker: assetId.toUpperCase(), name: assetId.toUpperCase(), type: marketType });
  const [metrics, setMetrics] = useState<Metrics>({ balance: 0, averageBuyPrice: 0, totalInvestmentCost: 0, currentPrice: 0, livePnl: 0, owned: false ,totalMarketValue:0});
  const [timeframe, setTimeframe] = useState<Timeframe>('7d');
  const [chartData, setChartData] = useState<number[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let alive = true;

    async function loadProfileAndMetrics() {
      if (!assetId) return;
      setLoading(true);

      const { profile: resolvedProfile, asset } = await findAssetProfile(database, assetId, marketType);
      
      const txs = asset
        ? await database.get<Transaction>('transactions').query(Q.where('asset_id', asset.id)).fetch()
        : [];

      // Sort newest to oldest safely
      const sortedTxs = [...txs].sort((a, b) => {
        const aAny = a as any;
        const bAny = b as any;
        const dateA = aAny.date || aAny.timestamp || aAny.createdAt || 0;
        const dateB = bAny.date || bAny.timestamp || bAny.createdAt || 0;
        return new Date(dateB).valueOf() - new Date(dateA).valueOf();
      });

      const balance = txs.reduce((sum, tx) => sum + (tx.type === 'BUY' ? Number(tx.amount || 0) : -Number(tx.amount || 0)), 0);
      const buyAmount = txs.reduce((sum, tx) => sum + (tx.type === 'BUY' ? Number(tx.amount || 0) : 0), 0);
      const totalInvestmentCost = txs.reduce((sum, tx) => sum + (tx.type === 'BUY' ? (Number(tx.amount || 0) * Number(tx.price || 0)) + Number(tx.fee || 0) : 0), 0);
      const averageBuyPrice = buyAmount > 0 ? totalInvestmentCost / buyAmount : 0;

      // --- THE FIX: Look at the local database exactly like Dashboard.tsx does ---
      let currentPrice = 0;
      if (asset) {
        const latestPriceHistory = await database.get<PriceHistory>('price_history')
          .query(Q.where('asset_id', asset.id), Q.sortBy('timestamp', Q.desc), Q.take(1))
          .fetch();
        currentPrice = latestPriceHistory.length > 0 ? latestPriceHistory[0].price : 0;
      }

      // Fallback to the internet ONLY if the local database is completely empty
      if (currentPrice === 0) {
        try {
          currentPrice = await fetchGlobalPrice(resolvedProfile, resolvedProfile.type) || 0;
        } catch (err) {
          currentPrice = 0; // Prevent crash if API fails
        }
      }
      // -------------------------------------------------------------------------

      const totalMarketValue = balance * currentPrice; 
      const livePnl = balance > 0 ? totalMarketValue - totalInvestmentCost : 0;

      if (!alive) return;
      
      setProfile(resolvedProfile);
      setTransactions(sortedTxs);
      setMetrics({
        balance,
        averageBuyPrice,
        totalInvestmentCost,
        currentPrice,
        totalMarketValue,
        livePnl,
        owned: balance > 0,
      });
      setLoading(false);
    }

    loadProfileAndMetrics();
    return () => {
      alive = false;
    };
  }, [assetId, database, marketType]);

  useEffect(() => {
    let alive = true;

    async function loadChart() {
      if (!assetId) return;
      const start = timeframeStart(timeframe);
      const localRows = await database.get<PriceHistory>('price_history')
        .query(Q.where('asset_id', assetId), Q.where('timestamp', Q.gte(start)), Q.sortBy('timestamp', Q.asc))
        .fetch();

      let data = compactChartData(localRows.map(row => row.price));
      if (data.length < 2) {
        try {
          data = await fetchExternalHistory(profile, timeframe);
        } catch (error) {
          console.error('Failed to load external asset history:', error);
        }
      }

      if (!alive) return;
      setChartData(data);
    }

    loadChart();
    return () => {
      alive = false;
    };
  }, [assetId, database, profile, timeframe]);

  const chartPositive = useMemo(() => {
    if (chartData.length < 2) return true;
    return chartData[chartData.length - 1] >= chartData[0];
  }, [chartData]);

  const pnlPositive = metrics.livePnl >= 0;
  const chartColor = chartPositive ? theme.green : theme.red;

  function navigateToAlertDispatcher() {
    navigation.navigate('PriceAlertDispatcher', {
      prefilledAsset: profile,
    });
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <TouchableOpacity onPress={() => navigation.goBack ? navigation.goBack() : navigation.navigate('Markets')} style={[styles.backButton, { backgroundColor: theme.panel2 }]}>
          <Text style={[styles.backText, { color: theme.text }]}>← Back</Text>
        </TouchableOpacity>

        {/* --- FIXED: Only one set of Titles and Prices --- */}
        <Text style={[styles.ticker, { color: theme.text }]}>{profile.ticker}</Text>
        <Text style={[styles.name, { color: theme.muted }]}>{profile.name} · {profile.type.toUpperCase()}</Text>

        <Text style={[styles.price, { color: theme.text }]}>
          ${metrics.totalMarketValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Text>

        <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 18, color: theme.muted }}>
          Current Price: ${metrics.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </Text>

        {!metrics.owned && !loading ? (
          <View style={[styles.watchBanner, { backgroundColor: theme.panel2, borderColor: theme.line }]}>
            <Text style={[styles.watchTitle, { color: theme.text }]}>Watchlist Asset - No Portfolio Holdings</Text>
            <Text style={[styles.watchText, { color: theme.muted }]}>You can monitor pricing and create alerts, but portfolio PnL will appear after you add transactions for this asset.</Text>
          </View>
        ) : (
          <View style={styles.metricsGrid}>
            <MetricCard label="Balance" value={metrics.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} theme={theme} />
            <MetricCard label="Average Buy" value={`$${metrics.averageBuyPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}`} theme={theme} />
            <MetricCard label="Investment Cost" value={`$${metrics.totalInvestmentCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} theme={theme} />
            <MetricCard label="Live PnL" value={`${pnlPositive ? '+' : '-'}$${Math.abs(metrics.livePnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} valueColor={pnlPositive ? theme.green : theme.red} theme={theme} />
          </View>
        )}

        <View style={[styles.chartCard, { backgroundColor: theme.panel, borderColor: theme.line }]}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Price History</Text>
          {chartData.length >= 2 ? (
            <LineChart
              data={{ labels: [], datasets: [{ data: chartData }] }}
              width={width - 88}
              height={190}
              withDots={false}
              withInnerLines={false}
              withOuterLines={false}
              withHorizontalLabels={false}
              withVerticalLabels={false}
              chartConfig={{
                backgroundColor: theme.panel,
                backgroundGradientFrom: theme.panel,
                backgroundGradientTo: theme.panel,
                color: (opacity = 1) => chartColor === theme.green
                  ? `rgba(${isDarkMode ? '46, 213, 115' : '40, 167, 69'}, ${opacity})`
                  : `rgba(${isDarkMode ? '255, 71, 87' : '220, 53, 69'}, ${opacity})`,
                strokeWidth: 2,
              }}
              bezier
              style={styles.chart}
            />
          ) : (
            <Text style={[styles.empty, { color: theme.muted }]}>No chart history available yet.</Text>
          )}

          <View style={styles.timeframeBar}>
            {(['24h', '7d', '30d', '1y'] as Timeframe[]).map(option => (
              <TouchableOpacity
                key={option}
                onPress={() => setTimeframe(option)}
                style={[styles.timeframeButton, { backgroundColor: theme.panel2 }, timeframe === option && { backgroundColor: theme.blue }]}
              >
                <Text style={[styles.timeframeText, { color: timeframe === option ? '#fff' : theme.text }]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* --- FIXED: Restored the missing Card Wrapper and Title for the Transaction map --- */}
        {transactions.length > 0 && (
          <View style={[styles.txCard, { backgroundColor: theme.panel, borderColor: theme.line }]}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Transaction History</Text>
            
            {transactions.map((tx, idx) => {
              const data = tx as any;
              const txDate = data.date || data.timestamp || data.createdAt || data.created_at;
              const dateString = txDate ? new Date(txDate).toLocaleDateString() : 'Unknown Date';

              return (
                <View key={tx.id || idx} style={[styles.txRow, { borderBottomColor: theme.line, borderBottomWidth: idx === transactions.length - 1 ? 0 : 1 }]}>
                  <View style={styles.txLeft}>
                    <Text style={[styles.txType, { color: data.type === 'BUY' ? theme.green : theme.red }]}>{data.type || 'TRADE'}</Text>
                    <Text style={[styles.txDate, { color: theme.muted }]}>{dateString}</Text>
                  </View>
                  <View style={styles.txRight}>
                    <Text style={[styles.txAmount, { color: theme.text }]}>
                      {Number(data.amount || 0).toLocaleString(undefined, { maximumFractionDigits: 6 })} {profile.ticker}
                    </Text>
                    <Text style={[styles.txPrice, { color: theme.muted }]}>
                      @ ${Number(data.price || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <TouchableOpacity style={[styles.alertButton, { backgroundColor: theme.blue }]} onPress={navigateToAlertDispatcher}>
          <Text style={styles.alertButtonText}>⏰ Set Price Alert for {profile.ticker}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({ label, value, valueColor, theme }: { label: string; value: string; valueColor?: string; theme: Theme }) {
  return (
    <View style={[styles.metricCard, { backgroundColor: theme.panel, borderColor: theme.line }]}>
      <Text style={[styles.metricLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: valueColor || theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 32 },
  backButton: { alignSelf: 'flex-start', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 18 },
  backText: { fontSize: 13, fontWeight: '900' },
  ticker: { fontSize: 38, fontWeight: '900' },
  name: { fontSize: 13, fontWeight: '700', marginTop: 4, textTransform: 'uppercase' },
  price: { fontSize: 28, fontWeight: '900', marginTop: 12, marginBottom: 18 },
  watchBanner: { borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 18 },
  watchTitle: { fontSize: 15, fontWeight: '900', marginBottom: 6 },
  watchText: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 18 },
  metricCard: { width: '48%', borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 10 },
  metricLabel: { fontSize: 10, fontWeight: '900', textTransform: 'uppercase', marginBottom: 6 },
  metricValue: { fontSize: 16, fontWeight: '900' },
  chartCard: { borderWidth: 1, borderRadius: 20, padding: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '900', marginBottom: 12 },
  chart: { marginVertical: 0, paddingRight: 0, paddingLeft: 0 },
  empty: { fontSize: 13, fontWeight: '600', paddingVertical: 40, textAlign: 'center' },
  timeframeBar: { flexDirection: 'row', marginTop: 14 },
  timeframeButton: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', marginHorizontal: 3 },
  timeframeText: { fontSize: 12, fontWeight: '900' },
  txCard: { borderWidth: 1, borderRadius: 20, padding: 20, marginBottom: 16 },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1 },
  txLeft: { flexDirection: 'column' },
  txRight: { flexDirection: 'column', alignItems: 'flex-end' },
  txType: { fontSize: 14, fontWeight: '900' },
  txDate: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  txAmount: { fontSize: 14, fontWeight: '900' },
  txPrice: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  alertButton: { borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  alertButtonText: { color: '#fff', fontSize: 15, fontWeight: '900' },
});