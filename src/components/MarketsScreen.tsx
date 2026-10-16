import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import  { MarketOverview }  from './MarketOverview';
import { PriceAlertDispatcher } from './PriceAlertDispatcher';

// Ensure your theme definitions are consistent
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

type Props = { 
  isDarkMode: boolean; 
  navigation: any; 
  initialAlertAsset?: any; 
};

export function MarketsScreen({ isDarkMode, navigation, initialAlertAsset }: Props) {
  const theme = isDarkMode ? THEMES.dark : THEMES.light;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.screenTitle, { color: theme.text }]}>Markets</Text>
        
        {/* Your MarketOverview component handles the tabbed view */}
        <MarketOverview theme={theme} navigation={navigation} />
        
        {/* The Dispatcher now supports pre-filled asset data */}
        <PriceAlertDispatcher 
          theme={theme} 
          initialAsset={initialAlertAsset} 
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16 },
  screenTitle: { fontSize: 24, fontWeight: '900', marginBottom: 20 },
});