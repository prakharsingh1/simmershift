# SimmerShift demo sequence and recording notes

The primary local/private review video, `demo/assets/simmershift-demo-captioned.mp4`, is **85.50 seconds** (1 minute 25.5 seconds), H.264, **1440×900 at 30 fps**, silent. A private Library review copy was saved. Both MP4s are excluded from the public repository; a public YouTube/Vimeo URL, exact title/channel approval, and real Alexa+ testing remain pending.

The chosen entry is the **alternate simulated Alexa+ experience**. Footage shows the actual local app with synthetic kitchen data and explicit logical-clock advances. A persistent label states simulation/synthetic/no-device. Local SDK interoperability is separate supporting evidence; the loopback MCP endpoint is not a completed Alexa+ integration.

## Actual primary-cut sequence

| Time | Captioned content |
| --- | --- |
| 0:00–0:04 | Title/intro held from the actual opening frame. |
| 0:04–0:15 | Pantry, two burners, and a target serving time. |
| 0:15–0:20 | A completed step whose work remains kept through later changes. |
| 0:20–0:27.50 | Ten-minute simulated clock advance; unstarted rice switches to pantry-listed couscous. |
| 0:27.50–0:38.25 | Steps unlock according to prerequisites and available resources. |
| 0:38.25–0:46.50 | Two active cooking timers; completion still needs confirmation. |
| 0:46.50–0:52.50 | Physical heat-state confirmation before resume. |
| 0:52.50–1:00 | Another ten-minute simulated advance; elapsed timers remain active. |
| 1:00–1:05.50 | Chickpeas are manually confirmed done; the kitchen changes to one burner. |
| 1:05.50–1:11.50 | Saved recovery journal and updated serving estimate. |
| 1:11.50–1:25.50 | Separately verified 45-test results and honest SDK feedback endcard. |

The edit uses source seconds 24–51 at 0.4× speed for readability, plus the intro and endcard. The original `demo/assets/simmershift-demo.mp4`, 105.96 seconds, is retained unchanged locally and excluded from public source. [Video provenance](../demo/assets/video-provenance.txt) and [caption timings](../demo/assets/caption-timings.txt) record the edit. Full decode passed without errors and five output frames were visually inspected.

## Claim boundaries

- Workflow pause does not stop heat or freeze countdowns. Active heated food needs a physical-state report to resume.
- “Heat changed — reset estimates” creates fresh full-duration estimates; it neither measures physical cooking progress nor confirms completion.
- Clock advances and manually confirmed steps are synthetic demonstration actions, not a physical cooking trial.
- The footage does not visibly demonstrate a server restart, reload, actual Alexa+ onboarding, microphone interaction, or completed serving. Its captions do not claim those actions.
- The eight-assertion MCP scenario and restart/full-workflow results are separate automated evidence in [VERIFICATION.md](VERIFICATION.md) and [recovery.json](../demo/recovery.json).
- A faster base can reduce delay without meeting the target. Narrate only the improvement and remaining delay actually shown.

## Reproduce or record a later cut

From this project folder, run `npm ci`, `npm run check`, and `npm run demo` to verify the build and refresh the MCP evidence. Start the server with `npm run dev` and open `http://127.0.0.1:4317`. Use a fresh synthetic session with rice and couscous available, two burners, and a target about 25 minutes ahead. Complete a non-base preparation step before simulating the interruption so the base remains eligible for rescue.

Keep the simulation label readable and capture only this project window and synthetic data. Include no unrelated account data, background music, or unlicensed third-party assets. Record successful actions only after their result appears. If adding restart, reload, or terminal scenes to a later video, capture those actions rather than borrowing the current endcard as proof of visible footage.

Source, provenance, [screenshots, and MCP evidence](../demo/README.md) are published and verified under MIT. The videos remain local/private. A public video URL must be added after its approved upload.
