import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import PKC from "@pkcprotocol/pkc-js";
import activePageSort from "../../src/active-page-sort.js";
import { NO_BUMP_KEYWORDS_OPTION } from "../../src/no-bump.js";
import type { PageSortReplyEntry } from "../../src/types.js";
import { resortLikeAUi, type PageEntry } from "../unit/resort-like-a-ui.js";
import { startKuboDaemon, type KuboDaemon } from "./kubo-daemon.js";

// End to end on a real daemon and a real community, the way an operator runs it: the built package is
// named by `path` in settings.pages, pkc-js imports it, generates the `active` pages with it and publishes
// `community.pageSorts`. A `sage` reply to the older thread leaves it behind the newer one; a normal reply
// then bumps it ahead. Then the same rules down the tree: a normal reply under a sage reply bumps, sage
// replies at depth 2 and 3 do not, a normal reply at depth 3 does until its author deletes it, and deleting
// a sage reply leaves a tombstone whose normal reply under it still bumps (pkc-js's "Which replies count"). The remote reader is a second PKC on the
// same daemon, loading the record over IPNS like a UI would, and re-sorting the page itself from the reply
// tree it walked. Run with `npm run test:e2e` (builds first: `path` points
// at dist/index.js).

type PKCInstance = Awaited<ReturnType<typeof PKC>>;
type Community = Awaited<ReturnType<PKCInstance["createCommunity"]>>;
type Comment = Awaited<ReturnType<PKCInstance["createComment"]>>;
type CommentEdit = Awaited<ReturnType<PKCInstance["createCommentEdit"]>>;
type Signer = Awaited<ReturnType<PKCInstance["createSigner"]>>;
type PagePost = Community["posts"]["pages"][string] extends infer P ? (P extends { comments: (infer C)[] } ? C : never) : never;

const PACKAGE_ENTRY = path.resolve(process.cwd(), "dist/index.js");
const TMP_ROOT = path.resolve(process.cwd(), ".tmp", `e2e-${randomUUID()}`);
const nowSeconds = () => Math.floor(Date.now() / 1000);

// Strictly increasing reply timestamps: two replies landing in the same second would tie, and a tie keeps
// insertion order, which would hide whether a reply bumped.
let lastTimestamp = 0;
const nextTimestamp = () => (lastTimestamp = Math.max(nowSeconds(), lastTimestamp + 1));

const activePosts = (community: Community): PagePost[] => community.posts.pages["active"]?.comments ?? [];

// pkc-js emits `update` on a LocalCommunity after every publish and on a RemoteCommunity after every record
// it loads. Resolve once the predicate holds; fail with the last page seen instead of an opaque timeout.
async function waitForActivePage(community: Community, predicate: (posts: PagePost[]) => boolean, what: string): Promise<PagePost[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      community.off("update", check);
      reject(new Error(`timed out waiting for ${what}; last active page: ${JSON.stringify(activePosts(community).map(summarize))}`));
    }, 150_000);
    const check = () => {
      const posts = activePosts(community);
      if (!predicate(posts)) return;
      clearTimeout(timer);
      community.off("update", check);
      resolve(posts);
    };
    community.on("update", check);
    check();
  });
}

const summarize = (post: PagePost) => ({ cid: post.cid, timestamp: post.timestamp, replyCount: post.replyCount, lastReplyTimestamp: post.lastReplyTimestamp });

// The walk a UI does before re-sorting with a requireReplies package: every preloaded `old` reply page,
// recursively, into one flat list. The test threads are a few replies each, so the preloaded pages are the
// whole tree; a chunked page would need fetching, which this walk refuses instead of silently truncating.
function walkReplies(entry: PagePost): PageSortReplyEntry[] {
  const replies = entry.replies;
  if (!replies) return [];
  const page = replies.pages["old"];
  if (!page || page.nextCid || Object.keys(replies.pageCids ?? {}).length > 0)
    throw new Error(`reply tree of ${entry.cid} is not fully preloaded: ${JSON.stringify(Object.keys(replies.pageCids ?? {}))}`);
  return page.comments.flatMap((child) => [toReplyEntry(child), ...walkReplies(child)]);
}

// A page entry is a superset of PageSortReplyEntry except under exactOptionalPropertyTypes: the page types
// `commentUpdate.edit` as `T | undefined`, the reply entry as an optional `T`. Drop the key when it is unset.
const toReplyEntry = (child: PagePost): PageSortReplyEntry => {
  const { edit, ...commentUpdate } = child.raw.commentUpdate;
  return { comment: child.raw.comment, commentUpdate: edit === undefined ? commentUpdate : { ...commentUpdate, edit } };
};

const toPageEntry = (post: PagePost): PageEntry => {
  const { replies: _preloaded, ...commentUpdate } = post.raw.commentUpdate; // score never sees the preloaded slice
  return { comment: post.raw.comment, commentUpdate };
};

async function publishAndVerify<T extends Comment | CommentEdit>(comment: T): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no challengeverification within 120s")), 120_000);
    comment.once("challengeverification", (verification: { challengeSuccess: boolean; reason?: string | undefined }) => {
      clearTimeout(timer);
      if (verification.challengeSuccess) resolve();
      else reject(new Error(`publication rejected: ${verification.reason ?? "no reason"}`));
    });
    comment.publish().catch((error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return comment;
}

describe("@pkcprotocol/active-page-sort on a real community", () => {
  let daemon: KuboDaemon;
  let ownerPKC: PKCInstance;
  let readerPKC: PKCInstance;
  let community: Community;
  let remote: Community;
  let older: Comment;
  let newer: Comment;

  beforeAll(async () => {
    expect(fs.existsSync(PACKAGE_ENTRY), `${PACKAGE_ENTRY} missing: run npm run build (npm run test:e2e does)`).toBe(true);
    fs.mkdirSync(TMP_ROOT, { recursive: true });
    daemon = await startKuboDaemon({ repoDir: path.join(TMP_ROOT, "kubo") });

    const sharedOptions = {
      kuboRpcClientsOptions: [daemon.apiUrl],
      pubsubKuboRpcClientsOptions: [daemon.apiUrl],
      httpRoutersOptions: [] as string[], // never let the default production routers reconfigure the test daemon
      resolveAuthorNames: false,
      publishInterval: 1_000,
      updateInterval: 1_000
    };
    ownerPKC = await PKC({ ...sharedOptions, dataPath: path.join(TMP_ROOT, "owner") });
    readerPKC = await PKC({ ...sharedOptions, dataPath: path.join(TMP_ROOT, "reader") });
    for (const pkc of [ownerPKC, readerPKC]) pkc.on("error", (error: unknown) => console.error("pkc error", error));

    community = await ownerPKC.createCommunity({ title: "sage e2e" });
    await community.edit({
      settings: {
        ...community.settings,
        challenges: [], // no captcha: the test publishes programmatically
        pages: {
          posts: [{ path: PACKAGE_ENTRY, options: { [NO_BUMP_KEYWORDS_OPTION]: "sage" }, preloaded: true }],
          replies: [{ name: "old", preloaded: true }]
        }
      }
    });
    await community.start();

    const base = nowSeconds();
    older = await publishAndVerify(
      await ownerPKC.createComment({
        communityAddress: community.address,
        signer: await ownerPKC.createSigner(),
        title: "older thread",
        content: "posted first",
        timestamp: base - 100
      })
    );
    newer = await publishAndVerify(
      await ownerPKC.createComment({
        communityAddress: community.address,
        signer: await ownerPKC.createSigner(),
        title: "newer thread",
        content: "posted second",
        timestamp: base - 50
      })
    );
    await waitForActivePage(community, (posts) => posts.length === 2, "both posts in the owner's active page");

    remote = await readerPKC.createCommunity({ address: community.address });
    await remote.update();
    await waitForActivePage(remote, (posts) => posts.length === 2, "both posts in the reader's active page");
  });

  afterAll(async () => {
    await remote?.stop().catch(() => {});
    await community?.delete().catch(() => {});
    await Promise.all([ownerPKC?.destroy().catch(() => {}), readerPKC?.destroy().catch(() => {})]);
    await daemon?.stop();
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it("publishes the sort under the built-in's key with the keyword in publicOptions", () => {
    for (const instance of [community, remote]) {
      const published = instance.pageSorts?.posts?.["active"];
      expect(published, "community.pageSorts.posts.active").toBeDefined();
      expect(published?.name, "a path entry publishes no registry name").toBeUndefined();
      expect(published?.publicOptions?.[NO_BUMP_KEYWORDS_OPTION]).toBe("sage");
      expect(published?.publicOptions?.["pinnedFirst"]).toBe("true");
      expect(Object.keys(instance.posts.pages)).toEqual(["active"]);
    }
  });

  it("orders the two fresh threads newest first", () => {
    expect(activePosts(remote).map((post) => post.cid)).toEqual([newer.cid, older.cid]);
  });

  // Publishes a reply and returns it once the community verified it. `parent` is the post or a reply.
  async function reply(parent: Comment, content: string, signer?: Signer): Promise<Comment> {
    if (!parent.cid) throw new Error("parent has no cid");
    const published = await publishAndVerify(
      await ownerPKC.createComment({
        communityAddress: community.address,
        signer: signer ?? (await ownerPKC.createSigner()),
        parentCid: parent.cid,
        postCid: parent.postCid ?? parent.cid,
        content,
        timestamp: nextTimestamp()
      })
    );
    if (!published.cid) throw new Error("reply has no cid after verification");
    return published;
  }

  // The remote page once a thread's newest counted descendant is `lastReplyTimestamp`. pkc-js computes that
  // aggregate over the whole subtree, saged replies included, so it says the reply landed, not how it ranks.
  const waitForThread = (thread: Comment, lastReplyTimestamp: number, what: string) =>
    waitForActivePage(remote, (page) => page.find((post) => post.cid === thread.cid)?.lastReplyTimestamp === lastReplyTimestamp, what);

  const order = (posts: PagePost[]) => posts.map((post) => post.cid);

  let olderSage: Comment;
  let olderBump: Comment;
  let newerSage: Comment;
  let newerUnderSage: Comment;
  let olderNestedSage: Comment;
  let olderDeepSage: Comment;
  let olderDeep: Comment;
  let olderDeepSigner: Signer;
  let newerSageSigner: Signer;

  // What a UI does with the remote page: walk every reply page, re-sort with the published options, from a
  // reversed input so the re-sort does the work. The walk goes in unfiltered: score skips the tombstones.
  function expectClientOrderToMatch(): void {
    const posts = activePosts(remote);
    const published = remote.pageSorts?.posts?.["active"];
    const ordered = resortLikeAUi({
      comments: [...posts].reverse().map(toPageEntry),
      factory: activePageSort,
      pageSortSettings: { name: published?.name ?? "active", options: published?.publicOptions ?? {} },
      baseTimestamp: nowSeconds(),
      replies: posts.flatMap(walkReplies)
    });
    expect(ordered.map((entry) => entry.commentUpdate.cid), "client re-sort").toEqual(order(posts));
  }

  it("a sage reply reaches the older thread without bumping it", async () => {
    olderSage = await reply(older, "sage");
    const posts = await waitForThread(older, olderSage.timestamp, "the sage reply to land on the older thread");
    expect(posts.find((post) => post.cid === older.cid)?.replyCount).toBe(1);
    expect(order(posts), "the saged thread stays behind the newer one").toEqual([newer.cid, older.cid]);
  });

  it("a normal reply bumps the older thread to the top", async () => {
    olderBump = await reply(older, "sage is overused, this bumps");
    const posts = await waitForThread(older, olderBump.timestamp, "the bump reply to land on the older thread");
    expect(posts.find((post) => post.cid === older.cid)?.replyCount).toBe(2);
    expect(order(posts)).toEqual([older.cid, newer.cid]);
  });

  it("a sage reply on the trailing newer thread leaves it behind", async () => {
    newerSageSigner = await ownerPKC.createSigner();
    newerSage = await reply(newer, "sage", newerSageSigner);
    const posts = await waitForThread(newer, newerSage.timestamp, "the sage reply to land on the newer thread");
    expect(order(posts)).toEqual([older.cid, newer.cid]);
  });

  it("a normal reply nested under that sage reply (depth 2) bumps the newer thread", async () => {
    newerUnderSage = await reply(newerSage, "disagreeing with the sage");
    expect(newerUnderSage.depth).toBe(2);
    const posts = await waitForThread(newer, newerUnderSage.timestamp, "the depth-2 reply to land on the newer thread");
    expect(posts.find((post) => post.cid === newer.cid)?.replyCount).toBe(2);
    expect(order(posts)).toEqual([newer.cid, older.cid]);
  });

  it("sage replies at depth 2 and 3 on the trailing older thread do not bump it", async () => {
    olderNestedSage = await reply(olderBump, "sage");
    olderDeepSage = await reply(olderNestedSage, "replying anyway\nsage");
    expect([olderNestedSage.depth, olderDeepSage.depth]).toEqual([2, 3]);
    const posts = await waitForThread(older, olderDeepSage.timestamp, "the depth-2 and depth-3 sage replies to land on the older thread");
    expect(posts.find((post) => post.cid === older.cid)?.replyCount).toBe(4);
    expect(order(posts)).toEqual([newer.cid, older.cid]);
  });

  it("a normal reply at depth 3, under two sage replies, bumps the older thread", async () => {
    olderDeepSigner = await ownerPKC.createSigner();
    olderDeep = await reply(olderNestedSage, "deep in the thread, still bumps", olderDeepSigner);
    expect(olderDeep.depth).toBe(3);
    const posts = await waitForThread(older, olderDeep.timestamp, "the depth-3 reply to land on the older thread");
    expect(order(posts)).toEqual([older.cid, newer.cid]);
  });

  it("a client re-sorting the remote page from the walked reply tree lands on the community's order", () => {
    const walked = activePosts(remote).flatMap(walkReplies);
    const everyReply = [olderSage, olderBump, newerSage, newerUnderSage, olderNestedSage, olderDeepSage, olderDeep];
    expect(walked.map((entry) => entry.commentUpdate.cid).sort(), "the walk reached every reply at every depth").toEqual(everyReply.map((c) => c.cid).sort());
    expectClientOrderToMatch();
  });

  it("deleting the depth-3 bump drops it from the scored replies and the older thread sinks again", async () => {
    if (!olderDeep.cid) throw new Error("depth-3 reply has no cid");
    await publishAndVerify(
      await ownerPKC.createCommentEdit({
        communityAddress: community.address,
        commentCid: olderDeep.cid,
        deleted: true,
        signer: olderDeepSigner
      })
    );
    const posts = await waitForThread(older, olderDeepSage.timestamp, "the deleted depth-3 reply to drop out of the older thread");
    expect(order(posts)).toEqual([newer.cid, older.cid]);
  });

  it("a client re-sort of the raw walk still lands on the community's order: the walk keeps the deleted reply, score skips it", () => {
    const walked = activePosts(remote).flatMap(walkReplies);
    expect(walked.find((entry) => entry.commentUpdate.cid === olderDeep.cid)?.commentUpdate.edit?.deleted, "the reply page keeps the deleted reply").toBe(true);
    expectClientOrderToMatch();
  });

  it("deleting a sage reply leaves a tombstone: the normal reply under it still bumps the newer thread", async () => {
    if (!newerSage.cid) throw new Error("sage reply has no cid");
    await publishAndVerify(
      await ownerPKC.createCommentEdit({
        communityAddress: community.address,
        commentCid: newerSage.cid,
        deleted: true,
        signer: newerSageSigner
      })
    );
    // replyCount follows the same rule as the sort: the tombstone drops out, the depth-2 reply under it stays.
    const posts = await waitForActivePage(
      remote,
      (page) => page.some((post) => post.cid === newer.cid && post.replyCount === 1),
      "the deleted sage reply to drop out of the newer thread's reply count"
    );
    expect(order(posts), "cutting the subtree would sink the newer thread behind the older one").toEqual([newer.cid, older.cid]);
    const walked = activePosts(remote).flatMap(walkReplies);
    expect(walked.find((entry) => entry.commentUpdate.cid === newerSage.cid)?.commentUpdate.edit?.deleted, "the reply page keeps the tombstone").toBe(true);
    expect(walked.some((entry) => entry.commentUpdate.cid === newerUnderSage.cid), "and the reply under it").toBe(true);
    expectClientOrderToMatch();
  });
});
