# AGENTS Notes

Reference source files for this repository, all in the pkc-js repository:

`docs/protocol/page-sorts.md` (the contract this package implements, and the client-side guidance)
`src/community/schema.ts` (`PageSortFileSchema`, `CommunityPageSortSettingSchema`)
`src/pages/types.ts` (`PageSortReplyEntry`)
`test/fixtures/page-sorts/active-no-bump-keyword.js` (the reference implementation this package grew from)
`test/node/pages/active.e2e.page-sorts.test.ts` and `test/node-and-browser/pages/page-sorts-client-test-util.ts` (how pkc-js itself tests this shape)

Workflow:

- Before every commit, run `npm run typecheck`, `npm test` and `npm run test:e2e`, and see them pass. CI runs
  the same three.
- The e2e starts its own kubo daemon on ports 15301 / 18380 / 24301. Never kill daemons by pattern
  (`pkill -f "ipfs daemon"` takes down whatever else is running); the helper stops its child by PID. If the
  ports are taken, move them with `KUBO_E2E_API_PORT` / `KUBO_E2E_GATEWAY_PORT` / `KUBO_E2E_SWARM_PORT`.
- Temporary files go under `.tmp/` in the repository, never `/tmp`.

Conventions specific to this package:

- `README.md` is the spec. Behaviour changes belong there first.
- `sortName` is `active` on purpose: UIs reading `community.posts.pages.active` keep working. Changing it
  breaks every board using the package.
- `NO_BUMP_KEYWORDS_OPTION` (`noBumpKeywords`) is the wire contract. UIs read it off
  `community.pageSorts.posts.active.publicOptions` to render a sage marker, and most of them never install
  this package. A rename is a new contract, never an edit. The literal is pinned in `test/unit/no-bump.test.ts`.
- The match is a whole line equal to the keyword, exact and case-sensitive. `src/no-bump.ts` imports
  nothing and must keep matching what the README describes, because UIs copy or bundle it for the browser.
- `score` is sync and never returns `null`: a saged thread sinks, it is not filtered. It reads
  `comment.timestamp`, the reserved `exclude*` options, and per reply `timestamp`, `content`, and the
  CommentUpdate's `removed`, `approved`, `pendingApproval` and `edit.deleted`. There is no database access and
  no network; a need for either is a later iteration of the pkc-js contract, not a reason to reach around it.
- `isCountedReply` / `bumpTimestamp` (in `src/no-bump.ts`) apply the `exclude*` options to each reply's own
  CommentUpdate, the tombstone rule of pkc-js's "Which replies count" (`docs/protocol/comment-lifecycle.md`):
  a dropped reply does not bump, the replies under it are judged on their own, never cut. pkc-js passes every
  reply to `score` except foreign and CommentUpdate-less ones (pkc-js#407). Flag parsing matches pkc-js
  (trimmed, case-insensitive `true`). With the `posts` defaults it must match the built-in `active`. A new
  reserved exclusion in pkc-js means a release here. `excludeCommentsWithDifferentCommunityAddress` is left
  out on purpose: pkc-js applies it, and `score` has no community address (pkc-js#401).
- The scorer ignores `commentUpdate.lastReplyTimestamp` on purpose. That aggregate counts saged replies.
- `validatePageSortSettings` is sync and rejects only what can never work (empty list, line break, size
  bounds). An unset option is valid and means plain bump order.
- Test fixtures are typed against pkc-js's own types through `test/unit/fixtures.ts`. Do not cast a
  fixture through `unknown`; a field that does not exist on the wire must fail to compile.
- Never use the `any` type.

Releasing:

- Releases are automatic. A push to `master` runs CI, and on success `release.yml` runs release-it, which
  bumps the version from the conventional-commit types, tags it, cuts a GitHub release, and publishes to
  npm with provenance.
- Publishing authenticates with npm trusted publishing (OIDC), not a token. `release.yml` needs
  `id-token: write` and pins the npm CLI to `npm@11`.
- A trusted publisher is configured under npm's package settings, so the package has to exist first. The
  first version is published by hand and has no provenance attestation. Every version after it is signed
  by CI. Never publish by hand once the trusted publisher is configured.
