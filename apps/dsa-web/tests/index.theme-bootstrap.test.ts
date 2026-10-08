// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('index.html theme bootstrap', () => {
  it.each([
    [null, true, 'light'],
    ['invalid', true, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
  ])('resolves stored %s before React mounts (system dark: %s)', (stored, systemDark, expected) => {
    const indexHtml = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');
    const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    const classes = new Set(['light', 'dark']);
    const root = {
      classList: { remove: (...values: string[]) => values.forEach(value => classes.delete(value)), add: (value: string) => classes.add(value) },
      style: { colorScheme: '' },
    };
    runInNewContext(script!, {
      document: { documentElement: root },
      localStorage: { getItem: (key: string) => key === 'theme' ? stored : null },
      window: { matchMedia: () => ({ matches: systemDark }) },
    });
    expect([...classes]).toEqual([expected]);
    expect(root.style.colorScheme).toBe(expected);
  });
});
