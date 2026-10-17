import type { PageSortReplyEntry, PageSortScoreArgs, PageSortSettingsEntry } from "../../src/types.js";

// Fixtures typed against pkc-js's own page-entry types, so tsc rejects a field that does not exist on the
// wire instead of a test quietly passing against a shape the community never produces.

export type WireComment = PageSortScoreArgs["comment"];
export type WireCommentUpdate = PageSortScoreArgs["commentUpdate"];

export const COMMUNITY_PUBLIC_KEY = "communityPublicKeyBase64";
export const POST_CID = "QmbWqxBEKC3P8tqsKc98xmWNzrzDtRLMiMPL8wBuTGsMnR";

let cidCounter = 0;
export const nextCid = (): string => `QmFixture${String(++cidCounter).padStart(38, "0")}`;

const signature = (signedPropertyNames: string[]) => ({
  type: "ed25519",
  signature: "signature",
  publicKey: "authorPublicKey",
  signedPropertyNames
});

export const buildComment = (overrides: Partial<WireComment> & { timestamp: number }): WireComment => {
  const unsigned = {
    communityPublicKey: COMMUNITY_PUBLIC_KEY,
    protocolVersion: "1.0.0",
    depth: 0,
    content: "post content",
    title: "post title",
    author: { address: "author.bso", publicKey: "authorPublicKey" },
    ...overrides
  };
  return { ...unsigned, signature: signature(Object.keys(unsigned)) } as WireComment;
};

export const buildCommentUpdate = (overrides: Partial<WireCommentUpdate> = {}): WireCommentUpdate => {
  const unsigned = {
    cid: nextCid(),
    upvoteCount: 0,
    downvoteCount: 0,
    replyCount: 0,
    updatedAt: 1_700_000_100,
    protocolVersion: "1.0.0",
    ...overrides
  };
  return { ...unsigned, signature: signature(Object.keys(unsigned)) } as WireCommentUpdate;
};

/** A reply as pkc-js hands it to `score` under `requireReplies`: the lean PageSortReplyEntry, not a full page entry. */
export const buildReply = ({
  timestamp,
  content,
  parentCid = POST_CID,
  depth = 1,
  cid = nextCid(),
  commentUpdate = {}
}: {
  timestamp: number;
  content?: string;
  parentCid?: string;
  depth?: number;
  cid?: string;
  commentUpdate?: Partial<PageSortReplyEntry["commentUpdate"]>;
}): PageSortReplyEntry => ({
  comment: {
    parentCid,
    postCid: POST_CID,
    depth,
    timestamp,
    ...(content === undefined ? {} : { content }),
    author: { address: "replier.bso", publicKey: "replierPublicKey" },
    communityPublicKey: COMMUNITY_PUBLIC_KEY
  },
  commentUpdate: {
    cid,
    upvoteCount: 0,
    downvoteCount: 0,
    replyCount: 0,
    updatedAt: timestamp + 1,
    ...commentUpdate
  }
});

export const buildSettings = (options?: Record<string, string>, extra: Partial<PageSortSettingsEntry> = {}): PageSortSettingsEntry => ({
  name: "@pkcprotocol/active-page-sort",
  ...(options === undefined ? {} : { options }),
  ...extra
});
