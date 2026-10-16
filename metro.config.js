// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Tell the bundler to substitute better-sqlite3 with an empty module on the web
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'better-sqlite3': config.resolver.emptyModulePath,
};

module.exports = config;