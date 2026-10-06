# Dependency license inventory

Checked **2026-10-06** against the local `package.json`, `package-lock.json`, installed package metadata, and the license/notice files listed below. This records package evidence; it is not a license grant or a legal compatibility opinion.

The seven direct packages have matching installed and locked versions and matching license metadata. Every direct package includes a license file. Paths are relative to the project root and become available after dependency installation.

| Use | Package | Installed and locked version | Declared SPDX identifier | Existing license / notice files |
| --- | --- | --- | --- | --- |
| Runtime | `@modelcontextprotocol/client` | `2.3.1` | `Apache-2.0` | `node_modules/@modelcontextprotocol/client/LICENSE` |
| Runtime | `@modelcontextprotocol/node` | `2.1.1` | `Apache-2.0` | `node_modules/@modelcontextprotocol/node/LICENSE` |
| Runtime | `@modelcontextprotocol/server` | `2.3.1` | `Apache-2.0` | `node_modules/@modelcontextprotocol/server/LICENSE` |
| Runtime | `zod` | `4.6.5` | `MIT` | `node_modules/zod/LICENSE` |
| Development | `@types/node` | `26.6.4` | `MIT` | `node_modules/@types/node/LICENSE` |
| Development | `tsx` | `4.23.15` | `MIT` | `node_modules/tsx/LICENSE` |
| Development | `typescript` | `5.9.3` | `Apache-2.0` | `node_modules/typescript/LICENSE.txt`; `node_modules/typescript/ThirdPartyNoticeText.txt` |

The three MCP packages contain identical `LICENSE` files. Their preamble describes a transition from MIT to Apache-2.0: new code and specification contributions use Apache-2.0, while contributions without relicensing consent retain MIT. The same file includes both license texts and identifies non-specification documentation as `CC-BY-4.0`. The table records the declared package metadata, not a claim that every file has one uniform license.

TypeScript's additional notice file identifies incorporated third-party material and its notices, including DefinitelyTyped, Unicode, DOM/W3C, WHATWG, and Khronos material. Keep that file with the compiler when redistributing the compiler; its declared Apache-2.0 identifier does not replace its included third-party notices.

The installed license texts specify the following redistribution conditions:

- MIT: retain the applicable copyright and permission notice in copies or substantial portions of the covered software.
- Apache-2.0: provide the license; retain applicable attribution notices; identify modified covered files; carry any applicable upstream `NOTICE` attribution when supplied.
- MCP documentation: the installed preamble identifies `CC-BY-4.0`; its attribution terms apply if covered documentation is copied or redistributed.

No missing direct-dependency license file or installed/lockfile mismatch was found. This is a direct-package inventory, not a full review of transitive or bundled third-party material. As a metadata-only cross-check, the lockfile contains 49 dependency package entries: 42 declare MIT, five Apache-2.0, and two ISC. Those counts are not a substitute for their actual license and notice files.

The source project does not vendor `node_modules` or bundle dependency implementations. `node_modules/` and `dist/` are ignored; the lockfile records dependencies to be installed with their upstream licenses. If a later release ships dependency files, a container, a bundled executable, or copied upstream documentation, retain the applicable license and notice material for the contents of that distribution.

The user explicitly approved **MIT, Copyright (c) 2026 Prakhar Singh**, for original SimmerShift source and the **public `prakharsingh1/simmershift`** GitHub destination. Root [LICENSE](../LICENSE) contains the adopted terms and `package.json` declares `MIT`; the [license decision record](LICENSE_PROPOSAL.md) documents the approval. GitHub publication is in progress. `package.json` remains private to prevent npm publication. This dependency inventory does not replace the adopted source license or approve other hosting, public video upload, or submission agreements.
