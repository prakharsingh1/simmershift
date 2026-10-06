# SimmerShift local verification

Final local checks completed on **2026-10-06** with **Node.js 26.5.0**. The supported runtime remains Node.js 24+. These results cover the local simulation and MCP server, not a real Alexa+ add-on, production deployment, appliance control, or physical cooking trial.

## Automated results

| Command | Recorded result |
| --- | --- |
| `npm run check` | Passed TypeScript typecheck, all **45 tests**, and production build. |
| `npm run demo` | Passed **8 assertions** through the official MCP SDK client; wrote [demo/recovery.json](../demo/recovery.json). |
| `node --check public/app.js` | Passed browser-script syntax check. |

| Suite | Passed | What it verifies |
| --- | ---: | --- |
| [Planner](../test/planner.test.ts) | 22 | Pantry/exclusions, dependency and resource ordering, parallel schedules, realistic late estimates, substitutions, deadline rescue, and preservation of started food. |
| [Session service](../test/service.test.ts) | 18 | Durable progress/timers/journal, identical retries, conflicting key reuse, stale revisions, atomic constraint failures, pause/resume, required physical-state reports, changed-heat estimate reset, and complete interruption recovery. |
| [MCP and HTTP](../test/mcp.test.ts) | 4 | Official-client protocol negotiation/discovery/tool calls, HTTP-server restart, transport/session handling, and local HTTP input/Origin guards. |
| [Actual child process](../test/process.test.ts) | 1 | Restarting the Node server process retains the paused session, completed work, and idempotency receipts. |
| **Total** | **45** | No failures in the final recorded run. |

The scripted client evidence identifies negotiated protocol **2025-11-25** and all eight tools. It records create retry, persistence after restart, automatic rice-to-couscous deadline rescue, kept sauce preparation, parallel timer deadlines, one-burner recovery, an atomic avoid conflict, and the final served state. Its pantry and clock are synthetic; the logical clock deliberately advances instead of waiting through a real meal.

## Isolated browser review

Actual Chrome interaction checks used an isolated session, without a shared user profile. Desktop review used 1440 px width and mobile review used 390 px width. The final review observed **zero console errors and zero warnings**, with **no page overflow**.

Verified flows:

- Automatic deadline rescue before base preparation, with the revised choice explained.
- Independent active cooking timers and countdowns that keep advancing during workflow pause.
- A physical-state prompt before resuming active heated food.
- Expired timers requiring manual completion confirmation and continuing to reserve equipment.
- One-burner recovery with an honest revised serving estimate.
- Page reload restoring the same saved session and recovery journal.
- Changed heat resetting full-duration estimates while active food remains uncompleted.
- The mobile layout and final screenshot at 390 px.

These checks establish UI behavior for the demonstrated scenarios; they do not establish arbitrary recipe coverage, allergy safety, or physical food readiness.

## Review assets

| Asset | Recorded properties |
| --- | --- |
| Local/private `demo/assets/simmershift-demo-captioned.mp4` | H.264, **1440×900**, **30 fps**, **85.50 seconds**, **2,440,790 bytes**, silent. Actual UI footage, captions, verification/SDK-feedback endcard, persistent simulation/synthetic/no-device label. **Excluded from the public repository.** |
| Local `demo/assets/simmershift-demo.mp4` | H.264, **1440×900**, **105.96 seconds**, silent. Retained unchanged as the source recording. **Excluded from the public repository.** |
| [Video provenance](../demo/assets/video-provenance.txt) and [caption timing](../demo/assets/caption-timings.txt) | Record the edit and the distinction between visible UI footage and separate automated evidence. |
| [Setup screenshot](../demo/assets/01-setup.png) | Desktop setup view. |
| [Recovery screenshot](../demo/assets/02-recovery.png) | Desktop recovery/timeline view. |
| [Mobile screenshot](../demo/assets/03-mobile.png) | Mobile layout at 390 px. |
| [SDK scenario evidence](../demo/recovery.json) | Eight checked outcomes and 22 workflow snapshots; generated `2026-10-06T20:10:59.022Z`. |

Both videos' metadata was inspected with `ffprobe`. The primary captioned cut passed full `ffmpeg` decode without errors and visual review at five sampled frames. It uses a four-second intro, source seconds 24–51 slowed to 0.4× for readability, and a fourteen-second verification/SDK-feedback endcard. Its UI footage does not demonstrate server restart, reload, real cooking, or a completed serving; those behaviors are not claimed by its captions. Process-restart and complete-workflow results come from the separate automated evidence.

Both MP4s are local review files excluded from the public repository, not public upload URLs. A private Library review copy of the captioned cut was saved without public sharing. The approved [public GitHub repository](https://github.com/prakharsingh1/simmershift) has been created and MIT copyright 2026 Prakhar Singh adopted; source push/content verification are in progress. Public video upload still needs its exact title/channel approved; final submission awaits complete source/video access and any new explicit agreements checked. See [SUBMISSION_DRAFT.md](SUBMISSION_DRAFT.md).

## Reproduce

From the project folder, use Node.js 24+ and run:

```sh
npm ci
npm run check
npm run demo
node --check public/app.js
npm run dev
```

Open <http://127.0.0.1:4317> for the simulation. The default local SQLite file is `data/simmershift.sqlite`. `PORT` and `DB_PATH` can select separate local settings. A constrained execution environment must allow loopback listening for HTTP/MCP tests; [FRICTION_LOG.md](FRICTION_LOG.md) documents the observed environment workarounds.
