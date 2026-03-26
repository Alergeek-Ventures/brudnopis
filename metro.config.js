const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

config.transformer.minifierConfig = {
  compress: {
    drop_console: ['debug', 'log', 'info'],
  },
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/types/uniwind-types.d.ts',
});
