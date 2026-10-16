import { Model } from '@nozbe/watermelondb';
import { text, date, relation, field } from '@nozbe/watermelondb/decorators';
import Asset from './Asset';

export default class Transaction extends Model {
  static table = 'transactions';

  @relation('assets', 'asset_id') asset: any;
  @text('type') type: string;
  @field('amount') amount: number;
  @field('price') price: number;
  @text('portfolio') portfolio: string; // Add this field
  // These are the missing properties
  @field('fee') fee: number;
  @date('date') date: Date;

  @date('created_at') createdAt: Date;
  @date('updated_at') updatedAt: Date;
}