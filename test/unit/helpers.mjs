// Minimal chrome.* stand-ins so storage code can run under node:test.
export function installFakeChrome() {
  const mem = { local: {}, session: {} };
  const area = (name) => ({
    async get(key) {
      if (typeof key === 'string') return { [key]: mem[name][key] };
      return { ...mem[name] };
    },
    async set(obj) {
      Object.assign(mem[name], structuredClone(obj));
    },
    async remove(key) {
      delete mem[name][key];
    },
    async clear() {
      mem[name] = {};
    },
  });
  globalThis.chrome = { storage: { local: area('local'), session: area('session') } };
  return mem;
}
