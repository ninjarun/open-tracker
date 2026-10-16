import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useDatabase } from '@nozbe/watermelondb/hooks';
import { PriceAlert } from '../../database/models';
import { checkPriceAlerts, createPriceAlert, disablePriceAlert, listPriceAlerts, PriceAlertRow, AlertDirection, MarketType } from '../utils/priceAlerts';
import { configureLocalNotifications } from '../utils/notifications';

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

type PriceAlertRoute = {
  params?: {
    prefilledAsset?: Partial<SearchAsset> & { ticker?: string };
  };
};

type Props = {
  theme: Theme;
  initialAsset?: SearchAsset | null;
  route?: PriceAlertRoute;
};

type SearchAsset = {
  id: string;
  symbol: string;
  name: string;
  type: MarketType;
};

type YahooSearchResult = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
  }>;
};

const STOCK_FALLBACKS: SearchAsset[] = [
  { id: 'AAPL', symbol: 'AAPL', name: 'Apple Inc.', type: 'stock' },
  { id: 'MSFT', symbol: 'MSFT', name: 'Microsoft Corporation', type: 'stock' },
  { id: 'NVDA', symbol: 'NVDA', name: 'NVIDIA Corporation', type: 'stock' },
  { id: 'TSLA', symbol: 'TSLA', name: 'Tesla, Inc.', type: 'stock' },
  { id: 'AMZN', symbol: 'AMZN', name: 'Amazon.com, Inc.', type: 'stock' },
  { id: 'GOOGL', symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'stock' },
  { id: 'META', symbol: 'META', name: 'Meta Platforms, Inc.', type: 'stock' },
  { id: 'SPY', symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', type: 'stock' },
  { id: 'QQQ', symbol: 'QQQ', name: 'Invesco QQQ Trust', type: 'stock' },
  { id: 'VTI', symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'stock' },
];

function uniqueSearchAssets(items: SearchAsset[]): SearchAsset[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchCrypto(query: string): Promise<SearchAsset[]> {
  const response = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
  const data = await response.json();

  if (!data || !Array.isArray(data.coins)) return [];

  return data.coins.slice(0, 6).map((coin: any) => ({
    id: String(coin.id),
    symbol: String(coin.symbol || '').toUpperCase(),
    name: String(coin.name || coin.id),
    type: 'crypto',
  }));
}

async function searchStocks(query: string): Promise<SearchAsset[]> {
  const fallbackMatches = STOCK_FALLBACKS.filter(stock => {
    const needle = query.toLowerCase();
    return stock.symbol.toLowerCase().includes(needle) || stock.name.toLowerCase().includes(needle);
  });

  try {
    const response = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0`);
    const data = await response.json() as YahooSearchResult;
    const yahooMatches = (data.quotes || [])
      .filter(quote => quote.symbol && ['EQUITY', 'ETF'].includes(String(quote.quoteType || '').toUpperCase()))
      .slice(0, 6)
      .map(quote => ({
        id: String(quote.symbol).toUpperCase(),
        symbol: String(quote.symbol).toUpperCase(),
        name: String(quote.longname || quote.shortname || quote.symbol),
        type: 'stock' as MarketType,
      }));

    return uniqueSearchAssets([...yahooMatches, ...fallbackMatches]).slice(0, 6);
  } catch {
    return fallbackMatches.slice(0, 6);
  }
}

export function PriceAlertDispatcher({ theme, initialAsset, route }: Props) {
  const database = useDatabase();
  const thresholdInputRef = useRef<TextInput | null>(null);
  const [highlightThreshold, setHighlightThreshold] = useState<boolean>(false);
  
  // Search and selection states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [suggestions, setSuggestions] = useState<SearchAsset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<SearchAsset | null>(null);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);

  const [direction, setDirection] = useState<AlertDirection>('ABOVE');
  const [threshold, setThreshold] = useState<string>('');
  const [alerts, setAlerts] = useState<PriceAlertRow[]>([]);
  const [lastCheck, setLastCheck] = useState<string>('Never');

  async function refreshAlerts() {
    setAlerts(await listPriceAlerts(database));
  }

  async function runLocalCheck() {
    await configureLocalNotifications();
    const count = await checkPriceAlerts(database);
    setLastCheck(`${new Date().toLocaleTimeString()} (${count} triggered)`);
    await refreshAlerts();
  }

  // Handle live autocomplete search fetching from crypto and stock libraries.
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const delayDebounce = setTimeout(async () => {
      try {
        const query = searchQuery.trim();
        const [cryptoResult, stockResult] = await Promise.allSettled([
          searchCrypto(query),
          searchStocks(query),
        ]);

        const cryptoMatches = cryptoResult.status === 'fulfilled' ? cryptoResult.value : [];
        const stockMatches = stockResult.status === 'fulfilled' ? stockResult.value : [];
        setSuggestions(uniqueSearchAssets([...stockMatches, ...cryptoMatches]).slice(0, 10));
      } catch (err) {
        console.error('Failed to query autocomplete items:', err);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  useEffect(() => {
    refreshAlerts();
    const alertSub = database.get<PriceAlert>('price_alerts').query().observe().subscribe(refreshAlerts);

    return () => {
      alertSub.unsubscribe();
    };
  }, [database]);

  useEffect(() => {
    const prefilled = route?.params?.prefilledAsset || initialAsset;
    if (!prefilled?.id) return;

    const payload = prefilled as Partial<SearchAsset> & { ticker?: string };
    setSelectedAsset({
      id: String(payload.id),
      symbol: String(payload.symbol || payload.ticker || payload.id).toUpperCase(),
      name: String(payload.name || payload.symbol || payload.ticker || payload.id),
      type: payload.type === 'stock' ? 'stock' : 'crypto',
    });
    setSearchQuery('');
    setSuggestions([]);
    setShowDropdown(false);
    setHighlightThreshold(true);

    const focusTimer = setTimeout(() => thresholdInputRef.current?.focus(), 250);
    const highlightTimer = setTimeout(() => setHighlightThreshold(false), 1800);

    return () => {
      clearTimeout(focusTimer);
      clearTimeout(highlightTimer);
    };
  }, [initialAsset, route?.params?.prefilledAsset]);

  async function onCreateAlert() {
    const numericThreshold = Number(threshold);
    if (!selectedAsset || !Number.isFinite(numericThreshold) || numericThreshold <= 0) return;

    await configureLocalNotifications();
    
    // Pass everything down cleanly to our watch-shell handler
    await createPriceAlert(database, {
      assetId: selectedAsset.id,
      ticker: selectedAsset.symbol,
      name: selectedAsset.name,
      type: selectedAsset.type,
      direction,
      threshold: numericThreshold,
    });

    // Reset interface inputs
    setThreshold('');
    setSearchQuery('');
    setSuggestions([]);
    setSelectedAsset(null);
    await runLocalCheck();
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.panel, borderColor: theme.line }]}> 
      <Text style={[styles.title, { color: theme.text }]}>Price Alert Dispatcher</Text>
      <Text style={[styles.subtitle, { color: theme.muted }]}>Set a threshold alert for any crypto, stock, or ETF.</Text>

      {/* Autocomplete Input Section */}
      <Text style={[styles.label, { color: theme.muted }]}>Search Global Asset</Text>
      <View style={styles.searchContainer}>
        <TextInput
          value={selectedAsset ? `${selectedAsset.name} (${selectedAsset.symbol})` : searchQuery}
          onChangeText={(text) => {
            if (selectedAsset) setSelectedAsset(null); // Clear selection if typing again
            setSearchQuery(text);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder="Type e.g. AAPL, Tesla, Solana, BTC..."
          placeholderTextColor={theme.muted}
          style={[styles.input, { backgroundColor: theme.panel2, borderColor: theme.line, color: theme.text, marginTop: 0 }]}
        />

        {/* Dropdown Suggestions List */}
        {showDropdown && suggestions.length > 0 && (
          <View style={[styles.dropdown, { backgroundColor: theme.panel2, borderColor: theme.line }]}> 
            {suggestions.map((asset) => (
              <TouchableOpacity
                key={`${asset.type}-${asset.id}`}
                style={[styles.dropdownItem, { borderBottomColor: theme.line }]}
                onPress={() => {
                  setSelectedAsset(asset);
                  setShowDropdown(false);
                }}
              >
                <Text style={[styles.coinText, { color: theme.text }]}> 
                  {asset.name} <Text style={{ color: theme.muted, fontWeight: '500' }}>({asset.symbol}) · {asset.type.toUpperCase()}</Text>
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <Text style={[styles.label, { color: theme.muted, marginTop: 14 }]}>Trigger Condition</Text>
      <View style={styles.directionRow}>
        {(['ABOVE', 'BELOW'] as AlertDirection[]).map(option => (
          <TouchableOpacity
            key={option}
            onPress={() => setDirection(option)}
            style={[
              styles.directionButton,
              { backgroundColor: theme.panel2 },
              direction === option && { backgroundColor: option === 'ABOVE' ? theme.green : theme.red },
            ]}
          >
            <Text style={[styles.directionText, { color: direction === option ? '#fff' : theme.text }]}>{option}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.label, { color: theme.muted }]}>Threshold Price (USD)</Text>
      <TextInput
        ref={thresholdInputRef}
        value={threshold}
        onChangeText={setThreshold}
        keyboardType="decimal-pad"
        placeholder="e.g. 145.50"
        placeholderTextColor={theme.muted}
        style={[
          styles.input,
          { backgroundColor: theme.panel2, borderColor: highlightThreshold ? theme.blue : theme.line, color: theme.text },
          highlightThreshold && styles.highlightInput,
        ]}
      />

      <TouchableOpacity 
        style={[
          styles.primaryButton, 
          { backgroundColor: selectedAsset && threshold ? theme.blue : theme.panel2, opacity: selectedAsset && threshold ? 1 : 0.5 }
        ]} 
        onPress={onCreateAlert}
        disabled={!selectedAsset || !threshold}
      >
        <Text style={[styles.primaryButtonText, { color: selectedAsset && threshold ? '#fff' : theme.muted }]}>Create Global Alert</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.secondaryButton, { borderColor: theme.line }]} onPress={runLocalCheck}>
        <Text style={[styles.secondaryButtonText, { color: theme.text }]}>Run Local Check Now</Text>
      </TouchableOpacity>

      <Text style={[styles.lastCheck, { color: theme.muted }]}>Last check: {lastCheck}</Text>

      <Text style={[styles.activeTitle, { color: theme.text }]}>Active Alerts</Text>
      {alerts.length === 0 ? (
        <Text style={[styles.empty, { color: theme.muted }]}>No price alerts yet.</Text>
      ) : alerts.map(alert => (
        <View key={alert.id} style={[styles.alertRow, { borderBottomColor: theme.line }]}> 
          <View>
            <Text style={[styles.alertTicker, { color: theme.text }]}>{alert.ticker}</Text>
            <Text style={[styles.alertMeta, { color: theme.muted }]}> 
              {alert.direction} ${alert.threshold.toLocaleString()} · now ${alert.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            </Text>
          </View>
          <TouchableOpacity disabled={!alert.enabled} onPress={() => disablePriceAlert(database, alert.id).then(refreshAlerts)}>
            <Text style={[styles.alertStatus, { color: alert.enabled ? theme.green : theme.muted }]}> 
              {alert.enabled ? 'ON' : 'DONE'}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 20, borderWidth: 1, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '900' },
  subtitle: { fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 16 },
  label: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', marginBottom: 8, marginTop: 10 },
  searchContainer: { zIndex: 10, position: 'relative' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontWeight: '700', marginTop: 4 },
  highlightInput: { borderWidth: 2 },
  dropdown: { position: 'absolute', top: 52, left: 0, right: 0, borderWidth: 1, borderRadius: 12, zIndex: 99, elevation: 5, shadowRadius: 4, shadowOpacity: 0.1, shadowOffset: { width: 0, height: 2 } },
  dropdownItem: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1 },
  coinText: { fontSize: 14, fontWeight: '700' },
  directionRow: { flexDirection: 'row', marginBottom: 10 },
  directionButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 12, marginRight: 8 },
  directionText: { fontWeight: '900' },
  primaryButton: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  primaryButtonText: { fontWeight: '900' },
  secondaryButton: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 10, borderWidth: 1 },
  secondaryButtonText: { fontWeight: '900' },
  lastCheck: { fontSize: 12, fontWeight: '700', marginTop: 10 },
  activeTitle: { fontSize: 15, fontWeight: '900', marginTop: 22, marginBottom: 6 },
  empty: { fontSize: 13, fontWeight: '600', paddingVertical: 10 },
  alertRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  alertTicker: { fontSize: 15, fontWeight: '900' },
  alertMeta: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  alertStatus: { fontSize: 12, fontWeight: '900' },
});
