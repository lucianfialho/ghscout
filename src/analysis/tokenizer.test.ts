import { describe, it, expect } from 'vitest';
import { tokenize, extractBigrams, tokenizeTitle } from './tokenizer.js';

describe('tokenize', () => {
  it('removes stopwords', () => {
    const tokens = tokenize('the auth middleware is broken and it crashes');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('is');
    expect(tokens).not.toContain('and');
    expect(tokens).not.toContain('it');
    expect(tokens).toContain('auth');
    expect(tokens).toContain('middleware');
    expect(tokens).toContain('broken');
    expect(tokens).toContain('crashes');
  });

  it('removes GitHub-specific stopwords', () => {
    const tokens = tokenize('please fix this bug in the version update');
    expect(tokens).not.toContain('please');
    expect(tokens).not.toContain('fix');
    expect(tokens).not.toContain('bug');
    expect(tokens).not.toContain('version');
    expect(tokens).not.toContain('update');
  });

  it('lowercases everything', () => {
    const tokens = tokenize('TypeError Cannot Read Property');
    tokens.forEach((t) => {
      expect(t).toBe(t.toLowerCase());
    });
    expect(tokens).toContain('typeerror');
    expect(tokens).toContain('cannot');
    expect(tokens).toContain('read');
    expect(tokens).toContain('property');
  });

  it('handles empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles string with only special characters', () => {
    expect(tokenize('!@#$%^&*()')).toEqual([]);
  });

  it('handles string with only stopwords', () => {
    expect(tokenize('the is at which on a an')).toEqual([]);
  });

  it('keeps hyphens in tokens', () => {
    const tokens = tokenize('dark-mode support server-side rendering');
    expect(tokens).toContain('dark-mode');
    expect(tokens).toContain('server-side');
    expect(tokens).toContain('rendering');
  });

  it('removes punctuation but keeps alphanumeric', () => {
    const tokens = tokenize("TypeError: Cannot read property 'id' of undefined");
    expect(tokens).toContain('typeerror');
    expect(tokens).toContain('cannot');
    expect(tokens).toContain('read');
    expect(tokens).toContain('property');
    expect(tokens).toContain('id'); // 2 chars, passes filter
    expect(tokens).not.toContain('undefined'); // filtered as GitHub stopword
  });
});

describe('extractBigrams', () => {
  it('produces correct consecutive pairs', () => {
    const bigrams = extractBigrams(['auth', 'middleware', 'broken']);
    expect(bigrams).toEqual(['auth middleware', 'middleware broken']);
  });

  it('returns empty array for single token', () => {
    expect(extractBigrams(['auth'])).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(extractBigrams([])).toEqual([]);
  });

  it('produces single bigram for two tokens', () => {
    const bigrams = extractBigrams(['dark-mode', 'dashboard']);
    expect(bigrams).toEqual(['dark-mode dashboard']);
  });
});

describe('tokenizeTitle', () => {
  it('strips [Bug] prefix', () => {
    const tokens = tokenizeTitle('[Bug] Auth middleware crashes on expired tokens');
    expect(tokens).toContain('auth');
    expect(tokens).toContain('middleware');
    expect(tokens).toContain('crashes');
    expect(tokens).toContain('expired');
    expect(tokens).toContain('tokens');
    // Should not contain stopwords
    expect(tokens).not.toContain('on');
  });

  it('strips [Feature] prefix', () => {
    const tokens = tokenizeTitle('[Feature] Add dark mode support for dashboard');
    expect(tokens).toContain('dark');
    expect(tokens).toContain('mode');
    expect(tokens).toContain('dashboard');
  });

  it('strips feat: prefix', () => {
    const tokens = tokenizeTitle('feat: Add dark mode support for dashboard');
    expect(tokens).toContain('dark');
    expect(tokens).toContain('mode');
    expect(tokens).toContain('dashboard');
  });

  it('strips fix: prefix', () => {
    const tokens = tokenizeTitle('fix: resolve memory leak in connection pool');
    expect(tokens).toContain('resolve');
    expect(tokens).toContain('memory');
    expect(tokens).toContain('leak');
    expect(tokens).toContain('connection');
    expect(tokens).toContain('pool');
  });

  it('strips bug: prefix', () => {
    const tokens = tokenizeTitle('bug: server crashes on startup');
    expect(tokens).toContain('server');
    expect(tokens).toContain('crashes');
    expect(tokens).toContain('startup');
  });

  it('strips chore: prefix', () => {
    const tokens = tokenizeTitle('chore: bump dependencies');
    expect(tokens).toContain('bump');
    expect(tokens).toContain('dependencies');
  });

  it('handles title without prefix normally', () => {
    const tokens = tokenizeTitle("TypeError: Cannot read property 'id' of undefined");
    expect(tokens).toContain('typeerror');
    expect(tokens).toContain('cannot');
    expect(tokens).toContain('read');
    expect(tokens).toContain('property');
    expect(tokens).not.toContain('undefined'); // filtered as GitHub stopword
  });
});
