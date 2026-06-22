const path = require('path');
const webpack = require('webpack');
const HandlebarsPlugin = require('handlebars-webpack-plugin');
const mergeJSON = require('handlebars-webpack-plugin/utils/mergeJSON');
const exampleChordProSheet = require('./example_chord_pro_sheet');

require('dotenv').config();

const projectData = mergeJSON(path.join(__dirname, '{config,package}.json'));
const songBrowserConfig = require('./song-browser-config.json');
const packageJson = require('./package.json');

const handlebarsHelpers = {
  eq: (one, other) => one === other,
  upperCaseFirst: (string) => `${string[0].toUpperCase()}${string.substring(1)}`,
  partialPath: ({ type }) => `templates/${type}`,
  attributeKey: (parent, key) => [parent, key].filter((k) => k).join('.'),
  or: (...items) => items.find((item) => item),
};

module.exports = (env) => ({
  resolve: {
    alias: {
      handlebars: 'handlebars/dist/handlebars.js',
    },
  },
  mode: 'development',
  entry: {
    bundle: './src/index.js',
    'song-browser-bundle': './src/song-browser/index.js',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
  },
  plugins: [
    new webpack.EnvironmentPlugin({
      GOOGLE_OAUTH_CLIENT_ID: '',
    }),
    new HandlebarsPlugin({
      entry: path.join(process.cwd(), 'src', 'index.hbs'),
      output: path.join(path.resolve(__dirname, 'dist'), 'index.html'),
      partials: [
        path.join(process.cwd(), 'src', 'templates', '*.hbs'),
      ],
      data: {
        ...projectData,
        example_chord_pro_sheet: exampleChordProSheet,
        bundlePath: 'bundle.js',
      },
      helpers: handlebarsHelpers,
    }),
    new HandlebarsPlugin({
      entry: path.join(process.cwd(), 'src', 'song-browser', 'index.hbs'),
      output: path.join(path.resolve(__dirname, 'dist'), 'song-browser.html'),
      data: {
        config: songBrowserConfig,
        package: packageJson,
        bundlePath: 'song-browser-bundle.js',
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
