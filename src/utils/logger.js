export function createLogger(scope) {
  return {
    info: (...args) => console.info(`[${scope}]`, ...args),
    warn: (...args) => console.warn(`[${scope}]`, ...args),
    error: (...args) => console.error(`[${scope}]`, ...args)
  };
}