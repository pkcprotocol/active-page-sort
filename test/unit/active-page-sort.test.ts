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
