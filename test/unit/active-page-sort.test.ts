import { describe, expect, it } from "vitest";
import activePageSort, {
  DESCRIPTION,
  MAX_KEYWORDS,
  MAX_KEYWORD_LENGTH,
  SORT_NAME,
  isNoBumpReplyForOptions,
  optionInputs,
  validatePageSortSettings
} from "../../src/active-page-sort.js";
import { NO_BUMP_KEYWORDS_OPTION } from "../../src/no-bump.js";
import { POST_CID, buildComment, buildCommentUpdate, buildReply, buildSettings, nextCid } from "./fixtures.js";
import { resortLikeAUi, type PageEntry } from "./resort-like-a-ui.js";

const SAGE = buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: "sage" });
const BASE_TIMESTAMP = 1_700_000_000;

describe("the file pkc-js receives", () => {
  const file = activePageSort({ pageSortSettings: SAGE });

  it("publishes under the built-in's wire key so UIs reading posts.pages.active keep working", () => {
    expect(SORT_NAME).toBe("active");
    expect(file.sortName).toBe("active");
  });
  it("is a reply-dependent post sort", () => {
    expect(file.scope).toBe("posts");
    expect(file.requireReplies).toBe(true);
    expect(file.flat).toBeUndefined();
  });
  it("declares its option so pkc-js catches typos in settings.pages", () => {
    expect(file.description).toBe(DESCRIPTION);
    expect(file.optionInputs).toBe(optionInputs);
    expect(file.optionInputs?.map((input) => input.option)).toEqual([NO_BUMP_KEYWORDS_OPTION]);
    expect(file.defaultOptions).toEqual({});
    expect(file.validatePageSortSettings).toBe(validatePageSortSettings);
  });
});

describe("score", () => {
  const score = (replies: ReturnType<typeof buildReply>[], settings = SAGE) =>
    activePageSort({ pageSortSettings: settings }).score({
      comment: buildComment({ timestamp: 1_000 }),
      commentUpdate: buildCommentUpdate({ cid: POST_CID, replyCount: replies.length }),
      options: settings.options ?? {},
      baseTimestamp: BASE_TIMESTAMP,
      replies
    });

  it("is the post timestamp without replies, and when pkc-js passes no replies at all", () => {
    expect(score([])).toBe(1_000);
    expect(
      activePageSort({ pageSortSettings: SAGE }).score({
        comment: buildComment({ timestamp: 1_000 }),
        commentUpdate: buildCommentUpdate(),
        options: {},
        baseTimestamp: BASE_TIMESTAMP
      })
    ).toBe(1_000);
  });
  it("bumps on a normal reply", () => {
    expect(score([buildReply({ timestamp: 1_500, content: "bump" })])).toBe(1_500);
  });
  it("does not bump on a sage reply", () => {
    expect(score([buildReply({ timestamp: 1_200, content: "bump" }), buildReply({ timestamp: 1_900, content: "sage" })])).toBe(1_200);
  });
  it("bumps on a normal reply nested under a sage reply", () => {
    const saged = buildReply({ timestamp: 1_900, content: "sage" });
    const under = buildReply({ timestamp: 2_000, content: "disagree", parentCid: saged.commentUpdate.cid, depth: 2 });
    expect(score([saged, under])).toBe(2_000);
  });
  it("counts a normal reply at any depth, wherever it sits in the unordered list", () => {
    // post <- normal (d1) <- sage (d2) <- sage (d3) <- normal (d4), handed deepest first as pkc-js may.
    const d1 = buildReply({ timestamp: 1_100, content: "first" });
    const d2 = buildReply({ timestamp: 1_200, content: "sage", parentCid: d1.commentUpdate.cid, depth: 2 });
    const d3 = buildReply({ timestamp: 1_300, content: "sage", parentCid: d2.commentUpdate.cid, depth: 3 });
    const d4 = buildReply({ timestamp: 1_400, content: "deep answer", parentCid: d3.commentUpdate.cid, depth: 4 });
    expect(score([d4, d3, d2, d1])).toBe(1_400);
    expect(score([d2, d4, d1, d3])).toBe(1_400);
  });
  it("skips a sage reply at any depth, under a normal or a sage parent", () => {
    const d1 = buildReply({ timestamp: 1_100, content: "first" });
    const d2 = buildReply({ timestamp: 1_200, content: "second", parentCid: d1.commentUpdate.cid, depth: 2 });
    const d3 = buildReply({ timestamp: 1_900, content: "line one\nsage", parentCid: d2.commentUpdate.cid, depth: 3 });
    const d4 = buildReply({ timestamp: 2_000, content: "sage", parentCid: d3.commentUpdate.cid, depth: 4 });
    expect(score([d4, d3, d2, d1])).toBe(1_200);
  });
  it("keeps the post timestamp when the whole subtree is saged", () => {
    const d1 = buildReply({ timestamp: 1_100, content: "sage" });
    const d2 = buildReply({ timestamp: 1_200, content: "sage", parentCid: d1.commentUpdate.cid, depth: 2 });
    const sibling = buildReply({ timestamp: 1_300, content: "sage" });
    expect(score([d2, sibling, d1])).toBe(1_000);
  });
  it("ignores the CommentUpdate's lastReplyTimestamp: the replies decide, not the aggregate", () => {
    const file = activePageSort({ pageSortSettings: SAGE });
    expect(
      file.score({
        comment: buildComment({ timestamp: 1_000 }),
        commentUpdate: buildCommentUpdate({ lastReplyTimestamp: 1_900, replyCount: 1 }),
        options: SAGE.options ?? {},
        baseTimestamp: BASE_TIMESTAMP,
        replies: [buildReply({ timestamp: 1_900, content: "sage" })]
      })
    ).toBe(1_000);
  });
  it("honours several keywords", () => {
    const settings = buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: "sage, nobump" });
    expect(score([buildReply({ timestamp: 1_900, content: "nobump" })], settings)).toBe(1_000);
    expect(score([buildReply({ timestamp: 1_900, content: "Sage" })], settings)).toBe(1_900);
  });
  it("is the built-in active order when the option is unset", () => {
    expect(score([buildReply({ timestamp: 1_900, content: "sage" })], buildSettings())).toBe(1_900);
  });
  it("never declines: a saged thread sinks, it does not disappear", () => {
    expect(score([buildReply({ timestamp: 1_900, content: "sage" })])).not.toBeNull();
  });
});

describe("validatePageSortSettings", () => {
  it("accepts an unset option and a normal list", () => {
    expect(() => validatePageSortSettings({ pageSortSettings: buildSettings() })).not.toThrow();
    expect(() => validatePageSortSettings({ pageSortSettings: SAGE })).not.toThrow();
    expect(() => validatePageSortSettings({ pageSortSettings: buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: "sage,nobump" }) })).not.toThrow();
  });
  it("rejects an option set to nothing matchable, which would silently be plain bump order", () => {
    expect(() => validatePageSortSettings({ pageSortSettings: buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: "" }) })).toThrow(/no keyword/);
    expect(() => validatePageSortSettings({ pageSortSettings: buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: " , ," }) })).toThrow(/no keyword/);
  });
  it("rejects a keyword that can never equal a line", () => {
    expect(() => validatePageSortSettings({ pageSortSettings: buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: "sa\nge" }) })).toThrow(/line break/);
  });
  it("bounds the list", () => {
    const tooMany = Array.from({ length: MAX_KEYWORDS + 1 }, (_, i) => `k${i}`).join(",");
    expect(() => validatePageSortSettings({ pageSortSettings: buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: tooMany }) })).toThrow(/maximum/);
    const tooLong = "x".repeat(MAX_KEYWORD_LENGTH + 1);
    expect(() => validatePageSortSettings({ pageSortSettings: buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: tooLong }) })).toThrow(/maximum/);
  });
  it("lets the reserved options through untouched, pkc-js owns them", () => {
    const settings = buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: "sage", maxAge: "7d", pinnedFirst: "false" });
    expect(() => validatePageSortSettings({ pageSortSettings: settings })).not.toThrow();
    expect(activePageSort({ pageSortSettings: settings }).sortName).toBe("active");
  });
});

describe("isNoBumpReplyForOptions, for UIs holding the published publicOptions", () => {
  it("reads the keyword list off the options", () => {
    const publicOptions = { [NO_BUMP_KEYWORDS_OPTION]: "sage", pinnedFirst: "true" };
    expect(isNoBumpReplyForOptions("sage", publicOptions)).toBe(true);
    expect(isNoBumpReplyForOptions("not sage", publicOptions)).toBe(false);
    expect(isNoBumpReplyForOptions("sage", undefined)).toBe(false);
  });
});

describe("a client re-sorting a page reproduces the community's order", () => {
  // Three threads: A oldest post with a recent normal bump, B newer post with only a sage reply, C newest post
  // with no replies, plus a pinned old thread. Community order: pinned first, then A (bumped), C, B.
  const pinned: PageEntry = { comment: buildComment({ timestamp: 100, title: "sticky" }), commentUpdate: buildCommentUpdate({ cid: nextCid(), pinned: true }) };
  const a: PageEntry = { comment: buildComment({ timestamp: 1_000, title: "A" }), commentUpdate: buildCommentUpdate({ cid: nextCid(), replyCount: 1 }) };
  const b: PageEntry = { comment: buildComment({ timestamp: 2_000, title: "B" }), commentUpdate: buildCommentUpdate({ cid: nextCid(), replyCount: 1 }) };
  const c: PageEntry = { comment: buildComment({ timestamp: 3_000, title: "C" }), commentUpdate: buildCommentUpdate({ cid: nextCid() }) };
  const replies = [
    buildReply({ timestamp: 5_000, content: "bump", parentCid: a.commentUpdate.cid }),
    buildReply({ timestamp: 6_000, content: "sage", parentCid: b.commentUpdate.cid })
  ];
  const expected = [pinned, a, c, b];

  it("from any input order, with the sort's publicOptions", () => {
    for (const input of [
      [b, c, a, pinned],
      [pinned, a, b, c],
      [c, b, a, pinned]
    ]) {
      const ordered = resortLikeAUi({ comments: input, factory: activePageSort, pageSortSettings: SAGE, baseTimestamp: BASE_TIMESTAMP, replies });
      expect(ordered.map((entry) => entry.comment.title)).toEqual(expected.map((entry) => entry.comment.title));
    }
  });
  it("treats the sticky as an ordinary thread under pinnedFirst false", () => {
    const settings = buildSettings({ [NO_BUMP_KEYWORDS_OPTION]: "sage", pinnedFirst: "false" });
    const ordered = resortLikeAUi({ comments: [pinned, a, b, c], factory: activePageSort, pageSortSettings: settings, baseTimestamp: BASE_TIMESTAMP, replies });
    expect(ordered.map((entry) => entry.comment.title)).toEqual(["A", "C", "B", "sticky"]);
  });
  it("keeps the page's order for ties", () => {
    const x: PageEntry = { comment: buildComment({ timestamp: 4_000, title: "X" }), commentUpdate: buildCommentUpdate({ cid: nextCid() }) };
    const y: PageEntry = { comment: buildComment({ timestamp: 4_000, title: "Y" }), commentUpdate: buildCommentUpdate({ cid: nextCid() }) };
    const ordered = resortLikeAUi({ comments: [y, x], factory: activePageSort, pageSortSettings: SAGE, baseTimestamp: BASE_TIMESTAMP, replies: [] });
    expect(ordered.map((entry) => entry.comment.title)).toEqual(["Y", "X"]);
  });
});

describe("a client re-sorting threads with nested replies walks every level", () => {
  // D: its only bump is a normal reply at depth 3, under two sage replies, so D ranks by it (8_000).
  // E: a normal reply at depth 2, then a newer sage at depth 3, so E ranks by the depth-2 reply (4_500).
  // F: a newer post with no replies (5_000), between the two.
  const d: PageEntry = { comment: buildComment({ timestamp: 1_000, title: "D" }), commentUpdate: buildCommentUpdate({ cid: nextCid(), replyCount: 3 }) };
  const e: PageEntry = { comment: buildComment({ timestamp: 2_000, title: "E" }), commentUpdate: buildCommentUpdate({ cid: nextCid(), replyCount: 3 }) };
  const f: PageEntry = { comment: buildComment({ timestamp: 5_000, title: "F" }), commentUpdate: buildCommentUpdate({ cid: nextCid() }) };
  const d1 = buildReply({ timestamp: 6_000, content: "sage", parentCid: d.commentUpdate.cid });
  const d2 = buildReply({ timestamp: 7_000, content: "sage", parentCid: d1.commentUpdate.cid, depth: 2 });
  const d3 = buildReply({ timestamp: 8_000, content: "answering the sages", parentCid: d2.commentUpdate.cid, depth: 3 });
  const e1 = buildReply({ timestamp: 4_000, content: "hi", parentCid: e.commentUpdate.cid });
  const e2 = buildReply({ timestamp: 4_500, content: "hello", parentCid: e1.commentUpdate.cid, depth: 2 });
  const e3 = buildReply({ timestamp: 9_000, content: "sage", parentCid: e2.commentUpdate.cid, depth: 3 });

  it("ranks each thread by its newest normal descendant, at any depth", () => {
    const ordered = resortLikeAUi({ comments: [e, f, d], factory: activePageSort, pageSortSettings: SAGE, baseTimestamp: BASE_TIMESTAMP, replies: [d1, d2, d3, e1, e2, e3] });
    expect(ordered.map((entry) => entry.comment.title)).toEqual(["D", "F", "E"]);
  });
  it("does not depend on the walk listing parents before children", () => {
    const ordered = resortLikeAUi({ comments: [e, f, d], factory: activePageSort, pageSortSettings: SAGE, baseTimestamp: BASE_TIMESTAMP, replies: [e3, d3, e2, d2, e1, d1] });
    expect(ordered.map((entry) => entry.comment.title)).toEqual(["D", "F", "E"]);
  });
  it("misses the depth-3 bump when the walk stops at direct replies, a wrong order and no error", () => {
    const ordered = resortLikeAUi({ comments: [e, f, d], factory: activePageSort, pageSortSettings: SAGE, baseTimestamp: BASE_TIMESTAMP, replies: [d1, e1] });
    expect(ordered.map((entry) => entry.comment.title)).toEqual(["F", "E", "D"]);
  });
  it("is plain bump order over the same tree when the option is unset, so E's depth-3 sage leads", () => {
    const ordered = resortLikeAUi({ comments: [d, f, e], factory: activePageSort, pageSortSettings: buildSettings(), baseTimestamp: BASE_TIMESTAMP, replies: [d1, d2, d3, e1, e2, e3] });
    expect(ordered.map((entry) => entry.comment.title)).toEqual(["E", "D", "F"]);
  });
});

describe("a client re-sorting from walked reply pages drops what the post sort excluded", () => {
  // Reply pages keep deleted and removed replies (the replies scope's exclusions), the post sort does not,
  // and the community never reaches a reply under an excluded one. The published publicOptions say which.
  const POST_EXCLUSIONS = {
    [NO_BUMP_KEYWORDS_OPTION]: "sage",
    pinnedFirst: "true",
    excludeRemovedComments: "true",
    excludeDeletedComments: "true",
    excludeCommentPendingApproval: "true",
    excludeCommentWithApprovedFalse: "true",
    excludeCommentsWithDifferentCommunityAddress: "true"
  };
  const g: PageEntry = { comment: buildComment({ timestamp: 1_000, title: "G" }), commentUpdate: buildCommentUpdate({ cid: nextCid(), replyCount: 2 }) };
  const h: PageEntry = { comment: buildComment({ timestamp: 3_000, title: "H" }), commentUpdate: buildCommentUpdate({ cid: nextCid() }) };
  const rank = (replies: ReturnType<typeof buildReply>[], options: Record<string, string> = POST_EXCLUSIONS) =>
    resortLikeAUi({ comments: [h, g], factory: activePageSort, pageSortSettings: buildSettings(options), baseTimestamp: BASE_TIMESTAMP, replies }).map(
      (entry) => entry.comment.title
    );
  const excluded: [string, Partial<ReturnType<typeof buildReply>["commentUpdate"]>][] = [
    ["deleted by its author", { edit: { deleted: true } }],
    ["removed by a moderator", { removed: true }],
    ["disapproved", { approved: false }],
    ["pending approval", { pendingApproval: true }]
  ];

  it("a normal reply still bumps when nothing is excluded", () => {
    expect(rank([buildReply({ timestamp: 5_000, content: "bump", parentCid: g.commentUpdate.cid })])).toEqual(["G", "H"]);
  });
  for (const [what, commentUpdate] of excluded) {
    it(`a ${what} reply does not bump`, () => {
      expect(rank([buildReply({ timestamp: 5_000, content: "bump", parentCid: g.commentUpdate.cid, commentUpdate })])).toEqual(["H", "G"]);
    });
  }
  it("a normal reply under an excluded reply does not bump: the walk never reaches it", () => {
    const deletedSage = buildReply({ timestamp: 4_000, content: "sage", parentCid: g.commentUpdate.cid, commentUpdate: { edit: { deleted: true } } });
    const under = buildReply({ timestamp: 5_000, content: "answer", parentCid: deletedSage.commentUpdate.cid, depth: 2 });
    const deeper = buildReply({ timestamp: 6_000, content: "deeper", parentCid: under.commentUpdate.cid, depth: 3 });
    expect(rank([deeper, under, deletedSage])).toEqual(["H", "G"]);
  });
  it("a deleted reply counts again when the community publishes excludeDeletedComments false", () => {
    const deleted = buildReply({ timestamp: 5_000, content: "bump", parentCid: g.commentUpdate.cid, commentUpdate: { edit: { deleted: true } } });
    expect(rank([deleted], { ...POST_EXCLUSIONS, excludeDeletedComments: "false" })).toEqual(["G", "H"]);
  });
});
