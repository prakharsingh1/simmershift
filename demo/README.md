# SimmerShift demo assets

These artifacts document the **alternate simulated Alexa+ experience** and supporting MCP workflow. All data is synthetic. Time advances are explicitly simulated. No real Alexa+ device or service is connected. **Both MP4s are local/private review copies excluded from the public repository.** Screenshots, evidence JSON, caption timings, and provenance are included as source assets. A public YouTube/Vimeo URL is pending.

| File | Use |
| --- | --- |
| Local/private `demo/assets/simmershift-demo-captioned.mp4` | **Primary review cut:** **85.50 seconds**, H.264, **1440×900**, **30 fps**, **2,440,790 bytes**, silent. Actual UI footage with captions and a verification/SDK-feedback endcard. Excluded from public source; public upload URL pending. |
| Local `demo/assets/simmershift-demo.mp4` | Original unmodified UI capture: **105.96 seconds**, H.264, **1440×900**, silent. Retained locally for provenance; excluded from public source. |
| [assets/video-provenance.txt](assets/video-provenance.txt) | Source, edit details, verification, and limits of the footage. |
| [assets/caption-timings.txt](assets/caption-timings.txt) | Timing of the captions and endcard. |
| [assets/01-setup.png](assets/01-setup.png) | Desktop setup screenshot. |
| [assets/02-recovery.png](assets/02-recovery.png) | Desktop recovery screenshot. |
| [assets/03-mobile.png](assets/03-mobile.png) | Mobile screenshot at 390 px width. |
| [recovery.json](recovery.json) | Reproducible official-MCP-client scenario with eight assertions and 22 workflow snapshots. |

`npm run demo` regenerates `recovery.json` through the official SDK client using MCP `2025-11-25` over Streamable HTTP. It does not recreate the UI recording or screenshots. The scenario clock is synthetic and explicitly advanced; its timestamps do not represent an observed physical cooking session.

The primary local/private video is a silent captioned edit of the local UI capture, with a persistent simulation/synthetic/no-device label. It does not establish device integration, real cooking, completed serving, or a visible restart/reload. The endcard reports separately verified local tests and SDK feedback. The original remains local for provenance; neither MP4 can be downloaded from this repository. [DEMO_SCRIPT.md](../docs/DEMO_SCRIPT.md) maps the actual captioned sequence; [VERIFICATION.md](../docs/VERIFICATION.md) records the test and UI-review scope.

A private Library review copy of the captioned cut was saved without public sharing. The approved [public GitHub repository](https://github.com/prakharsingh1/simmershift) has been created under adopted MIT copyright 2026 Prakhar Singh; source push/content verification are in progress. No public video or final submission has been published. The exact YouTube title/channel remains pending approval in [SUBMISSION_DRAFT.md](../docs/SUBMISSION_DRAFT.md).
