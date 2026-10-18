import type { NoBumpReplyLike } from "./types.js";

// The matching rules, with no imports, so a browser UI can apply the same test the community applies to
// render a "sage" marker or to validate the reply form. Keep this file identical in behaviour to the
// README's description of the match: both are the contract a board's users rely on.

/** The option key under `settings.pages.posts[i].options`. Published as `community.pageSorts.posts.active.publicOptions.noBumpKeywords`. */
export const NO_BUMP_KEYWORDS_OPTION = "noBumpKeywords";

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
 * `excludeCommentsWithDifferentCommunityAddress` is not here: pkc-js drops foreign replies before `score` runs,
 * and checking it needs the community's address, which a sort file is never given (pkc-js#401).
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
 * reply or a tombstone bumps. This is exactly what `score` returns, exposed so a UI can show "last bump" without
 * the page sort machinery. Pass the replies as pkc-js or a reply-page walk gives them, tombstones included, and
 * the published `publicOptions` as `options`.
 */
export const bumpTimestamp = ({
  postTimestamp,
  replies,
  keywords,
  options = {}
}: {
  postTimestamp: number;
  replies: readonly NoBumpReplyLike[];
  keywords: readonly string[];
  options?: Readonly<Record<string, string>>;
}): number => {
  const exclusions = exclusionsOf(options);
  let bump = postTimestamp;
  for (const reply of replies) {
    if (exclusions.some((drops) => drops(reply.commentUpdate)) || isNoBumpContent(reply.comment.content, keywords)) continue;
    if (reply.comment.timestamp > bump) bump = reply.comment.timestamp;
  }
  return bump;
};
