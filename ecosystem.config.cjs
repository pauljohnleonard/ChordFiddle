module.exports = {
  apps: [
    {
      name: 'chordfiddle',
      cwd: __dirname,
      script: 'server/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      time: true,
      env: {
        NODE_ENV: 'production',
        // `server/index.js` loads `.env` itself (dotenv), so PORT can live there.
      },
    },
  ],
};

