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
 * A thread's bump time: the newest of the post's own timestamp and the timestamps of its replies that are
 * not no-bump replies. Descendants of a no-bump reply still count: a normal reply under a saged reply bumps.
 * This is exactly what `score` returns, exposed so a UI can show "last bump" without the page sort machinery.
 */
export const bumpTimestamp = ({
  postTimestamp,
  replies,
  keywords
}: {
  postTimestamp: number;
  replies: readonly NoBumpReplyLike[];
  keywords: readonly string[];
}): number => {
  let bump = postTimestamp;
  for (const reply of replies) {
    if (isNoBumpContent(reply.comment.content, keywords)) continue;
    if (reply.comment.timestamp > bump) bump = reply.comment.timestamp;
  }
  return bump;
};
