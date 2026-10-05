/** The extension API in either browser: Firefox's promise-based `browser`, else Chrome's `chrome` (MV3 returns promises too). */
export const api = globalThis.browser || globalThis.chrome;
/** Firefox (MV2, persistent background page) vs Chrome (MV3 service worker). */
export const FIREFOX = typeof globalThis.browser !== 'undefined' && !!globalThis.browser.runtime.getBrowserInfo;
