import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { buildGlobalMarketScreener, GlobalMarketScreener, ScreenerAsset } from '../utils/marketScreener';
import { CryptoIcon } from '@vnaidin/react-native-cryptocurrency-icons';

type Theme = {
  panel: string;
  panel2: string;
  text: string;
  muted: string;
  line: string;
  green: string;
  red: string;
  blue: string;
};

type NavigationLike = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Props = {
  theme: Theme;
  navigation: NavigationLike;
};

const EMPTY_MARKETS: GlobalMarketScreener = {
  crypto: { gainers: [], losers: [], all: [] },
  stocks: { gainers: [], losers: [], all: [] },
  commodities: { gainers: [], losers: [], all: [] },
  fiat: { gainers: [], losers: [], all: [] },
};

export function AssetRow({ item, theme }: { item: ScreenerAsset; theme: Theme }) {
  const positive = item.changePercent24h >= 0;

  return (
    <View style={[styles.assetRow, { borderBottomColor: theme.line }]}> 
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        {item.type === 'crypto' ? (
          <CryptoIcon symbol={item.ticker.toLowerCase()} size={32} />
        ) : (
          <View style={[styles.fallbackIcon, { backgroundColor: theme.panel2 }]}>
            <Text style={[styles.fallbackIconText, { color: theme.text }]}>{item.ticker.slice(0, 2)}</Text>
          </View>
        )}
        
        <View style={{ marginLeft: 12, flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.ticker, { color: theme.text }]}>{item.ticker}</Text>
            <View style={[styles.typeBadge, { backgroundColor: theme.panel2 }]}>
              <Text style={[styles.typeBadgeText, { color: theme.muted }]}>{item.type.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={[styles.assetName, { color: theme.muted }]} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
      </View>

      <View style={styles.rightCol}>
        <Text style={[styles.price, { color: theme.text }]}>
          ${item.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
        </Text>
        <Text style={[styles.change, { color: positive ? theme.green : theme.red }]}> 
          {positive ? '+' : ''}{item.changePercent24h.toFixed(2)}%
        </Text>
      </View>
    </View>
  );
}

export function MarketOverview({ theme, navigation }: Props) {
  const [data, setData] = useState<GlobalMarketScreener>(EMPTY_MARKETS);
  const [loading, setLoading] = useState<boolean>(true);
  
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedType, setSelectedType] = useState<'ALL' | 'CRYPTO' | 'STOCKS' | 'COMMODITIES' | 'FIAT'>('ALL');

  useEffect(() => {
    async function fetchData() {
      const result = await buildGlobalMarketScreener();
      setData(result);
      setLoading(false);
    }
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const masterAssetList = useMemo(() => {
    return [
      ...(data.crypto?.all || []),
      ...(data.stocks?.all || []),
      ...(data.commodities?.all || []),
      ...(data.fiat?.all || []),
    ];
  }, [data]);

  const filteredAssets = useMemo(() => {
    return masterAssetList.filter(asset => {
      if (selectedType === 'CRYPTO' && asset.type !== 'crypto') return false;
      if (selectedType === 'STOCKS' && asset.type !== 'stock') return false;
      if (selectedType === 'COMMODITIES' && asset.type !== 'commodity') return false;
      if (selectedType === 'FIAT' && asset.type !== 'fiat') return false;

      return (
        asset.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
        asset.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [masterAssetList, searchQuery, selectedType]);

  return (
    <View style={styles.container}>
      <View style={styles.searchSection}>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search assets, stocks, commodities..."
          placeholderTextColor={theme.muted}
          style={[styles.globalSearchBar, { backgroundColor: theme.panel, borderColor: theme.line, color: theme.text }]}
        />
      </View>

      {/* Expanded Multi-Market Type selector bar */}
      <View style={[styles.filterBar, { backgroundColor: theme.panel, borderColor: theme.line }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 2 }}>
          {(['ALL', 'CRYPTO', 'STOCKS', 'COMMODITIES', 'FIAT'] as const).map((type) => (
            <TouchableOpacity
              key={type}
              onPress={() => setSelectedType(type)}
              style={[styles.filterButton, selectedType === type && { backgroundColor: theme.panel2 }]}
            >
              <Text style={[styles.filterText, { color: theme.text }, selectedType === type && { fontWeight: '900' }]}>
                {type === 'COMMODITIES' ? 'Commodities' : type === 'CRYPTO' ? 'Crypto' : type.charAt(0) + type.slice(1).toLowerCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {searchQuery.trim().length > 0 || selectedType !== 'ALL' ? (
        <View style={[styles.card, { backgroundColor: theme.panel, borderColor: theme.line }]}>
          <Text style={[styles.sectionTitle, { color: theme.blue }]}>Market Results ({filteredAssets.length})</Text>
          {filteredAssets.length === 0 ? (
            <Text style={[styles.empty, { color: theme.muted }]}>No matching listings found.</Text>
          ) : (
            filteredAssets.map((item) => (
              <TouchableOpacity key={`${item.type}-${item.assetId}`} onPress={() => navigation.navigate('AssetDetail', { assetId: item.assetId, marketType: item.type })}>
                <AssetRow item={item} theme={theme} />
              </TouchableOpacity>
            ))
          )}
        </View>
      ) : (
        <View>
          {/* Default view shows Crypto overview boards */}
          <View style={[styles.card, { backgroundColor: theme.panel, borderColor: theme.line }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Top Gainers (Crypto)</Text>
            {data.crypto?.gainers.map((item) => (
              <TouchableOpacity key={`g-${item.assetId}`} onPress={() => navigation.navigate('AssetDetail', { assetId: item.assetId, marketType: item.type })}>
                <AssetRow item={item} theme={theme} />
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.card, { backgroundColor: theme.panel, borderColor: theme.line, marginTop: 12 }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>Top Losers (Crypto)</Text>
            {data.crypto?.losers.map((item) => (
              <TouchableOpacity key={`l-${item.assetId}`} onPress={() => navigation.navigate('AssetDetail', { assetId: item.assetId, marketType: item.type })}>
                <AssetRow item={item} theme={theme} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, marginBottom: 8 },
  searchSection: { marginBottom: 12 },
  globalSearchBar: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, fontWeight: '600' },
  filterBar: { flexDirection: 'row', paddingVertical: 4, borderRadius: 14, borderWidth: 1, marginBottom: 16 },
  filterButton: { paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center', borderRadius: 10, marginHorizontal: 2 },
  filterText: { fontSize: 12, fontWeight: '700' },
  card: { borderRadius: 20, padding: 20, borderWidth: 1 },
  cardTitle: { fontSize: 16, fontWeight: '900', marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '900', textTransform: 'uppercase', marginBottom: 12 },
  empty: { fontSize: 13, fontWeight: '600', paddingVertical: 14, textAlign: 'center' },
  assetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1 },
  fallbackIcon: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  fallbackIconText: { fontSize: 11, fontWeight: '900' },
  ticker: { fontSize: 16, fontWeight: '900' },
  typeBadge: { paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, marginLeft: 8 },
  typeBadgeText: { fontSize: 8, fontWeight: '900' },
  assetName: { fontSize: 12, fontWeight: '600', marginTop: 3 },
  rightCol: { alignItems: 'flex-end' },
  price: { fontSize: 15, fontWeight: '800' },
  change: { fontSize: 13, fontWeight: '900', marginTop: 3 },
});