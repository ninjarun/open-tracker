import { Model } from '@nozbe/watermelondb';
import { date, field, relation, text } from '@nozbe/watermelondb/decorators';

export default class PriceAlert extends Model {
  static table = 'price_alerts';

  @relation('assets', 'asset_id') asset: any;
  @text('direction') direction: 'ABOVE' | 'BELOW';
  @field('threshold') threshold: number;
  @field('enabled') enabled: boolean;
  @date('triggered_at') triggeredAt?: Date;

  @date('created_at') createdAt: Date;
  @date('updated_at') updatedAt: Date;
}
