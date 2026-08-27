import { describe, test, expect } from 'bun:test';
import { shopifyHandleFromThemeExport, resolveShopifyStore } from '../../../lib/opsConsole';

describe('shopifyHandleFromThemeExport', () => {
  test('parses the real myshopify handle from theme_export folder names', () => {
    // The subdomain can contain literal dashes — only the fixed -myshopify-com
    // marker collapses back to .myshopify.com.
    expect(shopifyHandleFromThemeExport(
      '/x/theme_export__j1wxtd-1w-myshopify-com-horizon__24JUN2026-0439pm',
    )).toBe('j1wxtd-1w.myshopify.com');

    expect(shopifyHandleFromThemeExport(
      '/x/theme_export__joon-distribution-myshopify-com-trade__16MAR2026-0117pm',
    )).toBe('joon-distribution.myshopify.com');

    expect(shopifyHandleFromThemeExport(
      '/x/theme_export__runitbackclassics-myshopify-com-horizon__27APR2026-1023am',
    )).toBe('runitbackclassics.myshopify.com');

    expect(shopifyHandleFromThemeExport(
      '/x/theme_export__2n99u1-x8-myshopify-com-horizon__03JUL2026-1141am',
    )).toBe('2n99u1-x8.myshopify.com');
  });

  test('returns null for non theme_export folders', () => {
    expect(shopifyHandleFromThemeExport('/x/some-workdir')).toBeNull();
    expect(shopifyHandleFromThemeExport('/x/theme')).toBeNull();
    expect(shopifyHandleFromThemeExport('/x/theme_export__no-marker-here')).toBeNull();
  });
});

describe('resolveShopifyStore', () => {
  test('prefers the theme_export handle over the profile URL', () => {
    // Profile URL is the stale/dashed handle; folder is ground truth.
    expect(resolveShopifyStore(
      '/x/theme_export__runitbackclassics-myshopify-com-horizon__27APR2026-1023am',
      'https://run-it-back-classics.myshopify.com/',
    )).toBe('runitbackclassics.myshopify.com');
  });

  test('falls back to the normalized profile URL when there is no theme export', () => {
    expect(resolveShopifyStore('/x/kilowash', 'https://adophies.com/')).toBe('adophies.com');
    expect(resolveShopifyStore('/x/kilowash', '')).toBe('');
  });
});
