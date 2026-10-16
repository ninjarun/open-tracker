import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { buildGlobalMarketScreener, ScreenerAsset } from '../utils/marketScreener';

type Theme = {
  panel: string;
  text: string;
  muted: string;
  line: string;
  green: string;
  red: string;
};

type Props = { theme: Theme };

function AssetRow({ item, theme }: { item: ScreenerAsset; theme: Theme }) {
  const positive = item.changePercent24h >= 0;

  return (
    <View style={[styles.assetRow, { borderBottomColor: theme.line }]}> 
      <View style={{ flex: 1 }}>
        <Text style={[styles.ticker, { color: theme.text }]}>{item.ticker}</Text>
        <Text style={[styles.assetName, { color: theme.muted }]} numberOfLines={1}>{item.name}</Text>
      </View>
      <View style={styles.rightCol}>
        <Text style={[styles.price, { color: theme.text }]}>
          ${item.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </Text>
        <Text style={[styles.change, { color: positive ? theme.green : theme.red }]}> 
          {positive ? '+' : ''}{item.changePercent24h.toFixed(2)}%
        </Text>
      </View>
    </View>
  );
}

export function LocalMarketScreener({ theme }: Props) {
  const [gainers, setGainers] = useState<ScreenerAsset[]>([]);
  const [losers, setLosers] = useState<ScreenerAsset[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      const result = await buildGlobalMarketScreener();
      if (!alive) return;
      // setGainers(result.gainers);
      // setLosers(result.losers);
      setGainers(result.crypto.gainers);
setLosers(result.crypto.losers);
      setLoading(false);
    }

    refresh();
    const interval = setInterval(refresh, 60000); // Live refresh every 60s

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <View style={[styles.card, { backgroundColor: theme.panel, borderColor: theme.line }]}>
      <Text style={[styles.title, { color: theme.text }]}>Market Screener</Text>
      <Text style={[styles.subtitle, { color: theme.muted }]}>Top 250 global assets monitored live</Text>

      <Text style={[styles.sectionTitle, { color: theme.green }]}>Top Gainers</Text>
      {loading ? (
        <Text style={[styles.empty, { color: theme.muted }]}>Loading global feeds...</Text>
      ) : gainers.length === 0 ? (
        <Text style={[styles.empty, { color: theme.muted }]}>No assets found.</Text>
      ) : (
        gainers.map(item => <AssetRow key={`g-${item.assetId}`} item={item} theme={theme} />)
      )}

      <Text style={[styles.sectionTitle, { color: theme.red, marginTop: 18 }]}>Top Losers</Text>
      {loading ? (
        <Text style={[styles.empty, { color: theme.muted }]}>Loading global feeds...</Text>
      ) : losers.length === 0 ? (
        <Text style={[styles.empty, { color: theme.muted }]}>No assets found.</Text>
      ) : (
        losers.map(item => <AssetRow key={`l-${item.assetId}`} item={item} theme={theme} />)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '900' },
  subtitle: { fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase', marginBottom: 8 },
  empty: { fontSize: 13, fontWeight: '600', paddingVertical: 10 },
  assetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderWidth: 0, borderBottomWidth: 1 },
  ticker: { fontSize: 16, fontWeight: '900' },
  assetName: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  rightCol: { alignItems: 'flex-end' },
  price: { fontSize: 15, fontWeight: '800' },
  change: { fontSize: 13, fontWeight: '900', marginTop: 2 },
});