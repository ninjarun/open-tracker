import { Model } from '@nozbe/watermelondb';
import { text, date, children } from '@nozbe/watermelondb/decorators';

export default class Asset extends Model {
  static table = 'assets';

  @text('ticker') ticker: string;
  @text('name') name: string;
  @text('type') type: string; // "crypto" | "stock" | "fiat"
  
  @date('created_at') createdAt: Date;
  @date('updated_at') updatedAt: Date;

  @children('transactions') transactions: any;
  @children('price_history') priceHistory: any;
  @children('price_alerts') priceAlerts: any;
}