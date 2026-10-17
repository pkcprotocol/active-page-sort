# @pkcprotocol/active-page-sort

Bump order for [pkc-js](https://github.com/pkcprotocol/pkc-js) communities where a reply that says `sage` (or any keyword the board picks) does not bump its thread. It is the built-in `active` sort with one extra rule, packaged as a configurable page sort ([pkc-js#73](https://github.com/pkcprotocol/pkc-js/issues/73)) so an imageboard such as 5chan can run the real thing instead of faking it in the UI.

## What it does

A board's catalog shows threads in bump order: the thread with the newest reply is first. On imageboards, a reply whose options say `sage` is a reply that must not bump the thread. This package implements exactly that, on the community side, where the order is decided:

- A thread's **bump time** is the newest of the post's own timestamp and the timestamps of its replies that are **not** no-bump replies.
- A **no-bump reply** is a reply whose content has a whole line equal to one of the configured keywords. The match is exact and case-sensitive: a content of `sage`, or a multi-line content with a line that is exactly `sage`, does not bump. `sage is overused` in prose, `Sage`, `#sage` and ` sage` all bump.
- Replies **under** a no-bump reply still count, at any depth. Someone answering a saged reply bumps the thread as usual.
- A reply the sort's exclusion options drop (by default: removed, deleted, disapproved or pending approval) never counts, and neither does anything under it. Deleting a saged reply also takes the answers under it out of the bump.
- A saged thread **sinks, it is never hidden**. The sort ranks, it does not filter.
- With the keyword option unset the sort is plain bump order, identical to pkc-js's built-in `active`.

The sort publishes under the wire key `active`, the same key as the built-in, so a UI that already reads `community.posts.pages.active` shows the saged order without any change. The community also publishes what the key means in `community.pageSorts.posts.active`, including the keyword list, so a UI can tell this sort from the built-in and render a sage marker on matching replies.

The word `sage` appears nowhere in this package. The board supplies its vocabulary through the `noBumpKeywords` option.

## How the sorting works

pkc-js regenerates a community's post pages on every publish cycle. For each configured sort it calls the sort file's `score` once per post, higher scores first, equal scores in insertion order. Because this sort declares `requireReplies`, pkc-js hands `score` every descendant of the post as one flat list (reduced by the sort's exclusion options, so removed or deleted replies are already gone, together with their subtrees), and the score is:

```
counted = replies reachable from the post through replies the exclusion options keep
max(post.timestamp, ...counted.filter(not no-bump).map(reply => reply.timestamp))
```

On the community the first line changes nothing: pkc-js already applied the exclusions. It is there for clients. The reply pages a UI walks keep deleted and removed replies, so `score` applies the published `exclude*` options itself, which makes a raw walk land on the community's order (see [Re-sort a page locally](#4-re-sort-a-page-locally-optional)). That is the whole algorithm. pkc-js owns everything around it: pinned threads first (`pinnedFirst`), the optional age window (`maxAge`), chunking into pages, the moderation exclusions. The file contains no date arithmetic and never sees a pinned flag.

The same `score` function runs on a client that installed this package, so a UI can re-sort a page it holds and land on the community's order. See [For UI developers](#for-ui-developers).

### Cost on the community

The built-in `active` reads one number off each post's CommentUpdate (`lastReplyTimestamp`). This sort has to look at the replies, so each post-page generation reads each post's reply rows once more. pkc-js streams them one batch of posts at a time, so the cost is extra database reads per generation, not memory. Post pages are rebuilt on every publish and at least every 15 minutes. On a small or medium board this is not measurable; the pkc-js benchmark for the shape of this sort is `test/benchmarks/page-generation-bench.mjs` in the pkc-js repository.

## Requirements

- pkc-js `>=0.0.110` (configurable page sorts, `settings.pages`, and the page sort types exported from the root)
- Node.js `>=22` on the machine running the community
- ESM-only environment

## Install and configure on your community

`settings.pages` works like `settings.challenges`: a list of entries per scope, each naming a sort by registry `name` or by file `path`, with string options. `settings` is replaced wholesale on edit, so pass the existing settings along. Any change to `settings.pages` regenerates every CommentUpdate once on the next pass; that is the one-time cost of the edit.

### With pkc-js (TypeScript), running your own node

```bash
npm install @pkcprotocol/active-page-sort
```

Register the factory under a name when creating the PKC instance, then name it in the community's settings:

```ts
import PKC from "@pkcprotocol/pkc-js";
import activePageSort from "@pkcprotocol/active-page-sort";

const pkc = await PKC({
    // ...your options
    pageSorts: { "@pkcprotocol/active-page-sort": activePageSort }
});

const community = await pkc.createCommunity({ address: "yourboard.bso" });
await community.edit({
    settings: {
        ...community.settings,
        pages: {
            posts: [{ name: "@pkcprotocol/active-page-sort", options: { noBumpKeywords: "sage" }, preloaded: true }],
            replies: [{ name: "old", preloaded: true }]
        }
    }
});
```

`replies: [{ name: "old", preloaded: true }]` is what an imageboard shows inside a thread (oldest first). Leave `replies` unset to keep pkc-js's five default reply sorts.

### By file path

A `path` entry loads a file from the filesystem of the process running the community (the RPC server, under RPC). Point it at this package's entry file:

```ts
await community.edit({
    settings: {
        ...community.settings,
        pages: {
            posts: [
                {
                    path: "/absolute/path/to/node_modules/@pkcprotocol/active-page-sort/dist/index.js",
                    options: { noBumpKeywords: "sage" },
                    preloaded: true
                }
            ],
            replies: [{ name: "old", preloaded: true }]
        }
    }
});
```

A `path` entry publishes no `name` in `community.pageSorts` (the client cannot know which package a path is). Prefer the registry `name` when you can.

### With bitsocial-cli

bitsocial-cli installs challenge packages into the data path and registers them by name; the equivalent `bitsocial page-sort install` command is planned on the same registry. Until it ships, use the `path` form above against the RPC server's filesystem:

```bash
bitsocial community edit yourboard.bso \
  '--settings.pages.posts[0].path' /absolute/path/to/node_modules/@pkcprotocol/active-page-sort/dist/index.js \
  '--settings.pages.posts[0].options.noBumpKeywords' sage \
  '--settings.pages.posts[0].preloaded' true \
  '--settings.pages.replies[0].name' old \
  '--settings.pages.replies[0].preloaded' true
```

### Options

Page sort options are strings, like challenge options. Unlike challenge options they are **public by default**: everything set in `options` is published in `community.pageSorts.posts.active.publicOptions` unless its name is listed in the entry's `privateOptions`.

| Option | Required | Published in `publicOptions` | Default | Description |
|---|---|---|---|---|
| `noBumpKeywords` | no | yes, unless listed in `privateOptions` | unset (plain bump order) | Comma-separated keywords, e.g. `sage` or `sage,nobump`. A reply whose content has a whole line equal to one of these does not bump its thread. Exact and case-sensitive |
| `maxAge` | no | always (reserved) | none | pkc-js reserved: a sliding window such as `"36h"`, `"7d"`, `"2w"`, `"1M"`, `"1y"`. Threads older than the window drop out of the pages (pinned threads bypass it) |
| `pinnedFirst` | no | always (reserved) | `"true"` | pkc-js reserved: pinned threads first and outside the window. `"false"` treats them as ordinary threads |
| `excludeRemovedComments`, `excludeDeletedComments`, `excludeCommentPendingApproval`, `excludeCommentWithApprovedFalse`, `excludeCommentsWithDifferentCommunityAddress` | no | always (reserved) | `"true"` for the `posts` scope | pkc-js reserved moderation filters on the comment set the sort starts from. A reply excluded here, and everything under it, does not count toward a bump. `score` re-applies the first four to the replies it receives, so a client's raw walk scores like the community; `excludeCommentsWithDifferentCommunityAddress` needs the community's address, which `score` does not get, and is left to pkc-js ([pkc-js#401](https://github.com/pkcprotocol/pkc-js/issues/401)) |

Keep `noBumpKeywords` public unless you have a reason not to: a UI reads it to know the board supports sage, to put the keyword on the wire the way the sort reads it, and to mark saged replies. With the option private the order still applies but UIs cannot do any of that. The reserved options cannot be made private (`ERR_PAGE_SORT_RESERVED_OPTION_CANNOT_BE_PRIVATE`): a client re-sorting a page must know how its comment set was filtered. Their full semantics are in the pkc-js page sorts doc, "Reserved options". `score` mirrors pkc-js's handling of the exclusion flags it can apply; if pkc-js adds a reserved exclusion, this package needs a release that applies it too, until then a client re-sort counts replies the new flag drops.

### Validation

The entry is validated when the community is created, on every edit (rejecting the whole write) and on start. This package rejects:

- `noBumpKeywords` set but holding no keyword (`""`, `" , ,"`): that would silently be plain bump order. Unset it instead.
- More than 64 keywords, or a keyword over 128 characters.
- A keyword containing a line break, which can never equal a line.

Failures surface as `ERR_PAGE_SORT_SETTINGS_VALIDATION_FAILED` inside pkc-js's aggregated `ERR_PAGE_SORT_SETTINGS_VALIDATION_FAILED_FOR_PAGE_SORTS`.

### What is published

```ts
community.pageSorts = {
    posts: {
        active: {
            name: "@pkcprotocol/active-page-sort", // absent for a path entry
            description: "Bump order where a reply whose content has a line equal to a configured keyword does not bump its thread",
            publicOptions: {
                noBumpKeywords: "sage",
                pinnedFirst: "true",
                excludeRemovedComments: "true",
                excludeDeletedComments: "true",
                excludeCommentPendingApproval: "true",
                excludeCommentWithApprovedFalse: "true",
                excludeCommentsWithDifferentCommunityAddress: "true"
            }
        }
    }
};
```

Add `noBumpKeywords` to the entry's `privateOptions` to keep the list out of the record. UIs then cannot mark saged replies; the order still applies.

## For UI developers

Nothing here is required to display the board: the community publishes the pages already ordered. These are the extras a UI can offer.

### 1. Know the board supports sage

```ts
const published = community.pageSorts?.posts?.active;
const keywords = published?.publicOptions?.noBumpKeywords; // "sage", or undefined on a board without this sort
```

A board that never configured `settings.pages` has no `pageSorts`; its `active` is the built-in and `sage` is just text.

### 2. Put `sage` on the wire the way the sort reads it

The convention is a whole line of the reply's `content` equal to the keyword. When the user types `sage` in an Options field, append it to the content as its own line:

```ts
const content = userText.trimEnd() ? `${userText.trimEnd()}\nsage` : "sage";
```

The sort file is the contract. A board that wants another convention edits the keyword list, not the UI.

### 3. Mark saged replies

```ts
import { isNoBumpReplyForOptions } from "@pkcprotocol/active-page-sort";

const saged = isNoBumpReplyForOptions(reply.content, community.pageSorts?.posts?.active?.publicOptions);
```

`isNoBumpContent(content, keywords)` and `splitKeywords(raw)` are the same test without the options lookup, and `bumpTimestamp({ postTimestamp, replies, keywords })` gives a thread's effective bump time. For a reply tree walked from reply pages, pass it through `applyReplyExclusions({ postCid, replies, options })` first, with the published `publicOptions`, to drop what the community did not count. `src/no-bump.ts` imports nothing and bundles for a browser.

### 4. Re-sort a page locally (optional)

pkc-js exports no sorter: the package's `score` is the whole contract. A UI that wants to re-order threads between community publishes (a user's own reply just landed, say) applies `score` itself. This sort declares `requireReplies`, so it needs each thread's replies: walk a flat reply sort (`newFlat` / `oldFlat`) when the post carries one, otherwise the nested sort's pages recursively, at every depth. Walk all of it: every page of every chain, for every thread you re-sort. `score` receives a plain list and cannot tell a partial walk from a complete one, so a thread whose newest bump is on a page you did not fetch ranks too low, with no error. Hand each post its descendants by `parentCid`, as walked, and pass the published `publicOptions` as `options`. Reply pages keep deleted and removed replies, which the community did not count; `score` drops them, and everything under them, using the published `exclude*` options, so no filtering is needed on the UI side. Pass the options as published: without the `exclude*` flags nothing is dropped. The worked example of the walk and the re-sort is `test/node-and-browser/pages/page-sorts-client-test-util.ts` in pkc-js; this package's own copy of the re-sort is `test/unit/resort-like-a-ui.ts`. A re-sorted page is still one slice of one sort: re-sorting it gives that slice in another order, not the whole board.

```ts
import activePageSort from "@pkcprotocol/active-page-sort";

const published = community.pageSorts?.posts?.active;
const file = activePageSort({ pageSortSettings: { name: published?.name ?? "active", options: published?.publicOptions ?? {} } });
const scored = page.comments.map((pageComment, index) => {
    const { replies, ...commentUpdate } = pageComment.raw.commentUpdate; // score never sees the preloaded reply slice
    return { pageComment, index, score: file.score({ comment: pageComment.raw.comment, commentUpdate, options: published?.publicOptions ?? {}, baseTimestamp: Math.round(Date.now() / 1000), replies: descendantsOf(pageComment.cid) }) };
});
scored.sort((a, b) => b.score! - a.score! || a.index - b.index); // then hoist pinned unless publicOptions.pinnedFirst === "false"
```

Treat `community.pageSorts[].name` as data: look it up in your own registry, never import from it.

## Exports

| Export | What it is |
|---|---|
| `default` / `activePageSort` | The `PageSortFileFactory` pkc-js calls |
| `SORT_NAME`, `DESCRIPTION`, `optionInputs`, `validatePageSortSettings` | The file's declared surface, for config UIs and tests |
| `NO_BUMP_KEYWORDS_OPTION` | `"noBumpKeywords"`, the option key. Renaming it is a new contract |
| `splitKeywords`, `isNoBumpContent`, `bumpTimestamp`, `isNoBumpReplyForOptions` | The matching rules, import-free, for browsers |
| `applyReplyExclusions`, `EXCLUSION_OPTIONS` | The replies a thread's bump counts: the published `exclude*` options applied to a walked reply tree, subtrees of dropped replies cut. Import-free |
| `PageSortFile`, `PageSortFileInput`, `PageSortFileFactory`, `PageSortFileFactoryInput`, `PageSortFileFactoryArgs`, `PageSortScoreArgs`, `PageSortReplyEntry`, `PageSortScope`, `CommunityPageSortSetting` | Re-exported pkc-js types (root exports since pkc-js 0.0.110) |
| `PageSortSettingsEntry` | Alias of `CommunityPageSortSetting`, the `settings.pages` entry the factory receives |

## Development

```bash
npm install
npm run typecheck
npm test            # unit tests: no network, no daemon
npm run test:e2e    # builds, starts a throwaway kubo daemon, runs a real community with this sort
```

| Path | What it is |
|---|---|
| `src/active-page-sort.ts` | The factory: `sortName`, `scope`, `requireReplies`, `optionInputs`, `score`, `validatePageSortSettings` |
| `src/no-bump.ts` | Keyword splitting, the line match, the bump-time fold. Imports nothing |
| `src/types.ts` | Re-exports of the pkc-js page sort types |
| `test/unit/` | The contract: match semantics, scorer, validation, and a client re-sort reproducing the community order |
| `test/e2e/` | A kubo daemon from the `kubo` npm package on ports 15301/18380/24301 (override with `KUBO_E2E_*_PORT`), a pkc-js community configured by `path`, `sage` and normal replies at depths 1 to 3, author deletions that cut a subtree, read back by a second PKC over IPNS and re-sorted from the walked reply tree |

The e2e writes everything under `.tmp/` in the repository and removes it afterwards.

## License

GPL-3.0-or-later, the same as pkc-js.
