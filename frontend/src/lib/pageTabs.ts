// The open tab of a page split by <PageTabs>, kept in the address #hash.

/** The tab named in the page's #hash, if it's one of them. */
export function tabFromHash<K extends string>(keys: readonly K[]): K | undefined {
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
  return keys.find((k) => k === hash);
}

/** Puts the open tab in the address, so a reload (or a link) opens the same one, without a history entry per tab. */
export function rememberTab(key: string) {
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${encodeURIComponent(key)}`);
}
