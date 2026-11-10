const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 웹 미리보기에서는 expo-sqlite(웹 워커·wasm 필요)를 번들에서 빼고 메모리 SQLite(sql.js)를 쓴다. 안드로이드 빌드에는 영향 없음.
const original = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-sqlite') return { type: 'empty' };
  return original ? original(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
