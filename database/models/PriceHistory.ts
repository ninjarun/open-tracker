// database/models/PriceHistory.ts
import { Model } from '@nozbe/watermelondb';
import { text, field, date, relation } from '@nozbe/watermelondb/decorators';
import Asset from './Asset';

export default class PriceHistory extends Model {
  static table = 'price_history';

  @relation('assets', 'asset_id') asset: any;
  @field('price') price: number;
  @date('timestamp') timestamp: Date; // Removed @readonly
}