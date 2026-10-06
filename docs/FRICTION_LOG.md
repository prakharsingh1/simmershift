# SimmerShift development friction log

Entries record actual development observations. Device integration has not been attempted.

## 2026-10-06 — Package lookup in restricted execution environment

- Task: resolve current official MCP TypeScript package before implementation.
- Steps: opened official repository/docs and attempted `npm view`; checked cached packages.
- Expected: package metadata available immediately.
- Actual: ordinary package lookup stalled; cached metadata was insufficient for offline resolution. npm also could not write its default log directory under the workspace policy.
- Severity: Important for this local setup; not attributed to Amazon or MCP product behavior.
- Workaround: request network-enabled package command with a separate `/tmp/dinnershift-npm-cache`. Official server metadata resolved as 2.3.1.
- Suggestion: provide an offline bootstrap manifest in constrained development environments.

## 2026-10-06 — SDK documentation version selection

- Task: choose a maintained SDK supporting the required MCP version.
- Steps: read current official TypeScript repository; inspected transport docs.
- Expected: older familiar monolithic package entry point.
- Actual: current SDK is split into client/server/node packages. One guessed v2 transport documentation URL and one guessed example source URL returned unavailable/404.
- Severity: Nice-to-have documentation navigation improvement.
- Workaround: follow official documentation links and inspect installed types/examples instead of assuming older entry points.
- Suggestion: publish a short migration/HTTP entry-point example next to package installation instructions.

## 2026-10-06 — Loopback and development tooling in a sandbox

- Task: run the actual MCP client against the local HTTP server.
- Steps: ran integration tests under the workspace sandbox and checked the TypeScript runner.
- Expected: temporary localhost binding and TypeScript CLI startup.
- Actual: localhost `listen` and the older runner's IPC pipe were denied by this execution environment. This is environment friction, not an MCP or Alexa failure.
- Severity: Important for local protocol verification.
- Workaround: use `node --import tsx` and approved loopback-enabled execution. Actual MCP client checks then passed.
- Suggestion: document loopback requirements in constrained-environment setup instructions.

## 2026-10-06 — Dependency advisory during bootstrap

- Task: audit installed development dependencies.
- Steps: ran npm audit after the initial runner installation.
- Expected: no known advisories.
- Actual: old runner resolution included esbuild 0.27.7, with a low-severity Windows development-server advisory. SimmerShift does not use esbuild's development server.
- Severity: Low; development dependency.
- Workaround: updated tsx to 4.23.15, resolving esbuild 0.28.2. npm installation audit reported zero vulnerabilities.
- Suggestion: use the current maintained runner and commit exact resolution in the lockfile.

## 2026-10-06 — Isolated UI browser version mismatch

- Task: inspect the local demo without touching the shared browser.
- Steps: launched a new nonpersistent Playwright session with Chromium.
- Expected: reuse a cached Playwright browser.
- Actual: the current CLI expected Chromium build 1247 while the environment had build 1234 cached.
- Severity: Nice-to-have for local UI QA; unrelated to Amazon/MCP.
- Workaround: select the existing Chrome executable in an isolated nonpersistent Playwright session; no new browser installation or user-profile attachment.
- Suggestion: report expected/cached browser versions in bootstrap diagnostics and expose installed-browser options clearly.

## 2026-10-06 — Process startup timeout under a busy local host

- Task: verify persistence across an actual Node child-process restart.
- Steps: start the local server, wait for readiness, exercise the session, stop and restart the process.
- Expected: server readiness within the initial ten-second bound.
- Actual: one startup attempt exceeded that bound while the host was busy. This was a local test-harness timing issue, not an observed Amazon, MCP, or SQLite failure.
- Severity: Important for deterministic verification on this host.
- Workaround: use a bounded thirty-second readiness allowance and serialize tests; the final process-restart check passed.
- Suggestion: use readiness signals with a bounded timeout rather than assuming identical process-start timing under load.

## 2026-10-06 — Transient browser CLI cache lacked metadata

- Task: refresh isolated UI QA and capture the final local demonstration.
- Steps: launch the browser tooling through a temporary npx cache.
- Expected: complete browser metadata available to the CLI.
- Actual: the transient cache was missing `browsers.json`, blocking that launch path. This was local tooling setup, unrelated to Amazon or MCP behavior.
- Severity: Important for this UI verification setup.
- Workaround: install the official `@playwright/cli` version `0.1.22` in a dedicated temporary directory under `/tmp`, then use an isolated Chrome session. Final UI checks and capture completed.
- Suggestion: prefer a complete pinned CLI installation for repeatable QA and report missing package metadata directly.

## 2026-10-06 — TLS failures during approved source publication

- Task: publish the explicitly approved public SimmerShift source repository under MIT.
- Steps: attempted Git HTTPS push and API uploads, including small files; checked the remote after failures rather than assuming publication.
- Expected: normal encrypted upload and a verifiable remote commit/tree.
- Actual: the local transport intermittently reported TLS bad-record-MAC errors. The failed initial attempt left no published branch. This was publication-environment friction, not a device, MCP, or application failure.
- Severity: Important for completing source delivery.
- Workaround: retain certificate verification, use TLS 1.2 with bounded 512-byte writes, and compare the published commit/tree with the reviewed source snapshot. Both the initial core snapshot and the full 36-file source/assets snapshot were subsequently verified; no MP4 was published.
- Suggestion: provide clear upload progress and post-failure remote verification; keep secure transport diagnostics separate from project runtime feedback.

## 2026-10-06 — Publishing approval context needed explicit verification

- Task: confirm authority for the exact public repository destination and MIT license.
- Steps: an automatic approval worker did not initially have the human authorization context; independently re-read the original direct human approval before continuing.
- Expected: the publishing check recognizes the already approved destination and license.
- Actual: authorization evidence needed to be checked explicitly rather than inferred from another project or an agent's summary.
- Severity: Important for a correct publishing handoff; unrelated to Amazon or MCP behavior.
- Workaround: verify the original explicit approval and limit publication to that destination/license. No new account grant or altered consent was used.
- Suggestion: carry the approved action's scope into review while keeping private conversation identifiers and credentials out of source artifacts.
