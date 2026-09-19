# Verification — 2026-09-09

## Passed

- `npm.cmd test`: 22 tests, zero failures (v0.1.2).
- `npm.cmd run build`: loadable Manifest V3 package, with bundled JavaScript and ONNX WASM.
- `node scripts/browser-smoke.mjs`: real extension UI and execution flow in isolated headless Microsoft Edge on Windows.
- `TEST_LOCAL=1`: actual SmolLM2-360M-Instruct q8 download, initialization, and a valid completion action on the fixture. Repeated against the latest build using the cached model; passed.
- `npm.cmd audit`: zero known vulnerabilities after dependency updates.
- ZIP packaging: `sentinel-extension.zip`, with manifest and extension files at the archive root.
- Visual inspection: `test-results/redaction-preview.png` and `test-results/extension-smoke.png`.

Browser coverage includes encrypted onboarding, PII/keyword removal, actual page masks, inline/long-page masking, no inference on Scan or Approve, stale-page rejection, local profile filling, cross-origin submission override rejection, click confirmation, navigation, Stop during inference, and completion.

The cancellation regression also reproduces Stop during an awaited privileged page check. Removing the final authorization recheck makes the test fail. Changed privacy settings require a fresh scan.

Version 0.1.2 adds a model metadata preflight before synthetic generation. Its tests prove it stops immediately on an unavailable model and only sends the synthetic request after the selected model passes the preflight.

## Limits of this verification

- The standard browser regression suite uses controlled Gemini responses. Version 0.1.1 was additionally tested with a user-authorized real key: connection verification, three browser profile fills, and completion all passed against `gemini-3.6-flash`. All five real request bodies were checked for synthetic profile values and the API key; none were present. The key was supplied through hidden stdin, never embedded in source or the package.
- The cached Chromium binary could not launch because of its Windows side-by-side configuration. Browser tests used installed Edge; direct Chrome installation has not been exercised here.
- The local test used CPU/WebAssembly on this machine. It is not an 8 GB hardware performance certification. The initial download exceeded a short timeout; the longer run and cached repeat passed.
- Automatic PII redaction remains heuristic and requires preview review. This is a prototype, not a classified-data assurance system.
- Gmail verification, OCR, screenshot/vision processing, and semantic PII classification are outside this first release.

No website was published and no existing personal browser profile was modified. Website profile values were synthetic. A real Gemini API key was used for the authorized API test; the diagnostic browser's saved API-key field was cleared afterward.
