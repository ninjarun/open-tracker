import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useDatabase } from '@nozbe/watermelondb/hooks';
import { Asset, Transaction } from '../../database/models';
import { Q } from '@nozbe/watermelondb';

export function AddTransaction() {
  const database = useDatabase(); // Safely pulls the unlocked DB from context
  
  const [ticker, setTicker] = useState('');
  const [type, setType] = useState('BUY'); 
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');

  const handleAddTransaction = async () => {
    if (!ticker || !amount || !price) {
      Alert.alert('Error', 'Please fill out all fields.');
      return;
    }

    try {
      await database.write(async () => {
        const assetCollection = database.get<Asset>('assets');
        const txCollection = database.get<Transaction>('transactions');

        const existingAssets = await assetCollection.query(
          Q.where('ticker', ticker.toUpperCase())
        ).fetch();

        let targetAsset = existingAssets[0];

        if (!targetAsset) {
          targetAsset = await assetCollection.create(asset => {
            asset.ticker = ticker.toUpperCase();
            asset.name = ticker.toUpperCase();
            asset.type = 'crypto';
          });
        }

        await txCollection.create(tx => {
          tx.asset.set(targetAsset);
          tx.type = type;
          tx.amount = parseFloat(amount);
          tx.price = parseFloat(price);
          tx.fee = 0;
          tx.date = new Date();
        });
        
      });

      Alert.alert('Success', 'Transaction saved to secure vault.');
      setAmount('');
      setPrice('');
    } catch (error) {
      console.error('Failed to save transaction:', error);
      Alert.alert('Database Error', 'Could not save transaction.');
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Log Transaction</Text>
      <TextInput 
        style={styles.input} 
        placeholder="Ticker (e.g., BTC, ADA)" 
        placeholderTextColor="#666"
        value={ticker} 
        onChangeText={setTicker} 
        autoCapitalize="characters"
      />
      <View style={styles.row}>
        <TouchableOpacity style={[styles.typeButton, type === 'BUY' && styles.activeBuy]} onPress={() => setType('BUY')}>
          <Text style={styles.typeText}>BUY</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.typeButton, type === 'SELL' && styles.activeSell]} onPress={() => setType('SELL')}>
          <Text style={styles.typeText}>SELL</Text>
        </TouchableOpacity>
      </View>
      <TextInput 
        style={styles.input} 
        placeholder="Amount of tokens" 
        placeholderTextColor="#666"
        value={amount} 
        onChangeText={setAmount} 
        keyboardType="numeric"
      />
      <TextInput 
        style={styles.input} 
        placeholder="Price per token ($)" 
        placeholderTextColor="#666"
        value={price} 
        onChangeText={setPrice} 
        keyboardType="numeric"
      />
      <TouchableOpacity style={styles.submitButton} onPress={handleAddTransaction}>
        <Text style={styles.submitText}>Save to Vault</Text>
      </TouchableOpacity>
    </View>
  );
}


const styles = StyleSheet.create({
  card: { padding: 20, backgroundColor: '#1e1e1e', borderRadius: 12, marginBottom: 20 },
  title: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 15 },
  input: { backgroundColor: '#2c2c2c', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  typeButton: { flex: 1, padding: 12, alignItems: 'center', backgroundColor: '#2c2c2c', marginHorizontal: 5, borderRadius: 8 },
  activeBuy: { backgroundColor: '#00cc66' },
  activeSell: { backgroundColor: '#ff4d4d' },
  typeText: { color: '#fff', fontWeight: 'bold' },
  submitButton: { backgroundColor: '#00ffcc', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
  submitText: { color: '#000', fontWeight: 'bold', fontSize: 16 }
});