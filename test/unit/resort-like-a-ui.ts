import type { PageSortFileFactory, PageSortReplyEntry, PageSortScoreArgs, PageSortSettingsEntry } from "../../src/types.js";

// The pkc-js "Client side" guidance (docs/protocol/page-sorts.md) as runnable code: pkc-js exports no
// sorter, a UI applies the package's `score` itself. Used by the tests to check that a page re-sorted this
// way lands in the order the community publishes.

// The reserved exclusions the community applies to the `replies` it scores over (pkc-js
// `applyPageSortExclusions`, not exported). Reply pages are generated with the replies scope's exclusions,
// which keep deleted and removed replies, so a walked tree holds replies the post sort never scored. A
// published `"true"` drops the reply, and the descendant walk below then never reaches anything under it,
// the same cut the community makes. `excludeCommentsWithDifferentCommunityAddress` needs the community's
// address and is left out: a tree walked from the community's own pages holds only its own replies.
export function applyReplyExclusions(replies: PageSortReplyEntry[], options: Record<string, string>): PageSortReplyEntry[] {
  const on = (option: string) => options[option] === "true";
  return replies.filter(({ commentUpdate }) => {
    if (on("excludeRemovedComments") && commentUpdate.removed === true) return false;
    if (on("excludeDeletedComments") && commentUpdate.edit?.deleted === true) return false;
    if (on("excludeCommentWithApprovedFalse") && commentUpdate.approved === false) return false;
    if (on("excludeCommentPendingApproval") && commentUpdate.pendingApproval === true) return false;
    return true;
  });
}

export interface PageEntry {
  comment: PageSortScoreArgs["comment"];
  commentUpdate: PageSortScoreArgs["commentUpdate"];
}

export function resortLikeAUi({
  comments,
  factory,
  pageSortSettings,
  baseTimestamp,
  replies
}: {
  comments: PageEntry[];
  factory: PageSortFileFactory;
  pageSortSettings: PageSortSettingsEntry;
  baseTimestamp: number;
  replies: PageSortReplyEntry[];
}): PageEntry[] {
  const file = factory({ pageSortSettings });
  const options = pageSortSettings.options ?? {};
  const childrenOf = new Map<string, PageSortReplyEntry[]>();
  for (const reply of applyReplyExclusions(replies, options)) {
    const parentCid = reply.comment.parentCid;
    if (!parentCid) continue;
    const siblings = childrenOf.get(parentCid) ?? [];
    siblings.push(reply);
    childrenOf.set(parentCid, siblings);
  }
  const descendantsOf = (cid: string): PageSortReplyEntry[] => {
    const collected: PageSortReplyEntry[] = [];
    const queue = [...(childrenOf.get(cid) ?? [])];
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      collected.push(entry);
      queue.push(...(childrenOf.get(entry.commentUpdate.cid) ?? []));
    }
    return collected;
  };
  const scored = comments.map((entry, index) => ({
    entry,
    index,
    pinned: entry.commentUpdate.pinned === true,
    score: file.score({
      comment: entry.comment,
      commentUpdate: entry.commentUpdate,
      options,
      baseTimestamp,
      ...(file.requireReplies ? { replies: descendantsOf(entry.commentUpdate.cid) } : {})
    })
  }));
  const kept = scored.filter((item): item is typeof item & { score: number } => item.score !== null);
  const byScore = (a: (typeof kept)[number], b: (typeof kept)[number]) => b.score - a.score || a.index - b.index;
  const ordered =
    options["pinnedFirst"] === "false"
      ? kept.sort(byScore)
      : [...kept.filter((item) => item.pinned).sort(byScore), ...kept.filter((item) => !item.pinned).sort(byScore)];
  return ordered.map((item) => item.entry);
}
