const path = require('path');
const webpack = require('webpack');
const HandlebarsPlugin = require('handlebars-webpack-plugin');
const songBrowserConfig = require('./song-browser-config.json');
const packageJson = require('./package.json');

require('dotenv').config();

const handlebarsHelpers = {
  eq: (one, other) => one === other,
  upperCaseFirst: (string) => `${string[0].toUpperCase()}${string.substring(1)}`,
};

module.exports = (env) => ({
  resolve: {
    alias: {
      handlebars: 'handlebars/dist/handlebars.js',
    },
  },
  mode: env?.production ? 'production' : 'development',
  entry: './src/song-browser/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
  },
  plugins: [
    new webpack.EnvironmentPlugin({
      GOOGLE_OAUTH_CLIENT_ID: '',
    }),
    new HandlebarsPlugin({
      entry: path.join(process.cwd(), 'src', 'song-browser', 'index.hbs'),
      output: path.join(path.resolve(__dirname, 'dist'), 'index.html'),
      data: {
        config: songBrowserConfig,
        package: packageJson,
        bundlePath: 'bundle.js',
      },
      helpers: handlebarsHelpers,
    }),
  ],
  module: {
    rules: [
      {
        test: /\.s[ac]ss$/i,
        use: [
          'style-loader',
          'css-loader',
          'sass-loader',
        ],
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  devServer: {
    static: {
      directory: __dirname,
    },
    compress: true,
    port: 9000,
    proxy: [
      {
        context: ['/api'],
        target: 'http://localhost:3001',
      },
    ],
  },
});
