# Sentinel — Chrome extension prototype

A local-first browser assistant with an encrypted common profile, page masking, editable redacted text previews, separate **Approve** and **Run**, and Local / Gemini / Auto model selection.

## Update to 0.1.2 — Gemini verification fix

If you loaded this project's `dist` folder, click **Reload** on Sentinel in `chrome://extensions`, then refresh your website and reopen Sentinel. If you installed from the ZIP, replace the files in the same extension folder with the updated ZIP contents before reloading. Keeping the same folder preserves the extension identity and saved vault.

The old `gemini-2.5-flash` setting is automatically upgraded to `gemini-3.6-flash`; Google rejects the old model for new users. Your saved key and profile are preserved. In **Settings**, click **Verify & save Gemini**, then return to Assistant and **Scan → Approve → Run**. Verification first checks that Google accepts your selected key/model, then runs a synthetic generation test. No website content is sent. The exact selected model is shown before approval.

Version 0.1.2 gives the verification check a 15-second visible timeout and tells you whether Google cannot be reached, the key is denied, the model is unavailable, or the synthetic request failed. It retains the earlier unavailable-model, quota, overload, and local-model progress fixes.

## Install the built extension

1. Open Chrome's Extensions page (`chrome://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project's **dist** directory.
4. Pin Sentinel. Open a normal HTTP(S) website and click its toolbar icon.
5. Save a test profile. In Settings, enter your Gemini API key and click **Verify & save Gemini**, or choose **Download & prepare local model**.

The toolbar shows `!` when a page cannot be accessed. Chrome internal pages, extension stores, PDFs, and other restricted documents are unsupported. On a new origin, Chrome may require a fresh toolbar click to grant access.

## Use

- **Profile:** one reusable name, username, email, phone, address, and password. All fields are optional. Existing logins require matching credentials.
- **Redaction:** automatic pattern-based PII detection plus literal, case-insensitive keywords. Saved values are also redacted. Text on the actual page is covered with local overlays; underlying site data is not erased.
- **Assistant:** enter a task, select Local / Gemini / Auto, and scan. Review the sanitized task and page text. Edit the preview's text/labels, or select a missed phrase and choose **Redact selected text**. Keep JSON structure and element IDs intact.
- **Approve** accepts the preview. **Run** sends the approved payload and requests one action. After an action or navigation, review and approve the updated page, then Run again.
- **Ask before clicks** adds confirmation for every click, conservatively covering submissions. **Auto** authorizes clicks through Run. Neither mode bypasses preview approval. Cross-origin links/navigation require additional destination access; cross-origin form submission is blocked.
- **Stop** aborts pending inference and prevents further authorized actions. It cannot undo an action already dispatched to the site.

Auto uses an explainable task heuristic: short form tasks use Local; comparison/research/multi-step language uses Gemini when a key exists. It is not a learned router. The provider and reason appear before approval. There is no silent provider fallback.

## Privacy boundaries and limitations

- Profile, API key, and keywords use AES-GCM encryption in extension-owned IndexedDB, with fresh nonces and a nonextractable stored CryptoKey. Automatic unlocking means this does **not** protect against someone controlling the browser profile or device. No sync or backend is used.
- Models receive approved sanitized text and element labels. Profile values are resolved locally into the approved website. The website itself necessarily receives values you fill and may read them with its scripts. Never authorize profile filling on an untrusted site.
- Raw HTML, input values, query strings, screenshots, images, and inaccessible frames are excluded from inference payloads. The hostname is sanitized against your private values and keywords too.
- Automatic PII detection uses patterns, labeled fields, saved values, and keywords. It can miss unlabeled names, addresses, unusual IDs, non-English PII, or organization-specific secrets. Preview review is required. This prototype is not validated for classified or high-assurance data handling.
- The model preview is bounded to 18,000 text characters and 120 visible controls for Gemini, or 4,000 characters and 40 controls for Local. Visual text masking scans independently of that text limit. Images/canvas/video/iframes and shadow-root content are not analyzed. Image-region redaction and OCR/vision are not part of this release.
- The small local model is `onnx-community/SmolLM2-360M-Instruct-ONNX`, q8, using Transformers.js and single-thread CPU/WebAssembly. Downloads are several hundred MB; first use and generation can be slow. Invalid or unsupported model actions are rejected. Stronger models may be needed for complex websites.
- Model weights/tokenizer data download from Hugging Face. Executable JavaScript and ONNX WASM are packaged locally. Gemini requests go directly to Google's API using your key.
- Standard visible HTML inputs, textareas, selects, buttons, and links are supported. File uploads, CAPTCHA, MFA without manual intervention, complex custom widgets, and arbitrary JavaScript execution are unsupported.
- Gmail OAuth, task-specific OTP/login-link retrieval, OCR, screenshot preview editing, and semantic PII recognition are future phases. There are no pretend Gmail or vision integrations.

## Build and test

Requires Node.js 24+ and npm:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run fixture
```

Open the printed loopback test URL, use synthetic profile values, and ask Sentinel to fill the registration form. The fixture does not send credentials externally.

Real-browser regression suite (runs an isolated profile, not your regular browser):

```powershell
$env:CHROME_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node scripts/browser-smoke.mjs
```

The harness copies the extension into a temporary directory and grants only its local fixture origin to simulate a toolbar activeTab grant. Gemini responses are intercepted; the suite does not use a real key. It tests onboarding, secret-free payloads, scan/approval no-call behavior, stale-page rejection, inline keywords, long-page masks, profile fills, cross-origin submit blocking, confirmation, navigation, cancellation, and completion. Set `TEST_LOCAL=1` to additionally download and exercise the real local model; this is slower and requires network access.

## Source map

- `src/background.js`: trusted tab binding, approval, execution, and vault access.
- `src/content.js`: DOM extraction, local visual masks, revision checks, and bounded actions.
- `src/panel.js`, `public/`: floating extension-origin UI.
- `src/core/`: sanitizer, encryption, approval state, action validation and routing.
- `src/providers.js`, `src/local-worker.js`: Gemini and in-browser inference.
- `scripts/build.mjs`: bundles extension code and local WASM into `dist/`.

No Git repository or remote was present at project creation. Changes are saved locally; nothing has been published.

See [VERIFICATION.md](VERIFICATION.md) for the checks actually run and their limits. A ready-to-extract package is available as `sentinel-extension.zip`.
