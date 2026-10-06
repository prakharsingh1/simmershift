# SimmerShift

**Dinner stays on track when plans change.**

SimmerShift is a kitchen interruption-recovery workflow: it remembers completed work, tracks parallel timers, and reshapes the remaining dinner around the equipment and serving time. The hackathon entry uses the **alternate simulated Alexa+ experience** route. A local timeline demo and a real MCP `2025-11-25` server share the same durable session service. The server has been exercised by an official SDK client; it has not been connected to, certified for, or tested with a real Alexa+ device or service.

A pantry bowl is deliberately a small starting point: white rice or couscous, canned or already cooked chickpeas/lentils or tofu, carrot/zucchini/broccoli, and a lemon or tomato finish. Interrupt dinner, lose a burner, or change a pantry constraint, then inspect the revised schedule and recovery journal. Before base preparation starts, a threatened deadline can trigger an automatic switch from rice to pantry-listed couscous when it produces a meaningfully earlier finish. Started food stays in the plan. A resume briefing brings active timers, kept progress, and ready actions to the front.

## Run locally

Requirements: Node.js 24 or later and npm. Node's built-in SQLite provides persistence; no database service, model account, API key, AWS account, payment, or cloud deployment is needed. The first dependency installation needs npm registry access.

```sh
npm ci
npm run check
npm run dev
```

Open <http://127.0.0.1:4317>. The MCP endpoint is <http://127.0.0.1:4317/mcp>. Run commands from this project folder, which currently retains the original working directory name `dinnershift-mcp`.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4317` | Local HTTP port. |
| `DB_PATH` | `data/simmershift.sqlite` | SQLite file, resolved from the project working directory. |

The supported inputs are 1–6 servings and 1–2 burners. Demo recipe times assume **white rice** and **canned or already cooked legumes**, not dry beans or dry lentils.

For a compiled run:

```sh
npm run build
npm start
```

`npm run check` runs TypeScript checks, the automated test suite, and a production build. `npm run demo` runs the scripted interruption scenario with the official MCP client and writes `demo/recovery.json`. It advances a logical clock to demonstrate an interruption; this is simulated time.

The final local build passed typecheck, build, **45 tests**, **8 demo assertions through the official MCP client**, and the browser-script syntax check. Isolated Chrome QA exercised recovery, parallel timers, physical-state confirmation, paused countdowns, reload restoration, and a 390 px mobile layout, with no page overflow or console errors/warnings. See [verification details](docs/VERIFICATION.md) for the scope and evidence.

The primary review video, `demo/assets/simmershift-demo-captioned.mp4`, is an **85.50-second** silent cut of the actual app with synthetic data and clearly labeled simulated time. It and the original MP4 remain local/private review copies **excluded from the public repository**. A private Library copy was saved. The repository's [demo assets](demo/README.md) include desktop/mobile screenshots, caption timings, and provenance. A public YouTube/Vimeo URL is still pending approval and upload.

## Try the recovery workflow

1. Create a pantry bowl and set a serving time, pantry, exclusions, servings, and equipment.
2. Complete a ready preparation step such as the finishing sauce, leaving base preparation pending.
3. Pause the workflow and resume after an explicitly simulated interruption. Inspect kept progress, next actions, and any deadline-rescue substitution. If heated food is active, report whether its heat stayed unchanged or changed before resuming.
4. Start ready cooking steps. The plan makes dependencies visible and schedules passive timers alongside preparation when resources allow it. Workflow pause does not freeze the timer display.
5. Change a pantry or equipment constraint and replan. Read the recovery journal and revised serving estimate. If a target remains unrealistic, the planner explains the delay.
6. Restart the server and reopen the saved session. The cooking session is loaded from SQLite; reconnecting MCP clients establish a fresh transport session.

The interface offers controlled scenario actions and structured inputs. It does not perform speech recognition or understand arbitrary natural-language requests. A compatible agent can call the same operations through MCP.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `create_plan` | Build and persist a meal plan from constraints. |
| `get_session` | Read the durable session, progress, timers, and schedule. |
| `change_constraint` | Apply a constraint change and reconcile the remaining plan. |
| `start_step` | Start a step when its dependencies and resources permit it. |
| `complete_step` | Record completion and update remaining work. |
| `pause_resume` | Pause or resume the workflow; active heated food requires a physical-state report on resume. |
| `replan` | Recalculate the schedule and consider a valid deadline-rescue substitution. |
| `explain_changes` | Read the latest explanation and the persisted recovery journal. |

Mutations include a `requestId`; retrying the same operation with the same payload returns its saved original result. Call `get_session` to read the latest session after a retry. Reusing a key for a different payload is rejected. `expectedRevision` lets clients reject edits based on stale session state. Invalid or impossible hard constraints fail without partially writing a new plan. An infeasible serving deadline is reported as an estimate and warning rather than silently treated as achievable.

On resume, active burner/oven steps require `physicalState: "heat_unchanged"` or `"heat_changed"`. Omitting the report produces `PHYSICAL_STATE_REQUIRED` without changing the session. Unchanged heat keeps the saved deadlines. Changed heat gives those active heated steps fresh full-duration estimates because cooking progress is uncertain. Neither choice confirms completion; the person must inspect and confirm the food.

The web demo uses a local REST adapter at `/api/tools/:tool`. The MCP endpoint uses the official TypeScript MCP SDK and Streamable HTTP with protocol version `2025-11-25`; the REST adapter itself is not MCP. Automated integration tests use an actual SDK MCP client to initialize, discover, and call the tools. Local MCP interoperability is supporting engineering evidence for the simulation entry, not proof of Alexa+ onboarding. See the [route decision](docs/ARCHITECTURE.md#entry-route-and-future-alexa-onboarding) for the requirements of a future real integration.

## Scope and limitations

- The planner covers one curated plant-based meal family, not arbitrary recipes, nutrition analysis, or allergy validation.
- Timers are persisted time calculations displayed in the demo; they do not control appliances or send background phone/device notifications.
- Pause is a workflow state, not an appliance control. Food continues cooking and timer displays continue advancing unless the person changes the heat or equipment themselves. Expired timers do not automatically mark food complete or release its resources.
- The optional `interruptionMinutes` resume input advances a session's logical clock for demonstration. It is not a measurement of elapsed wall time.
- The server is a local prototype. Public hosting, authentication for remote users, and real Alexa+ onboarding are separate work.
- All demonstration data is synthetic. No production kitchen, customer, or voice data is required.

## Project notes

- [Architecture and state model](docs/ARCHITECTURE.md)
- [Demo recording script](docs/DEMO_SCRIPT.md)
- [Verified checks and limitations](docs/VERIFICATION.md)
- [Local video and screenshots](demo/README.md)
- [Submission draft and readiness checklist](docs/SUBMISSION_DRAFT.md)
- [Observed development friction](docs/FRICTION_LOG.md)
- [Dependency license inventory](docs/DEPENDENCY_LICENSES.md)
- [MIT source license](LICENSE)
- [Approved MIT license decision](docs/LICENSE_PROPOSAL.md)

The approved public [GitHub repository](https://github.com/prakharsingh1/simmershift) has been created; source push and verification are in progress. The root [LICENSE](LICENSE) adopts **MIT, Copyright (c) 2026 Prakhar Singh**. The entry has not been submitted. A public video upload still needs its exact title/channel approved. The SimmerShift name is a working creative name; domain or trademark availability has not been checked.
