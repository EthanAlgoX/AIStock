/** Clear app-owned private drafts, without touching unrelated browser storage. */
export function clearPrivateWorkspaceStorage() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key && /^(dsa[._-]|investcrew[._-])/i.test(key)
          && !['dsa.uiLanguage', 'dsa.theme', 'investcrew.activeIdentity'].includes(key)) {
        storage.removeItem(key);
      }
    }
  }
}
