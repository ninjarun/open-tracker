// database/index.ts
import { Database } from '@nozbe/watermelondb';
import { Platform } from 'react-native';
import { modelClasses } from './models'; // ONLY import from models
import { getAdapter } from './adapter';  // This picks up .web or .ts

let database: Database | null = null;

export async function initializeDatabase(): Promise<Database> {
  if (database) return database;

  // Adapter is handled by the platform-specific file
  const adapter = getAdapter();

  database = new Database({
    adapter,
    modelClasses,
  });

  return database;
}

export { database };