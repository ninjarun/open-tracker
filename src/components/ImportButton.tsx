import React from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import Papa from 'papaparse';
import { useDatabase } from '@nozbe/watermelondb/hooks';
import Asset from '../../database/models/Asset';
import Transaction from '../../database/models/Transaction';
import { Q } from '@nozbe/watermelondb';

export const ImportButton = () => {
  const database = useDatabase();

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'text/csv' });
      if (result.canceled) return;

      const file = result.assets[0];
      // Option A: Use the filename (without extension) as the portfolio tag
      const portfolioName = file.name.replace('.csv', '').trim();
      
      const response = await fetch(file.uri);
      const csvText = await response.text();

      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors.length > 0) {
            Alert.alert("Error", "CSV parsing failed.");
          } else {
            processData(results.data as any[], portfolioName);
          }
        }
      });
    } catch (err) {
      Alert.alert("Import Error", "Could not read the file.");
    }
  };

  const processData = async (rows: any[], portfolioName: string) => {
    try {
      // 1. Fetch all existing assets into a memory dictionary FIRST
      const existingAssets = await database.get<Asset>('assets').query().fetch();
      const assetMap = new Map<string, Asset>();
      existingAssets.forEach(a => assetMap.set(a.ticker, a));

      // 2. Queue up all database operations safely
      const operations: any[] = [];

      for (const row of rows) {
        // Handle varying column names across your files
        // const tickerRaw = (row['Base currency (name)'] || row['Asset'] || 'UNKNOWN').trim();
        // const amount = parseFloat(row['Base amount'] || row['Amount'] || 0);
        // const quote = parseFloat(row['Quote amount'] || row['Cost (USD)'] || 0);
        // const action = (row['Way'] || row['Action'] || 'BUY').toUpperCase();
        
        const tickerRaw = (row['Asset'] || row['Base currency (name)'] || 'UNKNOWN').trim();
        const amount = parseFloat(row['Amount'] || row['Base amount'] || 0);
        const quote = parseFloat(row['Cost (USD)'] || row['Quote amount'] || 0);
        const action = (row['Way'] || row['Action'] || 'BUY').toUpperCase();
        // ----------------------------

        if (tickerRaw === 'UNKNOWN' || isNaN(amount)) continue;

        const ticker = tickerRaw.split(' ')[0].toUpperCase();

        // 3. Check memory map instead of querying the database
        let asset = assetMap.get(ticker);

        if (!asset) {
          // Prepare new asset, but don't save it yet
          asset = database.get<Asset>('assets').prepareCreate(a => {
            a.ticker = ticker;
            a.name = tickerRaw;
            a.type = 'crypto';
          });
          // Add it to our memory map so the next row knows it exists!
          assetMap.set(ticker, asset);
          operations.push(asset);
        }

        // 4. Prepare transaction
        const tx = database.get<Transaction>('transactions').prepareCreate(t => {
          t.asset.set(asset);
          t.type = action;
          t.amount = amount;
          t.price = amount > 0 ? quote / amount : 0;
          t.portfolio = portfolioName;
          t.fee = parseFloat(row['Fee amount'] || 0);
          t.date = new Date(row['Date'] || new Date());
        });
        
        operations.push(tx);
      }

      // 5. Execute everything in one massive, lightning-fast atomic batch!
      await database.write(async () => {
        await database.batch(...operations);
      });

      Alert.alert("Success", `Imported ${operations.length} records into: ${portfolioName}`);
    } catch (dbError) {
      console.error("Critical database write error:", dbError);
      Alert.alert("Import Error", "Database write failed. Check console for details.");
    }
  };

  return (
    <TouchableOpacity style={styles.button} onPress={handleImport}>
      <Text style={styles.text}>Import CSV Portfolio</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: { backgroundColor: '#6aa8ff', padding: 12, borderRadius: 12, alignItems: 'center', marginHorizontal: 5 },
  text: { color: '#fff', fontWeight: 'bold' }
});