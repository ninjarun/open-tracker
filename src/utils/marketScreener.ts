export type MarketType = 'crypto' | 'stock' | 'commodity' | 'fiat';

export type ScreenerAsset = {
  assetId: string;
  ticker: string;
  name: string;
  type: MarketType;
  currentPrice: number;
  price24hAgo: number;
  change24h: number;
  changePercent24h: number;
};

export type MarketGroup = {
  gainers: ScreenerAsset[];
  losers: ScreenerAsset[];
  all: ScreenerAsset[];
};

export type GlobalMarketScreener = {
  crypto: MarketGroup;
  stocks: MarketGroup;
  commodities: MarketGroup;
  fiat: MarketGroup;
};

export async function buildGlobalMarketScreener(): Promise<GlobalMarketScreener> {
  let liveAssets: ScreenerAsset[] = [];

  try {
    // Fetch top 100 live digital market assets directly from CoinGecko API
    const response = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h'
    );
    const data = await response.json();
    
    if (Array.isArray(data)) {
      liveAssets = data.map((coin: any) => {
        const currentPrice = coin.current_price || 0;
        const changePercent24h = coin.price_change_percentage_24h || 0;
        const price24hAgo = currentPrice / (1 + changePercent24h / 100);
        
        return {
          assetId: coin.id,
          ticker: coin.symbol.toUpperCase(),
          name: coin.name,
          type: 'crypto', // Driven purely by live API data
          currentPrice,
          price24hAgo,
          change24h: currentPrice - price24hAgo,
          changePercent24h,
        };
      });
    }
  } catch (error) {
    console.error('API Market Fetch Error:', error);
    // Returns empty collections instead of fake data if offline or rate-limited
  }

  // Segmenting the actual live API data streams safely
  const sortAssets = (assets: ScreenerAsset[], order: 'desc' | 'asc') => {
    return [...assets].sort((a, b) => 
      order === 'desc' ? b.changePercent24h - a.changePercent24h : a.changePercent24h - b.changePercent24h
    );
  };

  return {
    crypto: {
      gainers: sortAssets(liveAssets, 'desc').slice(0, 6),
      losers: sortAssets(liveAssets, 'asc').slice(0, 6),
      all: liveAssets,
    },
    // Traditional markets remain structurally supported but empty until a non-crypto API endpoint is provided
    stocks: { gainers: [], losers: [], all: [] },
    commodities: { gainers: [], losers: [], all: [] },
    fiat: { gainers: [], losers: [], all: [] },
  };
}