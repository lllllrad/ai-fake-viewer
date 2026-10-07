# Broadcast workspace

The Korean operator UI has two destinations: Live and Broadcast preparation.
Use the shared Bootstrap/Radix components and [design standards](../../DESIGN.md).

## Live

Show one AI toggle, always-available emergency stop, current readiness and actionable
model errors. Keep persistent enabled intent distinct from receiving/connecting state.
Show dedicated video and microphone status; no platform chat aggregate remains.

The conversation shows recent AI replies and hide controls. Candidate approval is
adjacent to conversation. Reference tabs contain transcripts and AI personas.
Human-chat summary, participant activation, policy editing, consent notices and
rights/video inventory screens are removed.

Explicit end and data deletion use destructive confirmation. Restart is distinct
from end. Disclosure stops generation and explains the current session effect.
Ordinary status updates must not steal focus or reset input/action state.

## Broadcast preparation

Three tabs: Screen/audio, AI account/model, Reader/OBS. Show dedicated video preview,
speech provider and controls, account/model selection and public links. Do not expose
stream keys in status or render private credentials.

The default tab is Screen/audio. Old participant/rights routes fall back to Live.
Account OAuth returns to the owning application's AI tab.

## Reader and overlay

Both receive the same authenticated websocket projection. The reader offers
follow-new-chat and manual return-to-latest controls. The transparent overlay keeps
new messages visible without administrative controls. Both identify their content
as AI-generated chat. There is no viewer consent guidance.

## Accessibility and verification

Support keyboard navigation, predictable tab focus, labelled actions, stale/loading/
failure states and mobile layouts without horizontal overflow. Emergency stop must
remain usable while another command is pending. Browser fixtures exercise login,
media preparation, generation, approval, reader/overlay publication and logout.
