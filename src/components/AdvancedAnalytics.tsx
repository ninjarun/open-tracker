import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView } from 'react-native';
import { useDatabase } from '@nozbe/watermelondb/hooks';
import { Q } from '@nozbe/watermelondb';
import { Asset, Transaction, PriceHistory } from '../../database/models';
import { calculatePnL } from '../utils/pnl';
import { AdvancedPnLTracker } from './AdvancedPnLTracker';
import { AllocationMatrix, AllocationMatrixItem } from './AllocationMatrix';

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

interface AdvancedAnalyticsProps {
  isDarkMode: boolean;
}

type AnalyticsTotals = {
  totalValue: number;
  costBasis: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
};

export function AdvancedAnalytics({ isDarkMode }: AdvancedAnalyticsProps) {
  const database = useDatabase();
  const theme = isDarkMode ? THEMES.dark : THEMES.light;

  const [portfolios, setPortfolios] = useState<string[]>(['ALL']);
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>('ALL');
  const [allocations, setAllocations] = useState<AllocationMatrixItem[]>([]);
  const [totals, setTotals] = useState<AnalyticsTotals>({
    totalValue: 0,
    costBasis: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    totalPnL: 0,
  });

  useEffect(() => {
    const sub = database.get<Transaction>('transactions').query().observe().subscribe(txs => {
      const unique = Array.from(new Set(txs.map(tx => tx.portfolio).filter(Boolean)));
      setPortfolios(['ALL', ...unique]);
    });

    return () => sub.unsubscribe();
  }, [database]);

  useEffect(() => {
    const sub = database.get<Asset>('assets').query().observe().subscribe(async assets => {
      let runningValue = 0;
      let runningCostBasis = 0;
      let runningRealized = 0;
      let runningUnrealized = 0;

      const rows = await Promise.all(assets.map(async asset => {
        const txQuery = selectedPortfolio === 'ALL'
          ? database.get<Transaction>('transactions').query(Q.where('asset_id', asset.id))
          : database.get<Transaction>('transactions').query(
              Q.where('asset_id', asset.id),
              Q.where('portfolio', selectedPortfolio)
            );

        const txs = await txQuery.fetch();

        const latestPriceHistory = await database.get<PriceHistory>('price_history')
          .query(Q.where('asset_id', asset.id), Q.sortBy('timestamp', Q.desc), Q.take(1))
          .fetch();

        const currentPrice = latestPriceHistory.length > 0 ? latestPriceHistory[0].price : 0;
        const pnl = calculatePnL(txs, currentPrice);

        runningValue += pnl.marketValue;
        runningCostBasis += pnl.costBasis;
        runningRealized += pnl.realizedPnL;
        runningUnrealized += pnl.unrealizedPnL;

        return {
          ticker: asset.ticker,
          type: asset.type,
          value: pnl.marketValue,
          weight: 0,
          totalPnL: pnl.totalPnL,
          holdings: pnl.holdings,
        };
      }));

      const activeRows = rows
        .filter(row => row.holdings > 0 && row.value > 0)
        .map(row => ({
          ...row,
          weight: runningValue > 0 ? row.value / runningValue : 0,
        }))
        .sort((a, b) => b.value - a.value);

      setAllocations(activeRows);
      setTotals({
        totalValue: runningValue,
        costBasis: runningCostBasis,
        realizedPnL: runningRealized,
        unrealizedPnL: runningUnrealized,
        totalPnL: runningRealized + runningUnrealized,
      });
    });

    return () => sub.unsubscribe();
  }, [database, selectedPortfolio]);

  const largestAllocation = useMemo(() => allocations[0], [allocations]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}> 
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.screenTitle, { color: theme.text }]}>Analytics</Text>
        <Text style={[styles.screenSubtitle, { color: theme.muted }]}>Client-side PnL and allocation intelligence</Text>

        <View style={styles.header}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {portfolios.map(portfolio => (
              <TouchableOpacity
                key={portfolio}
                onPress={() => setSelectedPortfolio(portfolio)}
                style={[
                  styles.tab,
                  { backgroundColor: theme.panel2 },
                  selectedPortfolio === portfolio && { backgroundColor: theme.blue },
                ]}
              >
                <Text style={[styles.tabText, { color: selectedPortfolio === portfolio ? '#ffffff' : theme.text }]}> 
                  {portfolio}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <AdvancedPnLTracker
          theme={theme}
          realizedPnL={totals.realizedPnL}
          unrealizedPnL={totals.unrealizedPnL}
          totalPnL={totals.totalPnL}
          totalValue={totals.totalValue}
          costBasis={totals.costBasis}
        />

        {largestAllocation && (
          <View style={[styles.insightCard, { backgroundColor: theme.panel2 }]}> 
            <Text style={[styles.insightLabel, { color: theme.muted }]}>Largest Allocation</Text>
            <Text style={[styles.insightText, { color: theme.text }]}> 
              {largestAllocation.ticker} at {(largestAllocation.weight * 100).toFixed(1)}% of portfolio
            </Text>
          </View>
        )}

        <AllocationMatrix theme={theme} data={allocations} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24 },
  screenTitle: { fontSize: 34, fontWeight: '900', marginTop: 8 },
  screenSubtitle: { fontSize: 13, fontWeight: '600', marginTop: 4, marginBottom: 20 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  tab: { paddingVertical: 8, paddingHorizontal: 16, marginRight: 10, borderRadius: 20 },
  tabText: { fontWeight: '800', fontSize: 13 },
  insightCard: { borderRadius: 16, padding: 16, marginBottom: 16 },
  insightLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  insightText: { fontSize: 15, fontWeight: '800', marginTop: 4 },
});
