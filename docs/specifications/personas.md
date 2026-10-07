# Automatic AI viewers

This is the live product contract for the six synthetic viewers. It complements
[behavior](behavior.md) and the
[workspace contract](dashboard.md). Generated chat appears in the local reader
and OBS overlay. Personas are not platform accounts and do not send generated
replies to YouTube, CHZZK or SOOP.

## Ownership and evidence

| Responsibility                                | Source                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition and runtime policy contracts       | [Definition](../../packages/contracts/persona-definition.ts), [cast configuration](../../packages/contracts/cast-configuration.ts)                                                  |
| Automatic composition and execution control   | [AutomaticCast](../../packages/application/cast/automatic.ts), [BroadcastCast](../../packages/application/cast/broadcast-cast.ts)                                                   |
| Atomic persistence of the six viewers         | [SQLite adapter](../../packages/infrastructure/cast/automatic-sqlite.ts)                                                                                                            |
| Observation, selection and silence            | [Selection policy](../../packages/domain/reactions/cast-selection.ts)                                                                                                               |
| Generation, review and publication            | [Reaction coordinator](../../packages/application/reactions/coordinator.ts)                                                                                                         |
| Read-only operator overview                   | [Broadcast conversation](../../apps/web/src/features/workspace/BroadcastConversation.tsx)                                                                                           |
| Composition and lifecycle regression coverage | [Automatic cast service](../../tests/automatic-cast-service.test.ts), [automatic personas](../../tests/automatic-persona.test.ts), [cast control](../../tests/cast-control.test.ts) |

## Automatic composition

AI start and restart recovery use `BroadcastCast.prepare()`. It reuses an existing
live cast in the current broadcast or atomically creates six new definitions,
frozen snapshots and presence intervals, then arms execution. The public broadcast
description supplies the topic. No viewer chat, inferred personal profile,
operator brief, audition, rating or persona approval is needed. Composition uses
local rules and makes no model call; the selected model generates subsequent chat.
Normal input and model readiness still apply.

Every definition must pass its schema, all six identities must be distinct, and
names must not collide with each other or existing synthetic names after normalization.
A failed composition leaves no partial cast. Creation records research provenance,
`automatic-research-composition` and `human_review: false`. The stored `approved`
label means schema/name validation, not a human quality rating.

[automatic.ts](../../packages/persona/automatic.ts) reflects motivations from the user-supplied local research `./.local/docs/real_viewer_persona_research_v0.1.md`. The private research is not a deployment dependency. Evidence IDs below refer to that source's references.

| Motivation                                      | Research evidence             | Participation behavior                                                      |
| ----------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| Background listening alongside other activities | R02/R03 personal self-reports | Low speech propensity; no claims about missed scenes                        |
| Curiosity and understanding                     | R05 spectator research        | Interest in decisions and new concepts                                      |
| Learning and trying things                      | R05 spectator research        | React to methods without fabricated expertise/experience                    |
| Vicarious experience and reaction               | R04 self-report/R05 research  | Short responses to unexpected outcomes                                      |
| Shared interests                                | R06/R07 research              | Join questions/perspectives; remain quiet in busy chat                      |
| Supporting the broadcaster's attempts           | R08 interviews                | Respond to progress without invented donations, subscriptions or friendship |

Six characters are a product default, not an estimate of domestic audience proportions. Voice is selected independently of motivation. R09 informs brief reactions, omitted context and mixed formality, without assigning voice to demographic stereotypes or combining real people/chat into replicas. Examples are synthetic. The system does not inject a fixed meme dictionary or invent unverified sources/channel jokes. Silence and reduced participation during busy chat reflect design informed by R10–R13.

## Stable synthetic nicknames

New automatic casts use the local [nickname generator](../../packages/persona/nicknames/generator.ts)
in both broadcasts and interactive tests. The user-supplied `./.local/nicknamegen.zip`
provided the design and synthetic vocabulary; its referenced Python implementation
was absent. This TypeScript implementation uses only the curated runtime materials,
not the private research documents or example account registry. No external dictionary,
account corpus, platform availability check or network request is involved.

The starter has 823 roots across Korean common words, invented aliases, fictional
name fragments, English words, phrases and hobbies, plus a small modifier/noun
combination branch. Weights are editable design defaults in
[data.ts](../../packages/domain/cast/nicknames/data.ts), not measured audience frequencies.
Names are independent of personality, voice and broadcast topic.

Generation chooses a root, then an eligible literal, approved romanization, two-set
keyboard or initial representation. Literal roots may receive a permitted spelling,
repetition, affix, English case/letter/leet change or rare wrapper. A final small
suffix can reuse one fictional number token. At most two nontrivial operations are
allowed; representation changes exclude spelling transformations, and wrappers
exclude further suffixes. Length violations discard candidates without truncation.
Keyboard conversion preserves Shift and compound finals, accepts NFC-normalizable
modern Hangul, and rejects unsupported jamo. Numerals imply no age or birthdate.

Names contain 1–20 NFC codepoints from Hangul syllables, ASCII letters, digits,
underscores and periods. Collision keys use compatibility normalization, lowercase
and removal of underscores, periods and whitespace. Generated names are limited to
an alphabet where lowercase implements casefold; arbitrary Unicode confusable
matching is not promised. The final cast also retains its existing stricter
punctuation-insensitive name check. Each cast uses distinct normalized names and
root families. Reserved roles and existing synthetic names are excluded;
exhaustion fails atomically instead of adding UUID suffixes or reusing roots.

The resolved name, persona ID, root ID/family, operations, number token, synthetic
source marker and generator/data/rules versions are saved together in the existing
SQLite persona provenance transaction. Restarts reuse saved strings, including old
casts created before this generator. Existing identities are never recomputed from
a seed. A later viewer-name conflict detected during preparation returns
`NICKNAME_REVIEW_REQUIRED` without silently renaming the cast. Generated chat does
not block its own saved names. Broadcast deletion retains the existing cleanup
policy; a new broadcast creates new identities rather than carrying a global roster.
Interactive trace downloads also retain nickname provenance after the isolated
in-memory cast closes; older traces load with an empty provenance list.

Tests cover reproducibility, saved identity reuse, all modern Hangul syllables,
representative key mappings, 1,000 distinct names/families, transformation limits,
blocked names, exhaustion and transactional persistence. Naturalness, population
representativeness and platform account availability remain unverified. The reserved
word list is a minimal filter, not comprehensive abuse or impersonation detection.
Legacy demo-only authoring and explicit manual name changes retain their existing
contracts; the new generator owns automatic broadcast and test casts.

## Broadcast lifetime and controls

The cast belongs to the broadcast, not the server process. AI off/on and process
restart reuse its saved definitions and names. Restart preserves AI enablement
intent and waits for required input/model readiness before resuming. Broadcast end
erases the cast and its session records. A new broadcast starts with AI disabled
and creates its cast on its next AI start.

The primary AI switch controls both generation and cast arming. Stop cancels pending
work and disarms execution. Disclosure stops generation and adds origin labels in
the reader/overlay; synthetic names remain unchanged.
The overview is read-only. There are no operator authoring, selection, audition,
approval, manual arming or forced-reply controls in live operation.

## Observation and speech selection

The model receives the approved definition, public brief and current permitted
context. Presence intervals constrain which chat, transcripts and frames a member
can have observed. Interest matches, direct mentions, attention, propensity and
recent speech influence selection; they do not guarantee a response. Zero
propensity remains silent. The selected model may also skip an irrelevant or
underinformed reaction. Having six viewers does not mean six replies per input.

Configured speech supplies up to ten recent chunks. Eligible observations remain
bounded by the context window and presence. The selection age is the greater of
the policy observation age and maximum pacing plus model timeout, capped by the
context window. The default policy age of 12 seconds is therefore not a fixed
12-second cutoff for every input. Frame freshness and publication evidence guards
remain independently enforced. See [reaction implementation](../development/reactions.md).

Shared scheduling caps AI publication at three messages per minute. Cast policy
can further reduce activity. Live input contains no external chat activity.

| Policy                                | Default enforcement                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| Global speech interval                | At least five seconds, plus configured randomized pacing                            |
| Individual cooldown                   | Greater of 30 seconds and `ai.pacing.minSeconds`                                    |
| Consecutive messages from one persona | At most two                                                                         |
| Cast publication cap per 60 seconds   | Six AI messages, subject to stricter shared limits                                  |
| Delayed publication                   | Not before 500–2500 ms after triggering evidence; generation/review may take longer |
| Reaction TTL                          | 45 seconds, bounded from its triggering evidence                                    |
| Model timeout                         | 30 seconds                                                                          |
| Live model calls                      | Counted in shared broadcast usage, with no call-count ceiling                       |

The live model contract is `say / skip / inspect`. A draft passes model review and,
when configured, manual message review. Manual message review does not approve or
create a persona. Publication rechecks broadcast/context identity,
arming, definition hash, configuration revision, member epoch, evidence freshness,
expiry, duplication and pacing. Attempts and publication outcomes are recorded
locally for diagnostics.

## Stored context

State is scoped to the broadcast and member. Hiding source messages invalidates
dependent attempts and state. End deletes ordinary live data; restart preserves
the current cast. See [storage](../development/storage.md).

## Reference paths and verification limits

The retained [legacy authoring reference](../reference/persona-authoring.md)
describes demo-only generation, auditions and approval APIs. It is not a live
setup requirement. Direct standalone coordinator fixtures may use YAML
`ai.personas` without the server preparation hook; the live server always prepares
the automatic cast. The storage adapter chooses the latest live cast scoped to
its broadcast; parallel manually authored sessions are not a supported live UI.

Schema fields alone do not establish runtime features. General reaction queues,
multiple speakers per event, schema repair and memory retrieval are not promised
by this contract. Automated tests cover composition, selection, lifecycle and
publication guards. Real-model naturalness and real platform authorization or
reception require separate acceptance evidence.

## Developer experiments

[Versioned experiment profiles](../development/experiments.md) can patch automatic
composition rules and prompts. This does not introduce operator-authored viewers.
Existing cast snapshots survive restart; persona patches affect the next fresh
broadcast cast. The live server and isolated runner share the same pipeline.

## Nickname vocabulary filtering

Generated identities use a local product policy for profanity, targeted insults,
explicit sexual expressions and self-harm/violence phrases. Source roots and their
approved variants are screened before selection. Completed combinations are checked
again after keyboard/romanization, affixes, letter case, numeric substitutions and
suffixes. Compatibility normalization and separator removal catch common disguises;
innocent words such as glass and ordinary identity terms are not blocked by short
English substring matches. Suggestive modifiers were removed from the combination
data. The curated material revision is 0.2.0 and generator revision is 1.1.0.

Tests audit all curated roots/variants and every modifier–noun combination, alongside
transformation examples and a large generated cast. Rejected candidates retry under
the existing bounded attempt policy. No real viewer chat or external moderation
request is used. This explicit vocabulary policy is not an exhaustive language
classifier; new slang needs reviewed policy/data changes. Persisted identities that
fail validation require review rather than silent reassignment to a different person.
