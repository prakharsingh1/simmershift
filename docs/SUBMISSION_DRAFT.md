# SimmerShift submission draft

**Status: final local prototype and demo verified; source, screenshots, and MCP evidence published and verified under MIT; submission pending.** No public video URL is invented here.

## Entry fields

| Field | Draft value |
| --- | --- |
| Project name | SimmerShift |
| Tagline | Dinner stays on track when plans change. |
| Primary track | Alexa+ |
| Technical route | **Alternate simulated Alexa+ experience**, backed by a real local MCP `2025-11-25` Streamable HTTP server tested with the official SDK client. |
| Mini challenges | None claimed. |
| Source repository | [Public GitHub `prakharsingh1/simmershift`](https://github.com/prakharsingh1/simmershift), MIT copyright 2026 Prakhar Singh; full 36-file source/assets snapshot verified at [41e1074](https://github.com/prakharsingh1/simmershift/commit/41e1074bcd87d8c38dcad79df75b6d5145f960ba). No MP4 included. |
| Demo video | Local/private review copy `demo/assets/simmershift-demo-captioned.mp4`, 85.50 seconds, excluded from the public repository; public upload URL and exact title/channel approval pending. |
| Live URL | None; local reproducible app. |
| Real Alexa+ integration | Not attempted or tested. |
| Team/entrant details | To be supplied and checked by the entrant. |

## Project story

### Inspiration

Dinner rarely follows the original plan. Someone needs attention, an ingredient is missing, or a burner is occupied. A static recipe leaves the cook to work out which steps still matter and whether everything can finish together. We wanted an assistant that remembers progress and helps recover the plan.

### What it does

SimmerShift recovers dinner after an interruption. It keeps finished and started work, tracks independent timers, and reschedules remaining steps around available equipment and a serving target. When rice has not yet been prepared and the pantry contains suitable couscous, the engine can automatically switch bases if that meaningfully improves a late finish. It explains the choice and reports any remaining delay.

A resume briefing highlights active timers, kept progress, and ready next actions. A persistent recovery journal preserves the reasons for changes rather than losing them on the next operation. The cooking session, including progress and explanations, can be reopened after a server restart. Request IDs make a duplicate mutation retry safe, while revisions protect against stale edits.

The first version focuses on one curated plant-based meal family. The chosen entry route is the **alternate simulated Alexa+ experience** in a local timeline interface. The real local MCP server is tested engineering support for this workflow; this project has not been onboarded to or tested with real Alexa+.

### How it is built

The implementation uses TypeScript, the official MCP server/client/Node transport packages, Zod schemas, and Node's built-in SQLite. The server explicitly supports MCP protocol `2025-11-25`. A deterministic engine selects available components and schedules their dependency graph without a runtime language-model call. The web demo and MCP tools share the same session service. Idempotency receipts and revision checks make retries and concurrent edits explicit rather than silently overwriting progress.

The recipe assumptions are white rice and canned or already cooked legumes. A persisted logical clock supports simulated interruption minutes for the demo; the recording must label the time advance explicitly.

### What makes the workflow useful

The value is continuity through disruption: started food stays in the plan, constrained resources shape the next actions, duplicate requests do not repeat changes, and the recovery journal explains the decisions. The engine can compare a valid faster alternative before work starts, then give an honest serving estimate. The tool boundary is usable by an agent, while the timeline lets a person inspect and control the workflow directly. Local execution keeps the demo inexpensive and reproducible.

### Challenges and lessons

The hardest product decision is what a pause means in a kitchen. A software pause cannot pause a stove. SimmerShift records a workflow interruption while retaining running timer deadlines and an advancing display. Any equipment change must be supplied by the person. Another challenge is preserving valid progress during substitution: a faster ingredient can only rescue the plan before preparation has started, and its benefit must be checked against the entire resource schedule.

Development observations are recorded in [FRICTION_LOG.md](FRICTION_LOG.md), including environment-specific package-resolution friction and navigating the current split SDK. These observations must not be attributed to an Alexa device that was never tested.

### Next steps

Expand the recipe catalog and substitution rules, validate recovery briefings with cooks, and test onboarding with an actual Alexa+ client when access and terms permit. A real add-on requires remote deployment, authentication, and measured client behavior described in the [architecture route decision](ARCHITECTURE.md#entry-route-and-future-alexa-onboarding); those are future work, not part of the local simulation claim.

## Product feedback draft

Feedback below reflects the completed local build. It must accompany the approved final content; no real Alexa+ device feedback is claimed.

| Tool or SDK | Use | Feedback grounded in current observations |
| --- | --- | --- |
| Official TypeScript MCP SDK | Register server tools, provide Streamable HTTP transport, and exercise the server with the SDK client. | The final integration negotiated `2025-11-25`, discovered eight tools, and recovered a session after HTTP-server restart. Onboarding required current split-package documentation rather than older examples; guessed documentation/example paths failed. Linked docs and installed types provided the workaround. Would use again: yes, for a typed tool interface and protocol-level tests. |
| Zod | Validate structured tool inputs. | Schemas rejected invalid portions, equipment, timestamps, and malformed inputs in the test suite. Inputs can use the same validation at the MCP and local adapter boundaries. No Zod-specific failure was observed in this build. Would use again: yes, for clear structured tool contracts. |
| Node.js SQLite | Persist cooking sessions, mutation receipts, and recovery journal entries locally. | Tests reopened SQLite and restarted actual server processes while preserving progress, pause state, timer deadlines, replay records, and explanations. Atomic-conflict tests kept the stored meal intact. Onboarding needed no database service; Node 24+ is required. No SQLite-specific failure was observed. Would use again: yes, for a reproducible local workflow. |
| TypeScript and tsx | Typecheck/build and execute development/tests without a bundler. | Typecheck/build passed. The earlier CLI runner's IPC pipe was denied in the sandbox; `node --import tsx` worked around that environment constraint. Updating tsx also removed an old development-dependency advisory. Would use again: yes, with the current runner and committed lockfile. |
| Playwright CLI and isolated Chrome | Exercise desktop/mobile UI behavior and capture demo assets without using a shared profile. | Final QA completed with zero console errors/warnings. A cached-browser version mismatch and transient npx metadata problem needed an installed Chrome executable plus a dedicated temporary CLI installation. These were local setup issues. Would use again: yes, for isolated reproducible interaction checks and capture. |
| Alexa+ | Intended track and simulated interaction style. | No device/service integration was attempted, so no device onboarding, reliability, or performance claim is made. |

## Verified rules checklist

Checked the [official rules](https://amazonappdev2026.devpost.com/rules) during implementation. Recheck before final submission.

- Deadline: **October 23, 2026, 19:00 UTC** (12:00 PDT).
- Alexa+: a clearly demonstrated simulation is an allowed alternative; **this entry selects that route**. The separate local server uses MCP **2025-11-25** over **Streamable HTTP**.
- Supply GitHub source, assets, and setup instructions. Use a public repository with a visible open-source license, or the required private judging access.
- Provide a public YouTube/Vimeo demonstration under three minutes, a feature description, and product feedback.
- Keep materials English, substantiate runtime behavior, and confirm ownership, eligibility, and permission for included content.
- Make the project available free for judging through the judging period. A friction log is optional.

This checklist summarizes readiness, not organizer approval or legal advice. The entrant has already approved registration rules; final submission still needs actual deliverables and any newly presented agreement checked.

## Verification and deliverable register

| Item | Current record |
| --- | --- |
| TypeScript/build/test result | Final `npm run check` passed: typecheck, build, and 45/45 tests. `node --check public/app.js` passed. |
| Actual SDK MCP client integration | Final official client run negotiated `2025-11-25`, discovered eight tools, and completed the workflow; [recovery.json](../demo/recovery.json) records 8 assertions. |
| Restart persistence | SQLite reopen, HTTP-server restart, and actual Node child-process restart tests passed; progress, receipts, and journal retained. |
| Idempotency and stale edits | Replay, different-payload/key conflicts, duplicate-safe journal entries, and stale-revision atomicity tests passed. |
| Atomic conflicting constraints | Impossible pantry/avoid/equipment patches and started-food conflicts passed without overwriting state. |
| Valid dependency/resource ordering | Dependency and resource-capacity tests passed, including overlapping passive timers. |
| Interruption recovery | Automatic pre-preparation deadline rescue, started-food preservation, complete workflow recovery, physical-state resume, and changed-heat estimate reset passed. |
| UI visual review | Final isolated Chrome interaction/reload QA passed at desktop 1440 px and mobile 390 px: no page overflow, zero console errors/warnings. Timers advanced while paused; heat-change reset did not complete active food. |
| Demo assets | Primary captioned H.264 1440×900/30 fps silent local demo, 85.50 seconds; original 105.96-second capture retained locally. Both MP4s excluded from public source; private Library review copy saved. [Three screenshots and MCP evidence](../demo/README.md) are published and verified. Synthetic data and labeled clock advance; no Alexa connection. Public video URL pending. |
| Repository source access | [Source, screenshots, and evidence published and verified](https://github.com/prakharsingh1/simmershift/commit/41e1074bcd87d8c38dcad79df75b6d5145f960ba) under MIT; no MP4 included. |
| Final submission | Pending actual content, URLs, and review of newly encountered agreements. |

See [VERIFICATION.md](VERIFICATION.md) for test categories, UI scenarios, evidence paths, and scope limits.

## Approved decision and remaining readiness

1. **Approved, adopted, and source/assets verified:** public **[`prakharsingh1/simmershift`](https://github.com/prakharsingh1/simmershift)** and **MIT, Copyright (c) 2026 Prakhar Singh**. [The license decision is recorded](LICENSE_PROPOSAL.md); source, screenshots, and MCP evidence are published, with both MP4s excluded.
2. **Pending:** exact public YouTube title/channel approval and upload. The local captioned video exists; a public video URL does not.
3. **Before final submission:** add the verified source/video URLs, retain truthful claims, and check any newly presented explicit agreements. Existing registration approval does not establish facts such as entrant eligibility or authorship.

No cloud resources, paid APIs, new account grants, production user data, or unrelated project publication are required for this local build.
