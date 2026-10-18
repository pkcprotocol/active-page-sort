import { describe, expect, it } from "vitest";
import { EXCLUSION_OPTIONS, NO_BUMP_KEYWORDS_OPTION, bumpTimestamp, isCountedReply, isNoBumpContent, splitKeywords } from "../../src/no-bump.js";
import { buildReply } from "./fixtures.js";

describe("the option key is the wire contract", () => {
  it("is literally noBumpKeywords, which UIs read off community.pageSorts.posts.active.publicOptions", () => {
    // Renaming this silently breaks every UI that renders a sage marker from the published options.
    expect(NO_BUMP_KEYWORDS_OPTION).toBe("noBumpKeywords");
  });
});

describe("splitKeywords", () => {
  it("splits on commas and trims", () => {
    expect(splitKeywords("sage, nobump ,noko")).toEqual(["sage", "nobump", "noko"]);
  });
  it("drops empty entries and duplicates", () => {
    expect(splitKeywords(",sage,,sage, ,")).toEqual(["sage"]);
  });
  it("is empty for unset or blank input", () => {
    expect(splitKeywords(undefined)).toEqual([]);
    expect(splitKeywords("")).toEqual([]);
    expect(splitKeywords("  ,  ")).toEqual([]);
  });
});

describe("isNoBumpContent", () => {
  const keywords = ["sage", "nobump"];

  it("matches a content that is exactly the keyword", () => {
    expect(isNoBumpContent("sage", keywords)).toBe(true);
    expect(isNoBumpContent("nobump", keywords)).toBe(true);
  });
  it("matches a whole line of a multi-line content, with or without a carriage return", () => {
    expect(isNoBumpContent("this thread is bad\nsage", keywords)).toBe(true);
    expect(isNoBumpContent("sage\n>>12345 wrong", keywords)).toBe(true);
    expect(isNoBumpContent("first\r\nsage\r\nlast", keywords)).toBe(true);
  });
  it("does not match the keyword inside prose or with other text on the line", () => {
    expect(isNoBumpContent("sage is overused", keywords)).toBe(false);
    expect(isNoBumpContent("#sage", keywords)).toBe(false);
    expect(isNoBumpContent(" sage", keywords)).toBe(false);
    expect(isNoBumpContent("sage ", keywords)).toBe(false);
  });
  it("is case-sensitive", () => {
    expect(isNoBumpContent("Sage", keywords)).toBe(false);
    expect(isNoBumpContent("SAGE", keywords)).toBe(false);
  });
  it("never matches a reply without text content or with no keywords configured", () => {
    expect(isNoBumpContent(undefined, keywords)).toBe(false);
    expect(isNoBumpContent(null, keywords)).toBe(false);
    expect(isNoBumpContent(42, keywords)).toBe(false);
    expect(isNoBumpContent("sage", [])).toBe(false);
  });
});

describe("bumpTimestamp", () => {
  const keywords = ["sage"];
  const post = 1_000;
  const reply = (timestamp: number, content?: string) => ({ comment: { timestamp, content }, commentUpdate: {} });

  it("is the post's own timestamp with no replies", () => {
    expect(bumpTimestamp({ postTimestamp: post, replies: [], keywords })).toBe(post);
  });
  it("is the newest normal reply", () => {
    expect(bumpTimestamp({ postTimestamp: post, replies: [reply(1_200, "hi"), reply(1_500, "there"), reply(1_300)], keywords })).toBe(1_500);
  });
  it("skips no-bump replies, so a saged thread keeps its previous bump time", () => {
    expect(bumpTimestamp({ postTimestamp: post, replies: [reply(1_200, "hi"), reply(1_900, "sage")], keywords })).toBe(1_200);
    expect(bumpTimestamp({ postTimestamp: post, replies: [reply(1_900, "sage")], keywords })).toBe(post);
  });
  it("still counts a normal reply that is newer than a saged one", () => {
    expect(bumpTimestamp({ postTimestamp: post, replies: [reply(1_900, "sage"), reply(2_000, "bump")], keywords })).toBe(2_000);
  });
  it("never goes below the post timestamp even when a reply carries an older timestamp", () => {
    expect(bumpTimestamp({ postTimestamp: post, replies: [reply(500, "old clock")], keywords })).toBe(post);
  });
  it("is plain bump order with no keywords", () => {
    expect(bumpTimestamp({ postTimestamp: post, replies: [reply(1_900, "sage")], keywords: [] })).toBe(1_900);
  });
});

describe("isCountedReply: the exclude* options on a reply's own CommentUpdate", () => {
  const ON = {
    excludeRemovedComments: "true",
    excludeDeletedComments: "true",
    excludeCommentWithApprovedFalse: "true",
    excludeCommentPendingApproval: "true"
  };
  const cases = [
    ["removed", "excludeRemovedComments", { removed: true }],
    ["deleted", "excludeDeletedComments", { edit: { deleted: true } }],
    ["disapproved", "excludeCommentWithApprovedFalse", { approved: false }],
    ["pending", "excludeCommentPendingApproval", { pendingApproval: true }]
  ] as const;

  it("checks exactly the four exclusions a sort file can apply", () => {
    // excludeCommentsWithDifferentCommunityAddress needs the community's address; pkc-js applies it before score.
    expect(Object.keys(EXCLUSION_OPTIONS).sort()).toEqual(Object.keys(ON).sort());
  });
  it("counts a present reply", () => {
    expect(isCountedReply(buildReply({ timestamp: 1_100 }), ON)).toBe(true);
    expect(isCountedReply(buildReply({ timestamp: 1_100, commentUpdate: { approved: true, removed: false, pendingApproval: false } }), ON)).toBe(true);
  });
  for (const [what, option, commentUpdate] of cases) {
    it(`does not count a ${what} reply while ${option} is on, and counts it while it is off`, () => {
      const reply = buildReply({ timestamp: 1_100, commentUpdate });
      expect(isCountedReply(reply, ON)).toBe(false);
      expect(isCountedReply(reply, { ...ON, [option]: "false" })).toBe(true);
      expect(isCountedReply(reply, {})).toBe(true);
    });
  }
  it("parses flags like pkc-js: trimmed, case-insensitive true", () => {
    const deleted = buildReply({ timestamp: 1_100, commentUpdate: { edit: { deleted: true } } });
    expect(isCountedReply(deleted, { excludeDeletedComments: " TRUE " })).toBe(false);
    expect(isCountedReply(deleted, { excludeDeletedComments: "yes" })).toBe(true);
  });
});

describe("bumpTimestamp with tombstones", () => {
  const keywords = ["sage"];
  const options = { excludeRemovedComments: "true", excludeDeletedComments: "true", excludeCommentWithApprovedFalse: "true", excludeCommentPendingApproval: "true" };
  for (const [what, commentUpdate] of [
    ["removed", { removed: true }],
    ["deleted", { edit: { deleted: true } }],
    ["disapproved", { approved: false }]
  ] as const) {
    it(`skips a ${what} reply but still counts the present replies under it`, () => {
      const tombstone = buildReply({ timestamp: 1_500, content: "bump", commentUpdate });
      const under = buildReply({ timestamp: 1_300, content: "answer", parentCid: tombstone.commentUpdate.cid, depth: 2 });
      expect(bumpTimestamp({ postTimestamp: 1_000, replies: [tombstone], keywords, options })).toBe(1_000);
      expect(bumpTimestamp({ postTimestamp: 1_000, replies: [tombstone, under], keywords, options })).toBe(1_300);
    });
  }
  it("skips a pending reply", () => {
    const pending = buildReply({ timestamp: 1_500, content: "bump", commentUpdate: { pendingApproval: true } });
    expect(bumpTimestamp({ postTimestamp: 1_000, replies: [pending], keywords, options })).toBe(1_000);
  });
  it("still skips a saged reply under a tombstone", () => {
    const tombstone = buildReply({ timestamp: 1_500, commentUpdate: { removed: true } });
    const saged = buildReply({ timestamp: 1_600, content: "sage", parentCid: tombstone.commentUpdate.cid, depth: 2 });
    expect(bumpTimestamp({ postTimestamp: 1_000, replies: [tombstone, saged], keywords, options })).toBe(1_000);
  });
  it("counts a deleted reply when no options are passed: without the flags nothing is skipped", () => {
    const deleted = buildReply({ timestamp: 1_500, content: "bump", commentUpdate: { edit: { deleted: true } } });
    expect(bumpTimestamp({ postTimestamp: 1_000, replies: [deleted], keywords })).toBe(1_500);
  });
});
