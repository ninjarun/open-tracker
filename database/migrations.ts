import { schemaMigrations, createTable } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        createTable({
          name: 'price_alerts',
          columns: [
            { name: 'asset_id', type: 'string', isIndexed: true },
            { name: 'direction', type: 'string' },
            { name: 'threshold', type: 'number' },
            { name: 'enabled', type: 'boolean' },
            { name: 'triggered_at', type: 'number', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
  ],
});
