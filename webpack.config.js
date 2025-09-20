const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'development',
  entry: './lib/browser/browser-entry.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'webdvcs-browser.js',
    library: 'WebDVCS',
    libraryTarget: 'umd',
    globalObject: 'this'
  },
  resolve: {
    fallback: {
      "fs": false,
      "path": require.resolve("path-browserify"),
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "buffer": require.resolve("buffer"),
      "zlib": require.resolve("browserify-zlib"),
      "vm": require.resolve("vm-browserify"),
      "util": require.resolve("util/"),
      "assert": require.resolve("assert/"),
      "process": require.resolve("process/browser"),
      "better-sqlite3": false // Disable Node.js SQLite since we use sql.js
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development')
    }),
    // Ignore the better-sqlite3 require to eliminate warning
    new webpack.IgnorePlugin({
      resourceRegExp: /^better-sqlite3$/
    })
  ],
  module: {
    // Prevent webpack from parsing better-sqlite3
    noParse: /better-sqlite3/
  }
};