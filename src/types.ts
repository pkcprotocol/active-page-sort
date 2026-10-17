// Re-exports of the pkc-js page sort types, so the package compiles against the contract the community
// actually runs (docs/protocol/page-sorts.md in pkc-js). Only the four root exports exist on pkc-js today;
// the settings entry and the score arguments are derived from them until pkc-js names them itself.
import type { PageSortFile, PageSortFileFactory, PageSortFileFactoryInput, PageSortReplyEntry } from "@pkcprotocol/pkc-js";

export type { PageSortFile, PageSortFileFactory, PageSortFileFactoryInput, PageSortReplyEntry };

/** The argument the factory is called with: `{ pageSortSettings }`, one entry of `settings.pages[scope]`. */
export type PageSortFileFactoryArgs = Parameters<PageSortFileFactory>[0];

/** One `settings.pages.posts[i]` entry as pkc-js hands it to the factory. */
export type PageSortSettingsEntry = PageSortFileFactoryArgs["pageSortSettings"];

/** The argument `score` receives per comment, with `replies` present because this sort declares `requireReplies`. */
export type PageSortScoreArgs = Parameters<PageSortFile["score"]>[0];

/** The subset of a reply this package reads. A `PageSortReplyEntry` and a page entry are both supersets. */
export interface NoBumpReplyLike {
  comment: { timestamp: number; content?: string | undefined };
}
