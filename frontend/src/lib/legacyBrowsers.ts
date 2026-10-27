// Shop tills don't always get browser updates: the Posiflex terminals run Edge 92
// (2021). The build lowers newer syntax for them (build.target in vite.config.ts);
// these fill in the two newer built-ins the charts library calls.

if (!Object.hasOwn) {
  Object.defineProperty(Object, 'hasOwn', {
    value: (obj: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, key),
    configurable: true,
    writable: true,
  });
}

if (typeof globalThis.structuredClone !== 'function') {
  // The charts only hand it plain data, or an Error to copy.
  globalThis.structuredClone = ((value: unknown) => (value instanceof Error
    ? Object.assign(Object.create(Object.getPrototypeOf(value)), value)
    : JSON.parse(JSON.stringify(value)))) as typeof structuredClone;
}

export {};
