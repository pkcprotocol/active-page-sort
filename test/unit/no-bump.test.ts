import { describe, expect, it } from "vitest";
import { NO_BUMP_KEYWORDS_OPTION, bumpTimestamp, isNoBumpContent, splitKeywords } from "../../src/no-bump.js";

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
