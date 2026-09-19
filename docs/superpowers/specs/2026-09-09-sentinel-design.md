# Sentinel Chrome extension — first-version design

## Agreed experience

Clicking the extension opens an isolated floating interface within the active webpage, with navigation for Chat, Redaction, Profile, and Settings. First use collects one optional-field common profile: name, username, email, phone, address, and password. Existing website logins work only where these values match. No master password is required.

The user can select Local, Gemini, or Auto. Auto chooses according to task complexity, local model availability, and configured cloud access. The selected provider and reason are displayed before approval. Gemini uses the user's own API key. A lightweight local model downloads on explicit first-use consent and runs in the browser, targeting ordinary 8 GB laptops with compatible WebGPU. Unsupported hardware produces an actionable error, never a silent cloud fallback.

Pipeline: collect page locally → redact → show editable preview → Approve → separate Run → request one bounded action → validate and execute → read and redact again. A changed page requires a fresh approval and Run. Approving alone never contacts an inference provider or executes an action. Changes to prompt, provider, rules, or preview invalidate approval. Stop cancels requests and prevents further actions.

## Boundaries and release order

First release: encrypted common profile, floating UI, custom keywords, automatic PII heuristics, local page masking, editable sanitized text preview, provider selection, in-browser inference, Gemini, and constrained DOM automation with navigation handling. A local test website exercises login and registration without real credentials.

Subsequent release: Gmail OAuth limited by application behavior to verification for the active task's website; OCR and screenshot/vision processing with editable region masks; stronger semantic PII recognition. These remain required roadmap features, not claims about the first release. Until screenshot sanitization is implemented and verified, no screenshot or image is transmitted to any inference provider. Images, canvas, inaccessible frames, and other unreadable regions are shown as unsupported in the preview rather than treated as scanned.

## Architecture

- Manifest V3 service worker owns privileged extension operations and tab lifecycle. Permissions are requested narrowly; new origins require user-granted access when needed.
- An isolated extension-origin iframe provides the floating interface. The host page cannot read vault state or UI inputs. Only validated bridge messages are accepted; the bridge cannot request arbitrary secret retrieval or browser execution.
- Content scripts collect visible DOM text and actionable elements, assign opaque element IDs, report document revisions, apply reversible visual masks, and execute a fixed action vocabulary. Raw HTML, hidden inputs, arbitrary attributes, and full URLs with query strings are excluded from model payloads.
- The vault stores AES-GCM ciphertext with fresh nonces, using a nonextractable Web Crypto key persisted in extension-owned IndexedDB. There is no sync or backend storage. Automatic unlocking is convenience, not protection against browser-profile compromise. Profile/key deletion removes stored records.
- A local sanitizer handles saved values, literal case-insensitive custom keywords, email, phone, credential fields, and structured/labeled name/address/identity patterns. It sanitizes the task prompt and action labels as well as page text. Heuristics do not guarantee complete PII discovery, especially arbitrary names and addresses; preview review remains required.
- A provider adapter receives only an explicitly constructed sanitized payload. Gemini requests exclude raw page URLs, vault values, raw error messages, screenshots, and page source. The API key is sent only as authentication to Google's API endpoint. The local agent consumes the same approved sanitized representation.
- The browser executor accepts schema-validated actions against the current approved document and known element IDs, never model-generated JavaScript, arbitrary selectors, or executable code.

## Profile filling and browser actions

Model actions are click(elementId), type(elementId, literal), fillProfile(elementId, fieldName), scroll(direction), navigate(httpsUrl), finish(summary), or error(summary). Values from the vault are resolved locally only for fillProfile. Secret fields cannot be filled through literal model text. Actual inserted secrets remain excluded from subsequent extraction. Actions are rejected when the document revision or origin differs from the approved snapshot.

Before a profile fill, show the target origin and field. Run authorizes filling on that approved origin only. New origins require new approval; never reuse prior approval for a different destination. Restrict navigation to HTTP(S), reject javascript/data/file URLs, and prevent model requests to access extension internals. An explicit task scope and action limit prevent runaway loops. Page content is untrusted evidence and cannot override the user's task or tool policy.

Execution modes: Ask before submitting pauses for an additional confirmation before form submission or equivalent sensitive clicks. Auto lets Run authorize these actions within the approved task and origin. Neither mode bypasses fresh page-preview approval. Classify uncertain clicks conservatively in Ask mode. Navigation and meaningful DOM mutation stop the loop and require a fresh snapshot. Completion must be grounded in visible page evidence; failures give a sanitized, actionable summary.

## UI

Chat contains the task prompt, provider selector, execution mode, progress entries, selected-model explanation, and completion/error messages. Progress describes operations rather than private model reasoning.

Preview displays the exact sanitized text and element information included in the model request. Users may remove or redact additional text and save text as a keyword. A visible revision/status label distinguishes Needs review, Approved, Running, and Stopped. Run is disabled without current approval. The first release's text preview is explicitly labeled; it is not a screenshot preview.

Redaction contains keyword add/remove controls and automatic PII category settings. Page masking uses local overlays/style changes where possible, avoids permanently modifying site data, and restores on close. It is visual masking, not erasure from the underlying website. Rescans invalidate approval. Password and secret-field masking cannot be disabled for cloud payloads.

Settings stores the Gemini key, configurable supported model identifier, model download status, and local data deletion. Model downloads show real progress and size where available. Gmail is clearly labeled as a later phase without a pretend connection button.

## Validation and acceptance

1. Unit tests prove vault round-trip, fresh nonces, wrong-key/tamper rejection, keyword escaping, profile-value removal, representative PII detection, and strict action-schema rejection.
2. Tests prove no provider call before Approve plus Run, edits invalidate approval, provider changes invalidate approval, and stale snapshots cannot execute.
3. Provider payload tests use seeded secrets in text, labels, prompt, and URLs and assert none occur in serialized request bodies. Unreadable regions cannot enter a cloud payload as images.
4. A deterministic fixture exercises registration filling, submit confirmation, navigation, new approval, finish, stop, and injected page instructions.
5. Build and extension packaging checks prove no remote executable scripts, missing resources, or unsupported manifest configuration. Real Chrome smoke testing is recorded separately from mocked tests.
6. Report actual tested model/hardware and any untested live Gemini integration. Do not claim production-grade or classified-data suitability based on a prototype.

## References consulted

- Chrome manifest: https://developer.chrome.com/docs/extensions/reference/manifest
- WebLLM browser requirements: https://webllm.mlc.ai/docs/user/get_started.html
- Gemini generation API: https://ai.google.dev/api/generate-content

## Design status

Approved by the user with “start”; first-version implementation is present. Gmail and image/OCR/vision retain the agreed later-phase boundaries.

Implementation decisions: the local model is SmolLM2-360M-Instruct q8 using single-thread CPU/WebAssembly, so WebGPU is not required. Local previews are limited to 4,000 text characters and 40 controls; Gemini previews to 18,000 characters and 120 controls. All automatic pattern categories stay enabled. Task Auto routing is an explicit heuristic, not a learned routing model. Browser tests run against an isolated Edge profile because the cached Chromium binary on this machine has a broken Windows side-by-side configuration. Version 0.1.1 uses Gemini 3.6 Flash after reproducing the old model's rejection for new users. Both controlled-response tests and a real Gemini-driven synthetic registration-fill test passed. Settings offers a user-triggered synthetic connection test that never includes page or profile data.
