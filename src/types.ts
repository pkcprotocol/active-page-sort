// Re-exports of the pkc-js page sort types, so the package compiles against the contract the community
// actually runs (docs/protocol/page-sorts.md in pkc-js). All of them are named root exports of pkc-js since
// 0.0.110 (pkcprotocol/pkc-js#397); the aliases below keep this package's own names stable.
import type {
  CommunityPageSortSetting,
  PageSortFile,
  PageSortFileFactory,
  PageSortFileFactoryArgs,
  PageSortFileFactoryInput,
  PageSortFileInput,
  PageSortReplyEntry,
  PageSortScope,
  PageSortScoreArgs
} from "@pkcprotocol/pkc-js";

export type {
  CommunityPageSortSetting,
  PageSortFile,
  PageSortFileFactory,
  PageSortFileFactoryArgs,
  PageSortFileFactoryInput,
  PageSortFileInput,
  PageSortReplyEntry,
  PageSortScope,
  PageSortScoreArgs
};

/** One `settings.pages.posts[i]` entry as pkc-js hands it to the factory. Alias of pkc-js's `CommunityPageSortSetting`. */
export type PageSortSettingsEntry = CommunityPageSortSetting;

/** The subset of a reply this package reads. A `PageSortReplyEntry` and a page entry are both supersets. */
export interface NoBumpReplyLike {
  comment: { timestamp: number; content?: string | undefined };
}
