import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type AllocationMatrixItem = {
  ticker: string;
  type: string;
  value: number;
  weight: number;
  totalPnL: number;
  holdings: number;
};

type Theme = {
  panel: string;
  panel2: string;
  text: string;
  muted: string;
  line: string;
  green: string;
  red: string;
};

type Props = {
  theme: Theme;
  data: AllocationMatrixItem[];
};

export function AllocationMatrix({ theme, data }: Props) {
  return (
    <View style={[styles.card, { backgroundColor: theme.panel, borderColor: theme.line }]}> 
      <Text style={[styles.title, { color: theme.text }]}>Asset Allocation Matrix</Text>

      {data.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.muted }]}>No active holdings found.</Text>
      ) : (
        data.map(item => {
          const intensity = Math.min(item.weight, 0.5) / 0.5;
          const tint = item.totalPnL >= 0 ? '46, 213, 115' : '255, 71, 87';
          const backgroundColor = `rgba(${tint}, ${0.12 + intensity * 0.38})`;

          return (
            <View key={item.ticker} style={[styles.matrixRow, { backgroundColor }]}> 
              <View style={styles.assetColumn}>
                <Text style={[styles.ticker, { color: theme.text }]}>{item.ticker}</Text>
                <Text style={[styles.type, { color: theme.muted }]}>{item.type || 'asset'}</Text>
              </View>

              <View style={styles.weightColumn}>
                <Text style={[styles.weight, { color: theme.text }]}>{(item.weight * 100).toFixed(1)}%</Text>
                <View style={[styles.barTrack, { backgroundColor: theme.panel2 }]}> 
                  <View style={[styles.barFill, { width: `${Math.min(item.weight * 100, 100)}%`, backgroundColor: item.totalPnL >= 0 ? theme.green : theme.red }]} />
                </View>
              </View>

              <View style={styles.valueColumn}>
                <Text style={[styles.value, { color: theme.text }]}>${item.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                <Text style={[styles.pnl, { color: item.totalPnL >= 0 ? theme.green : theme.red }]}> 
                  {item.totalPnL >= 0 ? '+' : ''}${item.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 16 },
  emptyText: { paddingVertical: 20, textAlign: 'center', fontWeight: '600' },
  matrixRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, marginBottom: 10 },
  assetColumn: { flex: 0.9 },
  ticker: { fontSize: 16, fontWeight: '900' },
  type: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  weightColumn: { flex: 1.2, paddingHorizontal: 8 },
  weight: { fontSize: 14, fontWeight: '800', marginBottom: 6 },
  barTrack: { height: 6, borderRadius: 6, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 6 },
  valueColumn: { flex: 1, alignItems: 'flex-end' },
  value: { fontSize: 14, fontWeight: '900' },
  pnl: { fontSize: 12, fontWeight: '800', marginTop: 2 },
});
