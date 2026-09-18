const ts = () => new Date().toISOString();

export const log = {
  info: (...a) => console.log(ts(), 'INFO ', ...a),
  warn: (...a) => console.warn(ts(), 'WARN ', ...a),
  error: (...a) => console.error(ts(), 'ERROR', ...a),
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randomBetween = (min, max) => min + Math.random() * (max - min);
