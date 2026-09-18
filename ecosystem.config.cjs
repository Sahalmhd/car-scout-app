module.exports = {
  apps: [
    {
      name: 'car-scout',
      script: 'src/index.js',
      max_memory_restart: '300M',
      out_file: 'logs/out.log',
      error_file: 'logs/err.log',
      time: true,
    },
  ],
};
