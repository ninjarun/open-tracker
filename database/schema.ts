import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const mySchema = appSchema({
  version: 2,
  tables: [
    tableSchema({
      name: 'assets',
      columns: [
        { name: 'ticker', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'transactions',
      columns: [
        { name: 'asset_id', type: 'string', isIndexed: true },
        { name: 'type', type: 'string' },
        { name: 'amount', type: 'number' },
        { name: 'price', type: 'number' },
        { name: 'fee', type: 'number' },
        { name: 'date', type: 'number', isIndexed: true },
        { name: 'portfolio', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'price_history',
      columns: [
        { name: 'asset_id', type: 'string', isIndexed: true },
        { name: 'price', type: 'number' },
        { name: 'timestamp', type: 'number', isIndexed: true },
      ],
    }),
    tableSchema({
      name: 'price_alerts',
      columns: [
        { name: 'asset_id', type: 'string', isIndexed: true },
        { name: 'direction', type: 'string' }, // "ABOVE" | "BELOW"
        { name: 'threshold', type: 'number' },
        { name: 'enabled', type: 'boolean' },
        { name: 'triggered_at', type: 'number', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
