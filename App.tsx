import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, SafeAreaView, TouchableOpacity, Switch } from 'react-native';
import { Database } from '@nozbe/watermelondb';
import { DatabaseProvider } from '@nozbe/watermelondb/react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { initializeDatabase } from './database';
import { Dashboard } from './src/components/Dashboard';
import { AddTransaction } from './src/components/AddTransaction';
import { ImportButton } from './src/components/ImportButton';
import { syncPriceData, backfillHistoricalPrices } from './database/utils/syncEngine';
import { NewsScreen } from './src/components/NewsScreen';
import { AdvancedAnalytics } from './src/components/AdvancedAnalytics';
import { MarketsScreen } from './src/components/MarketsScreen';
import { AssetDetail } from './src/components/AssetDetail';

const DBProvider = DatabaseProvider as any;

const NAV_THEMES = {
  light: {
    bg: '#f8f9fa',
    panel: '#ffffff',
    panel2: '#f1f3f5',
    tabBar: '#ffffff',
    line: 'rgba(0, 0, 0, 0.08)',
    text: '#212529',
    muted: '#6c757d',
    activeBlue: '#A9A9A9',
  },
  dark: {
    bg: '#0f1115',
    panel: '#161920',
    panel2: '#212631',
    tabBar: '#161920',
    line: 'rgba(255, 255, 255, 0.08)',
    text: '#f8f9fa',
    muted: '#98a2b3',
    activeBlue: '#4b5563', 
  }
};

type TabId = 'DASHBOARD' | 'ANALYTICS' | 'AUTOMATION' | 'TRANSACTIONS' | 'NEWS' | 'SETTINGS';

interface TabConfig {
  id: TabId;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

export default function App() {
  const [dbInstance, setDbInstance] = useState<Database | null>(null);
  const [activeTab, setActiveTab] = useState<string>('DASHBOARD');
  const [assetDetailParams, setAssetDetailParams] = useState<Record<string, unknown> | null>(null);
  const [initialAlertAsset, setInitialAlertAsset] = useState<any | null>(null);
  
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  
  const currentTheme = isDarkMode ? NAV_THEMES.dark : NAV_THEMES.light;
  const navigation = {
    navigate: (screen: string, params?: Record<string, unknown>) => {
      if (screen === 'AssetDetail') {
        setAssetDetailParams(params || {});
        setActiveTab('ASSET_DETAIL');
        return;
      }

      if (screen === 'PriceAlertDispatcher') {
        const asset = (params?.prefilledAsset || params?.asset) as any;
        setInitialAlertAsset(asset ? {
          id: asset.id,
          symbol: asset.ticker || asset.symbol,
          name: asset.name,
          type: asset.type === 'stock' ? 'stock' : 'crypto',
        } : null);
        setActiveTab('AUTOMATION');
        return;
      }

      if (screen === 'Markets') {
        setActiveTab('AUTOMATION');
        return;
      }

      setActiveTab(screen);
    },
    goBack: () => setActiveTab('AUTOMATION'),
  };

  useEffect(() => {
    async function setup() {
      try {
        const db = await initializeDatabase();
        setDbInstance(db);
        syncPriceData().catch(err => 
          console.error("Automated background price sync failed:", err)
        );
      } catch (error) {
        console.error("Critical error starting app database:", error);
      }
    }
    setup();
  }, []);

  if (!dbInstance) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: '#0f1115' }]}>
        <ActivityIndicator size="large" color="#4b5563" />
        <Text style={[styles.loadingText, { color: '#98a2b3' }]}>Securing Vault Database...</Text>
      </View>
    );
  }

  const renderScreenContent = () => {
    switch (activeTab) {
      case 'DASHBOARD':
        return <Dashboard isDarkMode={isDarkMode} navigation={navigation} />;
      case 'ANALYTICS':
        return <AdvancedAnalytics isDarkMode={isDarkMode} />;
      case 'AUTOMATION':
        return <MarketsScreen isDarkMode={isDarkMode} navigation={navigation} initialAlertAsset={initialAlertAsset} />;
      case 'ASSET_DETAIL':
        return <AssetDetail isDarkMode={isDarkMode} navigation={navigation} route={{ params: assetDetailParams || {} }} />;
      case 'TRANSACTIONS':
        return <AddTransaction />;
      case 'NEWS':
        return <NewsScreen currentTheme={currentTheme} />;
      case 'SETTINGS':
        return (
          <View style={[styles.settingsScreen, { backgroundColor: currentTheme.bg }]}>
            <Text style={[styles.settingsTitle, { color: currentTheme.text }]}>Settings</Text>
            
            <View style={[styles.switchRow, { borderBottomColor: currentTheme.line }]}>
              <Text style={[styles.switchLabel, { color: currentTheme.text }]}>Dark Mode Display</Text>
              <Switch
                value={isDarkMode}
                onValueChange={(val) => setIsDarkMode(val)}
                trackColor={{ false: '#767577', true: currentTheme.activeBlue }}
                thumbColor={isDarkMode ? '#ffffff' : '#f4f3f4'}
              />
            </View>

            <Text style={[styles.sectionLabel, { color: currentTheme.muted, marginTop: 24 }]}>Data Synchronization</Text>
            
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: currentTheme.panel2, borderColor: currentTheme.line }, isSyncing && { opacity: 0.6 }]}
              onPress={() => { setIsSyncing(true); syncPriceData().finally(() => setIsSyncing(false)); }}
              disabled={isSyncing}
            >
              <Text style={[styles.primaryBtnText, { color: currentTheme.text }]}>
                {isSyncing ? 'Syncing Real-time Prices...' : 'Refresh Current Prices'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: currentTheme.panel2, borderColor: currentTheme.line }, isSyncing && { opacity: 0.6 }]}
              onPress={async () => {
                setIsSyncing(true);
                try { await backfillHistoricalPrices(); }
                catch (error) { console.error("Sync history failed:", error); }
                finally { setIsSyncing(false); }
              }}
              disabled={isSyncing}
            >
              <Text style={[styles.primaryBtnText, { color: currentTheme.text }]}>
                {isSyncing ? 'Downloading History Vectors...' : 'Download Historical Price Vectors (365D)'}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.sectionLabel, { color: currentTheme.muted, marginTop: 24 }]}>Data Administration</Text>
            <View style={{ marginTop: 8 }}>
              <ImportButton />
            </View>
          </View>
        );
      default:
        return <Dashboard isDarkMode={isDarkMode} />;
    }
  };

  const tabs: TabConfig[] = [
    { id: 'DASHBOARD', label: 'Dashboard', icon: 'view-dashboard' },
    { id: 'ANALYTICS', label: 'Analytics', icon: 'chart-timeline-variant' },
    { id: 'AUTOMATION', label: 'Markets', icon: 'trending-up' },
    { id: 'TRANSACTIONS', label: 'Action', icon: 'plus-circle' },
    { id: 'NEWS', label: 'News', icon: 'newspaper-variant' },
    { id: 'SETTINGS', label: 'Settings', icon: 'cog' }
  ];

  return (
    <DBProvider database={dbInstance}>
      <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.bg }]}>
        
        <View style={styles.screenWrapper}>
          {renderScreenContent()}
        </View>

        <View style={[styles.tabBarContainer, { backgroundColor: currentTheme.tabBar, borderTopColor: currentTheme.line }]}>
          {tabs.map((tab) => {
            const isTabFocused = activeTab === tab.id;
            const iconColor = isTabFocused ? currentTheme.text : currentTheme.muted;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                activeOpacity={0.7}
                style={[
                  styles.tabButton, 
                  isTabFocused && { backgroundColor: isDarkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }
                ]}
              >
                <MaterialCommunityIcons 
                  name={tab.icon} 
                  size={20} 
                  color={iconColor} 
                  style={styles.tabIcon} 
                />
                <Text style={[
                  styles.tabLabel, 
                  { color: iconColor }
                ]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

      </SafeAreaView>
    </DBProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screenWrapper: { flex: 1 },
  tabBarContainer: { 
    flexDirection: 'row', 
    height: 64, 
    borderTopWidth: 1, 
    paddingHorizontal: 8,
    paddingBottom: 4,
    alignItems: 'center',
    justifyContent: 'space-around'
  },
  tabButton: { 
    flex: 1,
    alignItems: 'center', 
    justifyContent: 'center',
    paddingVertical: 6,
    marginHorizontal: 4,
    borderRadius: 12
  },
  tabIcon: { marginBottom: 2 },
  tabLabel: { fontSize: 11, fontWeight: '600' },
  fallbackScreen: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fallbackText: { fontSize: 14, fontWeight: '600' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 14, fontSize: 13, fontWeight: '500' },
  settingsScreen: { flex: 1, padding: 24 },
  settingsTitle: { fontSize: 28, fontWeight: '800', marginBottom: 16, marginTop: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1 },
  switchLabel: { fontSize: 16, fontWeight: '600' },
  primaryBtn: { paddingVertical: 14, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  primaryBtnText: { fontSize: 14, fontWeight: '600', textAlign: 'left' },
});