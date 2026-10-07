# Current behavior

Mixed Chat Studio generates synthetic viewer reactions to a dedicated screen and
microphone stream. Publication is local to the administrator, reader and OBS overlay.
YouTube, CHZZK and SOOP chat can be received for display only. Actual chat and
identities never enter AI context, selection, pacing, memory or nickname generation.
There are no native-platform chat sends, viewer participation commands, policy
profiles or rights-management screens.

## Input and output

input.streamUrl is the single RTMP/RTMPS playback source. Screen masks apply before
preview/model upload; audio uses the first track. The producer supplies the intended
microphone and excludes chat/notifications. Missing input never falls back to another
feed. Default speech framing is ten seconds.

AI start prepares/reuses six synthetic viewers and requires configured stream/model.
Text-first and continuous visual policies remain available. Silence is normal;
pacing, review, evidence validation and optional operator approval constrain replies.
Model failures, input state and persistent enabled intent are distinct statuses.

Generated messages contain bounded plain text, stable synthetic names and optional
local reply references. Actual chat is held in bounded display memory only and is
lost on server restart or broadcast end. Hide removes display-only chat locally;
hiding an AI message also removes dependent AI context. Reader tokens and
administrator tokens are independent. Disclosure stops AI and reveals synthetic
identity labels for the session.

## Lifecycle

Restart preserves an open live session. Explicit end erases ordinary records and
leaves a closed marker; new broadcast starts with AI off. A media disconnect does
not end the session. Model accounts and test histories have separate lifetimes.
Historical mixed-chat data is never imported into the dedicated session.

## Test workspace

Port 3211 provides text/microphone conversations, persona inspection, per-AI state,
full call details and resumable ended sessions. Microphone controls remain outside
the conversation tab. Both apps use the same independent AI service and speech
processing. Tests never target the shared live database or input.

## Limits

The app consumes an existing stream and does not configure OBS or host ingest.
It cannot verify actual masking or microphone isolation. Content spoken or displayed
may reach selected providers. Local deletion does not delete exports, backups or
external records. No unattended real-provider quality claim follows from fixture tests.
