// database/adapter.ts
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { mySchema } from './schema';

export const getAdapter = () => {
  return new SQLiteAdapter({
    schema: mySchema,
    dbName: 'local_secure_vault',
    jsi: true, 
  });
};