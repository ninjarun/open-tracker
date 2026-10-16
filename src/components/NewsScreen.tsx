import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, StyleSheet, ActivityIndicator, ScrollView, 
  TouchableOpacity, Linking, SafeAreaView, Image, RefreshControl 
} from 'react-native';
import * as rssParser from 'react-native-rss-parser';

export const NewsScreen = ({ currentTheme }: any) => {
  const [newsArticles, setNewsArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNews = async () => {
    try {
      const response = await fetch('https://cointelegraph.com/rss');
      const text = await response.text();
      const rss = await rssParser.parse(text);
      setNewsArticles(rss.items);
    } catch (e) {
      console.error("Fetch failed:", e);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchNews();
    setRefreshing(false);
  };

  useEffect(() => {
    // Initial Load
    setLoading(true);
    fetchNews().finally(() => setLoading(false));

    // Auto-Refresh every 60 seconds
    const interval = setInterval(() => {
      fetchNews();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.bg }]}>
      <Text style={[styles.header, { color: currentTheme.text }]}>Market Pulse</Text>
      
      {loading ? (
        <ActivityIndicator size="large" color={currentTheme.blue} style={{ marginTop: 50 }} />
      ) : (
        <ScrollView 
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={currentTheme.text} />}
        >
          {newsArticles.map((article, i) => {
            const imageUrl = article.enclosures && article.enclosures[0] ? article.enclosures[0].url : null;
            return (
              <TouchableOpacity 
                key={i} 
                style={[styles.card, { backgroundColor: currentTheme.panel, borderColor: currentTheme.line }]}
                onPress={() => Linking.openURL(article.links[0].url)}
              >
                {imageUrl && <Image source={{ uri: imageUrl }} style={styles.image} />}
                <View style={styles.content}>
                  <Text style={[styles.title, { color: currentTheme.text }]}>{article.title}</Text>
                  <Text style={[styles.date, { color: currentTheme.muted }]}>{formatDate(article.published)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { fontSize: 28, fontWeight: '800', padding: 24 },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  card: { borderRadius: 16, marginBottom: 20, overflow: 'hidden', borderWidth: 1 },
  image: { width: '100%', height: 180 },
  content: { padding: 16 },
  title: { fontSize: 18, fontWeight: '700', lineHeight: 24, marginBottom: 8 },
  date: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' }
});