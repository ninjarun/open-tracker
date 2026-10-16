import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type Theme = {
  panel: string;
  text: string;
  muted: string;
  line: string;
  green: string;
  red: string;
};

type Props = {
  theme: Theme;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  totalValue: number;
  costBasis: number;
};

const formatMoney = (value: number) =>
  value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const signedMoney = (value: number) => `${value >= 0 ? '+' : ''}${formatMoney(value)}`;

export function AdvancedPnLTracker({
  theme,
  realizedPnL,
  unrealizedPnL,
  totalPnL,
  totalValue,
  costBasis,
}: Props) {
  const totalPercent = costBasis > 0 ? (totalPnL / costBasis) * 100 : 0;

  return (
    <View style={[styles.card, { backgroundColor: theme.panel, borderColor: theme.line }]}> 
      <Text style={[styles.title, { color: theme.text }]}>Advanced PnL Tracker</Text>

      <View style={styles.summaryRow}>
        <View>
          <Text style={[styles.label, { color: theme.muted }]}>Total PnL</Text>
          <Text style={[styles.mainValue, { color: totalPnL >= 0 ? theme.green : theme.red }]}> 
            {signedMoney(totalPnL)}
          </Text>
        </View>
        <Text style={[styles.percent, { color: totalPercent >= 0 ? theme.green : theme.red }]}> 
          {totalPercent >= 0 ? '+' : ''}{totalPercent.toFixed(2)}%
        </Text>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.line }]} />

      <View style={styles.row}>
        <Text style={[styles.label, { color: theme.muted }]}>Realized Gains</Text>
        <Text style={[styles.value, { color: realizedPnL >= 0 ? theme.green : theme.red }]}> 
          {signedMoney(realizedPnL)}
        </Text>
      </View>

      <View style={styles.row}>
        <Text style={[styles.label, { color: theme.muted }]}>Unrealized Gains</Text>
        <Text style={[styles.value, { color: unrealizedPnL >= 0 ? theme.green : theme.red }]}> 
          {signedMoney(unrealizedPnL)}
        </Text>
      </View>

      <View style={styles.row}>
        <Text style={[styles.label, { color: theme.muted }]}>Current Value</Text>
        <Text style={[styles.value, { color: theme.text }]}>{formatMoney(totalValue)}</Text>
      </View>

      <View style={styles.row}>
        <Text style={[styles.label, { color: theme.muted }]}>Remaining Cost Basis</Text>
        <Text style={[styles.value, { color: theme.text }]}>{formatMoney(costBasis)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  mainValue: { fontSize: 28, fontWeight: '900', marginTop: 4 },
  percent: { fontSize: 18, fontWeight: '800' },
  divider: { height: 1, marginVertical: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  value: { fontSize: 15, fontWeight: '800' },
});
