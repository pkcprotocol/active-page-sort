import type { NoBumpReplyLike } from "./types.js";

// The matching rules, with no imports, so a browser UI can apply the same test the community applies to
// render a "sage" marker or to validate the reply form. Keep this file identical in behaviour to the
// README's description of the match: both are the contract a board's users rely on.

/**
 * The name this package is registered under in `PKC.pageSorts`, and so the `name` a community publishes for it in
 * `community.pageSorts.posts[key]`. The wire key is the owner's choice (`active` by default); the name is how a UI
 * recognises the sort.
 */
export const PACKAGE_NAME = "@pkcprotocol/active-page-sort";

/** The option key under `settings.pages.posts[i].options`. Published as `community.pageSorts.posts[key].publicOptions.noBumpKeywords`. */
export const NO_BUMP_KEYWORDS_OPTION = "noBumpKeywords";

/** The option key for the bump limit. Published as `community.pageSorts.posts[key].publicOptions.bumpLimit`. */
export const BUMP_LIMIT_OPTION = "bumpLimit";

/** Comma-separated list to keywords: trimmed, empty entries dropped, duplicates kept out. */
export const splitKeywords = (raw: string | undefined): string[] => {
  const keywords: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const keyword = part.trim();
    if (keyword && !keywords.includes(keyword)) keywords.push(keyword);
  }
  return keywords;
};

/**
 * The bump limit an option value holds: a positive integer, surrounding whitespace trimmed. `undefined` for an
 * unset option (no limit) and for anything else, which `validatePageSortSettings` rejects on the community.
 */
export const parseBumpLimit = (raw: string | undefined): number | undefined => {
  const trimmed = raw?.trim();
  if (!trimmed || !/^[1-9][0-9]*$/.test(trimmed)) return undefined;
  const limit = Number(trimmed);
  return Number.isSafeInteger(limit) ? limit : undefined;
};

/** One value of `community.pageSorts.posts`, as far as this package reads it. pkc-js's `CommunityPageSort` is a superset. */
export interface PublishedPageSortLike {
  name?: string | undefined;
  publicOptions?: Readonly<Record<string, string>> | undefined;
}

/** This package's sort as a community publishes it: the wire key its pages are under, and the options it ran with. */
export interface PublishedActivePageSort {
  /** The key under `community.posts.pages` / `pageCids` and `community.pageSorts.posts`. `active` unless the owner chose another. */
  sortName: string;
  /** `PACKAGE_NAME`, or `undefined` for a sort the community loaded by file path. */
  name: string | undefined;
  publicOptions: Readonly<Record<string, string>>;
}

/**
 * The entries of `community.pageSorts.posts` that are this sort, in the community's order. Pass
 * `community.pageSorts?.posts`. The key is a label the owner chooses (an entry's `sortName`, pkc-js#483), so the sort
 * is recognised by what is published under the key: a `name` equal to `PACKAGE_NAME`, or, for a file loaded by
 * `path`, which publishes no `name`, a `noBumpKeywords` or `bumpLimit` among the `publicOptions`. Empty on a board
 * without `pageSorts` or without this sort. An owner may list the sort more than once, under different keys.
 */
export const findPublishedActivePageSorts = (postSorts: Readonly<Record<string, PublishedPageSortLike>> | undefined): PublishedActivePageSort[] => {
  const found: PublishedActivePageSort[] = [];
  for (const [sortName, published] of Object.entries(postSorts ?? {})) {
    const publicOptions = published.publicOptions ?? {};
    const carriesAnOption = publicOptions[NO_BUMP_KEYWORDS_OPTION] !== undefined || publicOptions[BUMP_LIMIT_OPTION] !== undefined;
    if (published.name === PACKAGE_NAME || (published.name === undefined && carriesAnOption)) found.push({ sortName, name: published.name, publicOptions });
  }
  return found;
};

/**
 * Whether a reply is a no-bump reply: its content has a whole line equal to one of the keywords. Exact and
 * case-sensitive, so `sage` in prose ("sage is overused") still bumps, while a content of `sage`, or a
 * multi-line content with a line that is exactly `sage`, does not. A reply without text content is never a
 * no-bump reply.
 */
export const isNoBumpContent = (content: unknown, keywords: readonly string[]): boolean => {
  if (typeof content !== "string" || keywords.length === 0) return false;
  const lines = content.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  return keywords.some((keyword) => lines.includes(keyword));
};

/**
 * The reserved exclusion options a reply's own CommentUpdate can be checked against, and what each drops.
 * Replies of another community are not a case here: pkc-js drops them before `score` runs (the always-on
 * community identity rule, pkc-js#401), and a sort file is never given the community's address to check it.
 */
export const EXCLUSION_OPTIONS = {
  excludeRemovedComments: (update: NoBumpReplyLike["commentUpdate"]) => update.removed === true,
  excludeDeletedComments: (update: NoBumpReplyLike["commentUpdate"]) => update.edit?.deleted === true,
  excludeCommentWithApprovedFalse: (update: NoBumpReplyLike["commentUpdate"]) => update.approved === false,
  excludeCommentPendingApproval: (update: NoBumpReplyLike["commentUpdate"]) => update.pendingApproval === true
} as const;

const exclusionsOf = (options: Readonly<Record<string, string>>) =>
  Object.entries(EXCLUSION_OPTIONS)
    .filter(([option]) => options[option]?.trim().toLowerCase() === "true")
    .map(([, drops]) => drops);

/**
 * Whether a reply's own timestamp can bump its thread: no `exclude*` option that is on drops it. The tombstone rule
 * of pkc-js's "Which replies count": a dropped reply does not bump, the replies under it are judged on their own, so
 * a present reply under a removed or deleted one still bumps. With the `posts` defaults (every flag on) this is what
 * the built-in `active` counts. Flags parse like pkc-js parses them: trimmed, case-insensitive `"true"` is on,
 * anything else off. Pass the published `publicOptions`; without the flags nothing is dropped.
 */
export const isCountedReply = (reply: NoBumpReplyLike, options: Readonly<Record<string, string>>): boolean =>
  !exclusionsOf(options).some((drops) => drops(reply.commentUpdate));

/**
 * A thread's bump time: the newest of the post's own timestamp and the timestamps of its counted replies (see
 * `isCountedReply`) that are not no-bump replies. Each reply is judged on its own: a normal reply under a saged
 * reply or a tombstone bumps. With a `bumpLimit`, only the first `bumpLimit` counted replies by `(timestamp, cid)`
 * can bump, saged ones included in the count. This is exactly what `score` returns, exposed so a UI can show
 * "last bump" without the page sort machinery. Pass the replies as pkc-js or a reply-page walk gives them,
 * tombstones included, the published `publicOptions` as `options`, and `parseBumpLimit` of its `bumpLimit`.
 */
export const bumpTimestamp = ({
  postTimestamp,
  replies,
  keywords,
  options = {},
  bumpLimit
}: {
  postTimestamp: number;
  replies: readonly NoBumpReplyLike[];
  keywords: readonly string[];
  options?: Readonly<Record<string, string>>;
  bumpLimit?: number | undefined;
}): number => {
  const exclusions = exclusionsOf(options);
  let counted = replies.filter((reply) => !exclusions.some((drops) => drops(reply.commentUpdate)));
  if (bumpLimit !== undefined && counted.length > bumpLimit) counted = [...counted].sort(byTimestampThenCid).slice(0, bumpLimit);
  let bump = postTimestamp;
  for (const reply of counted) {
    if (isNoBumpContent(reply.comment.content, keywords)) continue;
    if (reply.comment.timestamp > bump) bump = reply.comment.timestamp;
  }
  return bump;
};

// The order "the first bumpLimit replies" is taken in. The CID breaks a tie in the same second, compared as a
// plain string so the community and every client agree.
const byTimestampThenCid = (a: NoBumpReplyLike, b: NoBumpReplyLike): number =>
  a.comment.timestamp - b.comment.timestamp || (a.commentUpdate.cid < b.commentUpdate.cid ? -1 : a.commentUpdate.cid > b.commentUpdate.cid ? 1 : 0);
