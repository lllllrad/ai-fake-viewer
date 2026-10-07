# Media inputs and model accounts

## Dedicated media

[Input resolution](../../packages/infrastructure/inputs/input-mode.ts) uses
input.streamUrl for both video and audio. AI input has no platform chat or alternate
broadcast mode. Missing URLs remain unconfigured. Demo retains synthetic frame input.

[Capture](../../packages/infrastructure/inputs/screen-input.ts) owns the FFmpeg video
worker, normalized masks, bounded current frames and preview. Resolution changes
invalidate previous frames. Capture masks apply before preview and model upload.
The current URL never appears in the admin DTO.

[Transcriber](../../packages/infrastructure/inputs/speech-input.ts) uses the configured
OpenAI or Groq provider. The shared [PCM policy](../../packages/domain/inputs/pcm-chunks.ts)
frames default 10-second chunks, suppresses silence and drops partial chunks on stop.
The browser test microphone uses the same framing and transcription path, with
browser acquisition instead of FFmpeg. Input replacement/end rejects late output.

Worker sessions own cancellation and process lifetime. Starts are idempotent;
stops retire callbacks before resources are released. FFmpeg reconnect behavior
does not select a different input URL.

## Model account selection

[ModelAccount](../../packages/application/accounts/model-account.ts) stops generation
and invalidates context when account or model changes. Asynchronous model listing,
selection and OAuth completion are scoped to authorization generation. A late token
exchange cannot overwrite a newer selected account/model.

Sign in with ChatGPT persists encrypted accounts and loads available models.
Successful callbacks return to the appropriate app UI. API-key mode uses environment
credentials and OPENAI_MODEL. Both use the Responses API without silent fallback.
Speech credentials are independent of Sign in with ChatGPT.

## Credential persistence

[EncryptedTokenFile](../../packages/infrastructure/accounts/encrypted-token-file.ts)
uses authenticated AES-256-GCM storage. Invalid/unreadable files fail without exposing
plaintext or overwriting them. Replacement uses an exclusive owner-only temporary
file, flush and rename. The [refresh owner](../../packages/application/accounts/refresh-flight.ts)
prevents retired refreshes from changing current credentials.

Broadcast and test accounts have separate paths and encryption keys. Display-only
platform accounts use the existing encrypted youtube.tokens, chzzk.tokens and
soop.tokens files next to the configured live database. They are independent of
AI model accounts. See [display-only chat](display-chat.md).
