import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import PKC from "@pkcprotocol/pkc-js";
import { NO_BUMP_KEYWORDS_OPTION } from "../../src/no-bump.js";
import { startKuboDaemon, type KuboDaemon } from "./kubo-daemon.js";

// End to end on a real daemon and a real community, the way an operator runs it: the built package is
// named by `path` in settings.pages, pkc-js imports it, generates the `active` pages with it and publishes
// `community.pageSorts`. A `sage` reply to the older thread leaves it behind the newer one; a normal reply
// then bumps it ahead. The remote reader is a second PKC on the same daemon, loading the record over IPNS
// like a UI would. Run with `npm run test:e2e` (builds first: `path` points at dist/index.js).

type PKCInstance = Awaited<ReturnType<typeof PKC>>;
type Community = Awaited<ReturnType<PKCInstance["createCommunity"]>>;
type Comment = Awaited<ReturnType<PKCInstance["createComment"]>>;
type PagePost = Community["posts"]["pages"][string] extends infer P ? (P extends { comments: (infer C)[] } ? C : never) : never;

const PACKAGE_ENTRY = path.resolve(process.cwd(), "dist/index.js");
const TMP_ROOT = path.resolve(process.cwd(), ".tmp", `e2e-${randomUUID()}`);
const nowSeconds = () => Math.floor(Date.now() / 1000);

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

async function publishAndVerify(comment: Comment): Promise<Comment> {
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
  if (!comment.cid) throw new Error("comment has no cid after verification");
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

  it("a sage reply reaches the older thread without bumping it", async () => {
    const sage = await publishAndVerify(
      await ownerPKC.createComment({
        communityAddress: community.address,
        signer: await ownerPKC.createSigner(),
        parentCid: older.cid,
        postCid: older.cid,
        content: "sage",
        timestamp: nowSeconds()
      })
    );
    const posts = await waitForActivePage(
      remote,
      (page) => page.find((post) => post.cid === older.cid)?.lastReplyTimestamp === sage.timestamp,
      "the sage reply to land on the older thread"
    );
    expect(posts.find((post) => post.cid === older.cid)?.replyCount).toBe(1);
    expect(posts.map((post) => post.cid), "the saged thread stays behind the newer one").toEqual([newer.cid, older.cid]);
  });

  it("a normal reply bumps the older thread to the top", async () => {
    const bump = await publishAndVerify(
      await ownerPKC.createComment({
        communityAddress: community.address,
        signer: await ownerPKC.createSigner(),
        parentCid: older.cid,
        postCid: older.cid,
        content: "sage is overused, this bumps",
        timestamp: nowSeconds()
      })
    );
    const posts = await waitForActivePage(
      remote,
      (page) => (page.find((post) => post.cid === older.cid)?.replyCount ?? 0) >= 2 && page.find((post) => post.cid === older.cid)?.lastReplyTimestamp === bump.timestamp,
      "the bump reply to land on the older thread"
    );
    expect(posts.map((post) => post.cid)).toEqual([older.cid, newer.cid]);
  });
});
