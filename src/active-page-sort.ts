import type { PageSortFile, PageSortFileFactory, PageSortFileFactoryArgs, PageSortSettingsEntry } from "./types.js";
import { BUMP_LIMIT_OPTION, NO_BUMP_KEYWORDS_OPTION, bumpTimestamp, isNoBumpContent, parseBumpLimit, splitKeywords } from "./no-bump.js";

/** The wire key: this sort publishes under `community.posts.pages.active` / `pageCids.active`, like the built-in it replaces. */
export const SORT_NAME = "active";

export const DESCRIPTION =
  "Bump order where a reply whose content has a line equal to a configured keyword does not bump its thread, with an optional bump limit";

export const MAX_KEYWORDS = 64;
export const MAX_KEYWORD_LENGTH = 128;

export const optionInputs: NonNullable<PageSortFile["optionInputs"]> = [
  {
    option: NO_BUMP_KEYWORDS_OPTION,
    label: "No-bump keywords",
    description:
      "Comma-separated. A reply whose content has a whole line equal to one of these does not bump its thread (exact, case-sensitive). Leave unset for plain bump order.",
    placeholder: "sage"
  },
  {
    option: BUMP_LIMIT_OPTION,
    label: "Bump limit",
    description:
      "A positive integer. Only a thread's first this many replies, saged or not, can bump it; past the limit it sinks while staying open. Leave unset for no limit.",
    placeholder: "300"
  }
];

const keywordsOf = (pageSortSettings: PageSortSettingsEntry): string[] => splitKeywords(pageSortSettings.options?.[NO_BUMP_KEYWORDS_OPTION]);

/**
 * Sync, runs on every community start and every settings edit. Rejects an entry whose option is set but
 * cannot match anything, which would silently turn the board into plain bump order.
 */
export const validatePageSortSettings = ({ pageSortSettings }: { pageSortSettings: PageSortSettingsEntry }): void => {
  const rawLimit = pageSortSettings.options?.[BUMP_LIMIT_OPTION];
  if (rawLimit !== undefined && parseBumpLimit(rawLimit) === undefined)
    throw new Error(`${BUMP_LIMIT_OPTION} must be a positive integer, got "${rawLimit.slice(0, 32)}": unset it for no limit`);
  const raw = pageSortSettings.options?.[NO_BUMP_KEYWORDS_OPTION];
  if (raw === undefined) return;
  const keywords = splitKeywords(raw);
  if (keywords.length === 0) throw new Error(`${NO_BUMP_KEYWORDS_OPTION} is set but holds no keyword: unset it for plain bump order`);
  if (keywords.length > MAX_KEYWORDS) throw new Error(`${NO_BUMP_KEYWORDS_OPTION} lists ${keywords.length} keywords, the maximum is ${MAX_KEYWORDS}`);
  for (const keyword of keywords) {
    if (keyword.length > MAX_KEYWORD_LENGTH)
      throw new Error(`${NO_BUMP_KEYWORDS_OPTION} keyword "${keyword.slice(0, 16)}..." is ${keyword.length} chars, the maximum is ${MAX_KEYWORD_LENGTH}`);
    if (/[\r\n]/.test(keyword)) throw new Error(`${NO_BUMP_KEYWORDS_OPTION} keyword contains a line break and can never match a line`);
  }
};

/**
 * The page sort file factory. pkc-js calls it once per community start and per settings edit with the
 * `settings.pages.posts[i]` entry, and caches the result. Register it under `pageSorts` in the PKC options
 * (or install it with bitsocial-cli) and name it in `settings.pages`, or point a `path:` entry at this
 * package's `dist/index.js`.
 */
export const activePageSort: PageSortFileFactory = ({ pageSortSettings }: PageSortFileFactoryArgs): PageSortFile => {
  const keywords = keywordsOf(pageSortSettings);
  const bumpLimit = parseBumpLimit(pageSortSettings.options?.[BUMP_LIMIT_OPTION]);
  return {
    sortName: SORT_NAME,
    description: DESCRIPTION,
    scope: "posts",
    requireReplies: true,
    optionInputs,
    defaultOptions: {},
    // MAX(timestamp) over the post and its counted, non-no-bump descendants. pkc-js hands `replies` as one flat
    // list of every descendant, tombstones and pending replies included (pkc-js#407), and so does a client's walk
    // of the reply pages; bumpTimestamp skips what the exclude* options drop and keeps the replies under them.
    score: ({ comment, options, replies }) => bumpTimestamp({ postTimestamp: comment.timestamp, replies: replies ?? [], keywords, options, bumpLimit }),
    validatePageSortSettings
  };
};

/** Whether a reply would be a no-bump reply under a given entry, for UIs that hold the published `publicOptions`. */
export const isNoBumpReplyForOptions = (content: unknown, options: Record<string, string> | undefined): boolean =>
  isNoBumpContent(content, splitKeywords(options?.[NO_BUMP_KEYWORDS_OPTION]));

export default activePageSort;
