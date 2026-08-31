import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toContain('a');
    expect(cn('a', 'b')).toContain('b');
  });

  it('lets later classes win conflicts via tailwind-merge', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('skips falsy inputs', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('resolves conditional class expressions', () => {
    expect(cn('base', true && 'on', false && 'off')).toBe('base on');
  });
});
