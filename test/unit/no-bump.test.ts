import { describe, expect, it } from "vitest";
import { EXCLUSION_OPTIONS, NO_BUMP_KEYWORDS_OPTION, applyReplyExclusions, bumpTimestamp, isNoBumpContent, splitKeywords } from "../../src/no-bump.js";
import { POST_CID, buildReply } from "./fixtures.js";

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
  const reply = (timestamp: number, content?: string) => ({ comment: { timestamp, content } });

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

describe("applyReplyExclusions", () => {
  const ON = {
    excludeRemovedComments: "true",
    excludeDeletedComments: "true",
    excludeCommentWithApprovedFalse: "true",
    excludeCommentPendingApproval: "true"
  };
  const cids = (replies: ReturnType<typeof buildReply>[]) => replies.map((reply) => reply.commentUpdate.cid).sort();
  const apply = (replies: ReturnType<typeof buildReply>[], options: Record<string, string> = ON) =>
    applyReplyExclusions({ postCid: POST_CID, replies, options });

  it("re-applies exactly the four exclusions a sort file can check", () => {
    // excludeCommentsWithDifferentCommunityAddress needs the community's address, which score never gets.
    expect(Object.keys(EXCLUSION_OPTIONS).sort()).toEqual(Object.keys(ON).sort());
  });
  it("keeps every reply of a clean tree, at every depth, in any order", () => {
    const d1 = buildReply({ timestamp: 1_100 });
    const d2 = buildReply({ timestamp: 1_200, parentCid: d1.commentUpdate.cid, depth: 2 });
    const d3 = buildReply({ timestamp: 1_300, parentCid: d2.commentUpdate.cid, depth: 3 });
    expect(cids(apply([d3, d1, d2]))).toEqual(cids([d1, d2, d3]));
  });
  it("is a no-op on the list pkc-js already filtered", () => {
    const replies = [buildReply({ timestamp: 1_100 }), buildReply({ timestamp: 1_200 })];
    expect(apply(replies)).toHaveLength(2);
  });
  for (const [what, commentUpdate] of [
    ["removed", { removed: true }],
    ["deleted", { edit: { deleted: true } }],
    ["disapproved", { approved: false }],
    ["pending", { pendingApproval: true }]
  ] as const) {
    it(`drops a ${what} reply and everything under it`, () => {
      const kept = buildReply({ timestamp: 1_050 });
      const dropped = buildReply({ timestamp: 1_100, commentUpdate });
      const under = buildReply({ timestamp: 1_200, parentCid: dropped.commentUpdate.cid, depth: 2 });
      const deeper = buildReply({ timestamp: 1_300, parentCid: under.commentUpdate.cid, depth: 3 });
      expect(cids(apply([deeper, under, dropped, kept]))).toEqual(cids([kept]));
    });
  }
  it("keeps what an unset or false flag would drop", () => {
    const deleted = buildReply({ timestamp: 1_100, commentUpdate: { edit: { deleted: true } } });
    const removed = buildReply({ timestamp: 1_200, commentUpdate: { removed: true } });
    expect(apply([deleted, removed], {})).toHaveLength(2);
    expect(apply([deleted, removed], { excludeDeletedComments: "false", excludeRemovedComments: "false" })).toHaveLength(2);
  });
  it("parses flags like pkc-js: trimmed, case-insensitive true", () => {
    const deleted = buildReply({ timestamp: 1_100, commentUpdate: { edit: { deleted: true } } });
    expect(apply([deleted], { excludeDeletedComments: " TRUE " })).toEqual([]);
    expect(apply([deleted], { excludeDeletedComments: "yes" })).toHaveLength(1);
  });
  it("drops a reply whose parent is not in the list, as the community never reaches it", () => {
    const orphan = buildReply({ timestamp: 1_100, parentCid: "QmNotInTheList", depth: 2 });
    expect(apply([orphan])).toEqual([]);
  });
  it("returns the entries it was given, not copies", () => {
    const reply = buildReply({ timestamp: 1_100 });
    expect(apply([reply])[0]).toBe(reply);
  });
});
