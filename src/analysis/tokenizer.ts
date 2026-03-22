const ENGLISH_STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in',
  'with', 'to', 'for', 'of', 'from', 'by', 'as', 'it', 'this', 'that',
  'be', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'can', 'shall', 'not', 'no', 'so', 'if', 'when', 'how', 'what', 'where',
  'who', 'why', 'up', 'out', 'about', 'into', 'over', 'after', 'before',
  'between', 'under', 'above', 'each', 'few', 'more', 'most', 'some',
  'such', 'only', 'same', 'than', 'too', 'very', 'just', 'also', 'its',
  'his', 'her', 'their', 'our', 'your', 'i', 'we', 'you', 'they', 'he',
  'she', 'me', 'my', 'them', 'us', 'all', 'any', 'both', 'other', 'these',
  'those',
]);

const GITHUB_STOPWORDS = new Set([
  'issue', 'bug', 'fix', 'error', 'please', 'using', 'version', 'feature',
  'request', 'support', 'add', 'update', 'get', 'set', 'use', 'new', 'like',
  'need', 'want', 'work', 'make', 'run', 'try', 'way', 'one', 'two', 'see',
  'sure', 'could', 'would', 'still', 'able', 'instead', 'related', 'seems',
  'etc', 'next', 'js', 'ts', 'app', 'file', 'page', 'component', 'module',
  'expected', 'actual', 'behavior', 'undefined', 'null', 'type', 'return',
  'function', 'class', 'import', 'export', 'default', 'config', 'build',
  'doesn', 'don', 'isn', 'wasn', 'won', 'shouldn', 'couldn', 'hasn',
  'working', 'works', 'happen', 'happens', 'happening', 'started', 'start',
  'react', 'vue', 'svelte', 'angular', 'node', 'webpack', 'vite',
  'allow', 'unable', 'enable', 'disable', 'enh', 'feat', 'enhancement',
  'should', 'must', 'when', 'after', 'while', 'during', 'possible',
  'example', 'change', 'changes', 'move', 'create', 'remove', 'show',
  'hide', 'open', 'close', 'option', 'options', 'setting', 'settings',
]);

const STOPWORDS = new Set([...ENGLISH_STOPWORDS, ...GITHUB_STOPWORDS]);

const TITLE_PREFIX_RE = /^\s*(\[[\w\s]+\]\s*|(?:feat|fix|bug|chore|docs|refactor|perf|test|ci|build|style):\s*)/i;

/**
 * Tokenize text: lowercase, remove punctuation (keep alphanumeric + hyphens),
 * split on whitespace, remove stopwords.
 */
export function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  return cleaned
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

/**
 * Extract bigrams (consecutive token pairs) from a token array.
 */
export function extractBigrams(tokens: string[]): string[] {
  if (tokens.length < 2) return [];

  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

/**
 * Tokenize an issue title: strip common prefixes like [Bug], feat:, etc.,
 * then tokenize normally.
 */
export function tokenizeTitle(title: string): string[] {
  const stripped = title.replace(TITLE_PREFIX_RE, '');
  return tokenize(stripped);
}
