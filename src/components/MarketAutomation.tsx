import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native';
import { LocalMarketScreener } from './LocalMarketScreener';
import { PriceAlertDispatcher } from './PriceAlertDispatcher';

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

export function MarketAutomation({ isDarkMode }: { isDarkMode: boolean }) {
  const theme = isDarkMode ? THEMES.dark : THEMES.light;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}> 
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.screenTitle, { color: theme.text }]}>Automation</Text>
        <Text style={[styles.screenSubtitle, { color: theme.muted }]}>Local market screeners and local-only price alerts</Text>

        <LocalMarketScreener theme={theme} />
        <PriceAlertDispatcher theme={theme} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 24 },
  screenTitle: { fontSize: 34, fontWeight: '900', marginTop: 8 },
  screenSubtitle: { fontSize: 13, fontWeight: '600', marginTop: 4, marginBottom: 20 },
});
