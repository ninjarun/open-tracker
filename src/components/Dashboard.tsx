import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, Dimensions,RefreshControl } from 'react-native';
import { useDatabase } from '@nozbe/watermelondb/hooks';
import { Q } from '@nozbe/watermelondb';
import { LineChart } from 'react-native-chart-kit';
import Svg, { Line } from 'react-native-svg';
import { CryptoIcon } from '@vnaidin/react-native-cryptocurrency-icons';
import { Asset, Transaction, PriceHistory } from '../../database/models';
import { syncPriceData } from '../../database/utils/syncEngine';

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
  }
};

const { width } = Dimensions.get('window');

type NavigationLike = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

interface DashboardProps {
  isDarkMode: boolean;
  navigation?: NavigationLike;
}

export const Dashboard = ({ isDarkMode, navigation }: DashboardProps) => {
  const database = useDatabase();
    const [refreshing, setRefreshing] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0); // <--- ADD THIS
  const [timeRange, setTimeRange] = useState('ALL');
  const [allocations, setAllocations] = useState<any[]>([]);
  const [portfolios, setPortfolios] = useState<string[]>(['ALL']);
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>('ALL');

  const currentTheme = isDarkMode ? THEMES.dark : THEMES.light;

  const [totalValue, setTotalValue] = useState<number>(0);
  const [totalInvested, setTotalInvested] = useState<number>(0);
  const [totalBaseValue, setTotalBaseValue] = useState<number>(0);

  const [chartData, setChartData] = useState<number[]>([]);
  const [chartHigh, setChartHigh] = useState<number>(0);
  const [chartLow, setChartLow] = useState<number>(0);

// const onRefresh = React.useCallback(async () => {
//     setRefreshing(true);
//     try {
//       // Execute the exact same engine synchronization method from settings
//       await syncPriceData();
      
//       // Optional: If you have an internal function reloading dashboard metrics 
//       // from the DB (e.g. loadDashboardMetrics()), invoke it here to reflect changes instantly.
//     } catch (error) {
//       console.error("Pull-to-refresh price sync failed:", error);
//     } finally {
//       setRefreshing(false);
//     }
//   }, []);
const onRefresh = React.useCallback(async () => {
  
  setRefreshing(true);
  try {
    // 1. Sync backend data into WatermelonDB
    await syncPriceData();
    
    // 2. Increment the trigger to force the useEffect to re-calculate everything!
    setRefreshTrigger(prev => prev + 1);
  } catch (error) {
    console.error("Pull-to-refresh price sync failed:", error);
  } finally {
    setRefreshing(false);
  }
}, []);
useEffect(() => {
    // Set up the 5-minute interval (300,000 milliseconds)
    const intervalId = setInterval(async () => {
      try {
        console.log("Running 5-minute auto-sync...");
        // 1. Download the new prices
        await syncPriceData();
        // 2. Nudge the trigger so the screen actually updates!
        setRefreshTrigger(prev => prev + 1); 
      } catch (err) {
        console.error("Auto-sync failed:", err);
      }
    },  5 * 60 *1000);

    // Clean up the timer if the user navigates away
    return () => clearInterval(intervalId);
  }, []);
  useEffect(() => {
    const sub = database.get<Transaction>('transactions').query().observe().subscribe(txs => {
      const unique = Array.from(new Set(txs.map(t => t.portfolio).filter(Boolean)));
      setPortfolios(['ALL', ...unique]);
    });
    return () => sub.unsubscribe();
  }, [database]);

  const getTimestampForRange = (range: string) => {
    const now = Date.now();
    const day = 86400000;
    if (range === '1HR') return now - 3600000;
    if (range === '1D') return now - day;
    if (range === '1W') return now - day * 7;
    if (range === '1M') return now - day * 30;
    if (range === 'YTD') {
      const currentYear = new Date().getFullYear();
      return new Date(currentYear, 0, 1).getTime();
    }
    if (range === '1YR') return now - day * 365;
    return now - (day * 365 * 3);
  };

  useEffect(() => {
    const query = database.get<Asset>('assets').query();
    const subscription = query.observe().subscribe(async (assets) => {
      let runningTotalValue = 0;
      let runningTotalInvested = 0;
      let runningTotalBaseValue = 0;

      const now = Date.now();
      const chartStartTimestamp = getTimestampForRange(timeRange);
      const STEPS = 40;
      const stepSize = (now - chartStartTimestamp) / STEPS;
      const timeline = Array.from({ length: STEPS + 1 }, (_, i) => chartStartTimestamp + (i * stepSize));
      let aggregateChart = new Array(STEPS + 1).fill(0);

      const processed = await Promise.all(assets.map(async (a) => {
        const txQuery = selectedPortfolio === 'ALL'
          ? database.get<Transaction>('transactions').query(Q.where('asset_id', a.id))
          : database.get<Transaction>('transactions').query(Q.where('asset_id', a.id), Q.where('portfolio', selectedPortfolio));

        const txs = await txQuery.fetch();
        const holdings = txs.reduce((acc, tx) => (tx.type === 'BUY' ? acc + tx.amount : acc - tx.amount), 0);
        const invested = txs.reduce((acc, tx) => (tx.type === 'BUY' ? acc + (tx.amount * tx.price) : acc), 0);

        const historyQuery = await database.get<PriceHistory>('price_history')
          .query(Q.where('asset_id', a.id), Q.where('timestamp', Q.gte(chartStartTimestamp)), Q.sortBy('timestamp', Q.asc))
          .fetch();

        const latestPriceHistory = await database.get<PriceHistory>('price_history')
          .query(Q.where('asset_id', a.id), Q.sortBy('timestamp', Q.desc), Q.take(1))
          .fetch();

        const price = latestPriceHistory.length > 0 ? latestPriceHistory[0].price : 0;
        const avgBuyPrice = holdings > 0 ? invested / holdings : price;

        let basePrice = price;
        if (timeRange !== 'ALL') {
          basePrice = historyQuery.length > 0 ? historyQuery[0].price : avgBuyPrice;
        } else {
          basePrice = avgBuyPrice;
        }

        if (holdings > 0) {
          const historyData = historyQuery.map(h => ({ t: h.timestamp.getTime(), p: h.price }));

          timeline.forEach((tTime, index) => {
            let closestPrice = basePrice;
            for (let i = historyData.length - 1; i >= 0; i--) {
              if (historyData[i].t <= tTime) {
                closestPrice = historyData[i].p;
                break;
              }
            }
            if (historyData.length > 0 && tTime < historyData[0].t) {
              closestPrice = historyData[0].p;
            }
            aggregateChart[index] += (holdings * closestPrice);
          });
        }

        const value = holdings * price;
        const assetBaseValue = basePrice * holdings;

        if (holdings > 0) {
          runningTotalValue += value;
          runningTotalInvested += invested;
          runningTotalBaseValue += assetBaseValue;
        }

        return { id: a.id, ticker: a.ticker, name: a.name, type: a.type, holdings, price, invested, value, baseValue: assetBaseValue };
      }));

      setAllocations(processed.filter(item => item.holdings > 0));
      setTotalValue(runningTotalValue);
      setTotalInvested(runningTotalInvested);
      setTotalBaseValue(runningTotalBaseValue);

      if (aggregateChart.some(val => val > 0)) {
        aggregateChart[aggregateChart.length - 1] = runningTotalValue;
        setChartData(aggregateChart);

        const validPoints = aggregateChart.filter(v => v > 0);
        setChartHigh(Math.max(...validPoints));
        setChartLow(Math.min(...validPoints));
      } else {
        setChartData([]);
      }
    });
    return () => subscription.unsubscribe();
  }, [selectedPortfolio, timeRange, database, refreshTrigger]);

  const dynamicNetProfit = totalValue - totalBaseValue;
  const dynamicProfitPercentage = totalBaseValue > 0 ? (dynamicNetProfit / totalBaseValue) * 100 : 0;

  const isChartPositive = chartData.length > 0 ? chartData[chartData.length - 1] >= chartData[0] : true;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.bg }]}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh}
            tintColor={isDarkMode ? '#ffffff' : '#212529'} // Spinner color for iOS
            colors={[isDarkMode ? '#2ed573' : '#28a745']} // Spinner colors for Android
          />
        }
      >
        {/* Your entire existing dashboard card grids and asset table lists go here... */}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* PORTFOLIO SELECTOR */}
        <View style={styles.header}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {portfolios.map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => setSelectedPortfolio(p)}
                style={[styles.tab, { backgroundColor: currentTheme.panel2 }, selectedPortfolio === p && { backgroundColor: currentTheme.blue }]}
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
              <Text style={[styles.statValue, { color: dynamicNetProfit >= 0 ? currentTheme.green : currentTheme.red }]}>
                {dynamicNetProfit >= 0 ? '+' : ''}${dynamicNetProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: dynamicProfitPercentage >= 0 ? currentTheme.green : currentTheme.red }]}>
                {dynamicProfitPercentage >= 0 ? '+' : ''}{dynamicProfitPercentage.toFixed(2)}%
              </Text>
            </View>
          </View>
        </View>

        {/* CHART */}
        {chartData.length > 0 && (
          <View style={styles.chartSection}>
            <View style={styles.extremeContainer}>
              <Text style={[styles.extremeHigh, { color: currentTheme.muted, backgroundColor: currentTheme.bg }]}>
                ${chartHigh.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </Text>
              <Text style={[styles.extremeLow, { color: currentTheme.muted, backgroundColor: currentTheme.bg }]}>
                ${chartLow.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </Text>
            </View>

            <LineChart
              data={{ labels: [], datasets: [{ data: chartData }] }}
              width={width - 48}
              height={140}
              withDots={false}
              withInnerLines={false}
              withOuterLines={false}
              withHorizontalLabels={false}
              withVerticalLabels={false}
              withShadow={false}
              chartConfig={{
                backgroundColor: currentTheme.bg,
                backgroundGradientFrom: currentTheme.bg,
                backgroundGradientTo: currentTheme.bg,
                color: () => isChartPositive
                  ? (isDarkMode ? '#2ed573' : '#28a745')
                  : (isDarkMode ? '#ff4757' : '#dc3545'),
                strokeWidth: 2,
                fillShadowGradientFromOpacity: 0,
                fillShadowGradientToOpacity: 0,
              }}
              style={styles.chartStyle}
            />
          </View>
        )}

        {/* TIMEFRAME BAR */}
        <View style={styles.rangeBar}>
          {['1HR', '1D', '1W', '1M', 'YTD', '1YR', 'ALL'].map((range) => (
            <TouchableOpacity
              key={range}
              onPress={() => setTimeRange(range)}
              style={[styles.rangeBtn, { backgroundColor: currentTheme.panel2, paddingHorizontal: 10 }, timeRange === range && { backgroundColor: currentTheme.blue }]}
            >
              <Text style={[styles.rangeText, { color: currentTheme.text, fontSize: 11 }, timeRange === range && { color: '#ffffff' }]}>{range}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ASSET TABLE */}
        <View style={[styles.panelCard, { backgroundColor: currentTheme.panel, borderColor: currentTheme.line }]}>
          {allocations.length === 0 ? (
            <Text style={{ color: currentTheme.muted, paddingVertical: 20, textAlign: 'center' }}>
              No assets found in this portfolio.
            </Text>
          ) : (
            allocations.map((item) => {
              const profit = item.value - item.baseValue;
              const percent = item.baseValue > 0 ? (profit / item.baseValue) * 100 : 0;

              return (
                <TouchableOpacity
                  key={item.ticker}
                  activeOpacity={0.72}
                  onPress={() => navigation?.navigate('AssetDetail', { assetId: item.id, marketType: item.type || 'crypto' })}
                  style={[styles.tableRow, { borderBottomColor: currentTheme.line }]}
                >
                  {/* LEFT COLUMN: ICON + TICKER/HOLDINGS DESCRIPTION */}
                  <View style={styles.colLeft}>
                    {item.type === 'stock' ? (
                      <View style={{ width: 32, height: 32, borderRadius: 16, overflow: 'hidden', backgroundColor: currentTheme.panel2, justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ fontSize: 10, fontWeight: 'bold', color: currentTheme.text }}>{item.ticker.slice(0, 2)}</Text>
                      </View>
                    ) : (
                      <CryptoIcon symbol={item.ticker.toLowerCase()} size={32} />
                    )}

                    <View style={styles.tickerTextContainer}>
                      <Text style={[styles.tdTicker, { color: currentTheme.text }]}>{item.ticker}</Text>
                      <Text style={[styles.tdSecondary, { color: currentTheme.muted }]}>
                        {item.holdings.toLocaleString('en-US', { maximumFractionDigits: 4 })} | ${item.price.toFixed(2)}
                      </Text>
                    </View>
                  </View>

                  {/* RIGHT COLUMN: VALUATION AND PERFORMANCE PNL CELLS */}
                  <View style={styles.colRight}>
                    <Text style={[styles.tdValue, { color: currentTheme.text }]}>${item.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                    <Text style={[styles.tdProfit, { color: profit >= 0 ? currentTheme.green : currentTheme.red }]}>
                      {profit >= 0 ? '+$' : '-$'}{Math.abs(profit).toLocaleString(undefined, { maximumFractionDigits: 0 })} | {profit >= 0 ? '+' : ''}{percent.toFixed(1)}%
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })
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
  stylesRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  statsRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  statItem: { marginRight: 20 },
  statValue: { fontSize: 18, fontWeight: '600' },
  chartSection: { marginVertical: 20, position: 'relative', height: 140 },
  extremeContainer: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 2,
    justifyContent: 'space-between',
    paddingVertical: 6
  },
  extremeHigh: { fontSize: 10, fontWeight: '700', paddingHorizontal: 4, alignSelf: 'flex-start' },
  extremeLow: { fontSize: 10, fontWeight: '700', paddingHorizontal: 4, alignSelf: 'flex-end' },
  chartStyle: { marginVertical: 0, paddingRight: 0, paddingLeft: 0 },
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
  tickerTextContainer: { marginLeft: 12, flexDirection: 'column', },
});