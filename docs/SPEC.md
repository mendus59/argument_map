# Parrhesia v1 spec

Status: draft for review · November 2026

Parrhesia helps two people or two teams lay out a debate as an argument map and work through it honestly. This spec covers v1. Design mockups: [round 1](https://claude.ai/artifact/NwwKrH3WDBMekz7iyXBPrr) (approaches) and [round 2](https://claude.ai/artifact/G5GhKndqfwWrEPKQAn11zP) (the chosen argument map).

## Goals and limits

- Two sides per debate (For and Against). Each side is one person or a team.
- Only debaters write. Invited readers can view. No audience voting in v1.
- Debates work asynchronously and live, on the same map.
- Structure is encouraged with defaults and tips, never enforced.
- Free to use, and free to operate apart from AI and transcription spend that the admin starts.

Out of scope for v1: open or social debates, audience participation, AI features for regular users, more than two sides, forking an imported debate.

## Roles

| Role | Who | Can do |
| --- | --- | --- |
| Admin | Patrick (a document at `admins/{uid}`, created by hand in the Firebase console, or the custom claim `admin: true`) | Import debates, run AI assist and transcription, set visibility, invite readers, see AI spend |
| Team leader | The person who creates a side (the debate creator leads their side and invites the other side's leader) | Everything a member can, plus set the team's stance on every box, manage membership, mark sub-debates resolved, maintain the side's boxes |
| Team member | Invited by their leader | Add boxes, notes, comments, sources; refute; open sub-debates |
| Reader | Invited by a leader or the admin | View only |
| Public | Anyone, signed in or not | View debates the admin has made public |

Sign-in is Google via Firebase Authentication.

## Core concepts

**Claim (box).** A single statement. It has a type: fact, prediction, value, definition, or unspecified. Only its author can edit its wording. A claim can be an *unplaced note* until someone puts it on the map.

**Link.** Connects one or more co-premises to a target claim, as either a *reason* (supports) or an *objection* (opposes). Co-premises in one link must all hold for the link to work. A rebuttal is an objection whose target sits inside an objection.

**Stance.** Each side holds one stance per claim and per link: agree, unsure, or disagree, with a confidence from 0 to 100. Only the side's leader sets it. A stance on a link answers the inference check: "if all these premises were true, would the target follow?"

**Crux.** A claim on the path to the conclusion where one side agrees and the other disagrees. The app highlights cruxes automatically.

**Sub-debate.** Either side can fork any claim into a sub-debate. The forked claim *is* the sub-debate's conclusion (the same claim, not a copy), so stances stay in sync. The parent keeps going, and the forked claim shows the sub-debate's status. A sub-debate is resolved when both leaders record the same outcome: both accept, both reject, or agree to disagree (which keeps the claim marked as a crux).

**Unresolved depth.** Each debate shows how deep its chain of open sub-debates goes. There is no depth limit.

```
depth(debate) = 0                                   if it has no open sub-debates
              = 1 + max(depth(s) for each open sub-debate s)   otherwise
```

Resolved sub-debates and references to settled claims count as 0.

**Settled reference.** A claim from a resolved debate or sub-debate can be cited in any other debate. It shows as settled, links back to where it was settled, and adds nothing to depth.

## Honest-debate features in v1

- **Restate before you rebut.** To refute a claim you first paraphrase it, and the author confirms. On by default; a leader can turn it off for their debate.
- **Claim types**, with type-specific tips (predictions and facts invite sources; values invite reasons).
- **Confidence** on every stance, with a stance history.
- **Crux highlighting** and the **map check** (missing stances, unsourced facts or predictions, old unplaced notes). These are rule-based and run in the browser.
- **"Fair point"** concession that records the stance change in the history.

## Data model (Cloud Firestore)

```
users/{uid}                    displayName, photoURL, createdAt
debates/{debateId}
  title, subjects[], participantNames[], searchTerms[]
  origin: 'native' | 'imported'
  visibility: 'private' | 'public'          // public only for imported, set by admin
  sides: { for: Side, against: Side }       // Side = { leaderUid, memberUids[], label }
  readerUids[]
  conclusion: { debateId, claimId }         // own claim, or parent claim for sub-debates
  parent: { debateId, claimId } | null
  status: 'open' | 'resolved'
  outcome: 'accepted' | 'rejected' | 'disputed' | null
  outcomeVotes: { for?: Outcome, against?: Outcome }
  unresolvedDepth: number                   // kept up to date on fork and resolve
  source?: { kind: 'transcript' | 'youtube', url, videoId, title, channel, speakers: [{ label, side }], segmentCount }
  createdAt, updatedAt
debates/{id}/claims/{claimId}
  text, type, authorUid, side, placed: boolean, position: {x, y}
  subDebateId?, settledRef?: { debateId, claimId }
  source?: { segment, start, speaker, quote }   // transcript passage it was mapped from
  aiSuggested?: boolean
debates/{id}/transcript/{chunk}  index, segments: [{ start, speaker, text }]   // 500 per document, admin writes
debates/{id}/links/{linkId}    kind: 'reason' | 'objection', targetClaimId, premiseClaimIds[], authorUid, side
debates/{id}/stances/{targetId}__{side}
                               value: 'agree' | 'unsure' | 'disagree', confidence, setBy, updatedAt
debates/{id}/stanceHistory/{autoId}   targetId, side, from, to, reason?, at
debates/{id}/comments/{autoId} targetId, authorUid, kind: 'comment' | 'restatement' | 'confirmation', text, at
debates/{id}/sources/{autoId}  claimId, url, title, kind: 'study' | 'data' | 'news' | 'anecdote' | 'opinion', addedBy
debates/{id}/activity/{autoId} feed events for async catch-up
admin/aiBudget                 monthlyTokenCap, usedThisMonth, monthKey
admin/aiRuns/{autoId}          debateId, tasks[], estimatedTokens, usedTokens, at
```

Live presence ("3 online", "Ben is writing") uses Firebase Realtime Database, which handles disconnects cheaply. Everything else is Firestore with live listeners, which also gives async catch-up for free.

Public search uses `searchTerms[]` (lower-cased participant names and subjects) with `array-contains` queries. That is enough for "by participant or subject" without a paid search service.

Security rules enforce: only authors edit claim text; only a side's leader writes that side's stances, membership and outcome votes; readers and public visitors read only; only the admin changes visibility or writes `admin/*`.

## Screens

1. **Sign in** with Google.
2. **My debates**: debates I lead, belong to, or can read; invitations.
3. **New debate**: title, subjects, my side; invite link for the other side's leader.
4. **Debate workspace**: the map, the side panel for the selected box (stance, restate, sources, thread, refute, fork), the composer, map check, activity feed, presence, breadcrumbs and debate tree for sub-debates.
5. **Team settings** (leader): members, readers, restate-before-rebut toggle.
6. **Admin import**: source (paste transcript, or YouTube link), speakers to sides, map by highlighting, optional AI assist with estimate and cap, review queue, visibility.
7. **Public library**: public imported debates, searchable by participant and subject.

## Costs and infrastructure

- Firebase Spark (free) plan covers Auth, Firestore, Realtime Database and Hosting at this scale.
- AI assist and transcription need a server to keep the API key secret. Firebase Cloud Functions require the Blaze (pay-as-you-go) plan, which still has a free monthly allowance. Usage at this scale should stay within it; set a billing budget alert at a low amount. Only the admin can trigger these functions.
- Every AI or transcription run shows an estimate first and is refused by the server if it would pass the monthly token cap.
- Map layout uses React Flow (MIT licensed), so there is no paid diagram library.

## Open items

- **YouTube import.** Decided: the admin pastes the transcript from YouTube's "Show transcript" panel (or loads an .srt, .vtt or .txt file). YouTube's API only gives captions to a video's owner, and scraping them breaks YouTube's terms, so there is no automatic fetch. The video plays through YouTube's official embed. Audio transcription for videos without captions stays in milestone 7.
- **Email digest** for async debates needs an email provider. Free tiers exist; decide in milestone 4 or defer.

## Milestones

| # | Milestone | Main pieces |
| --- | --- | --- |
| 0 | Skeleton (this PR) | Spec, Vite + React + TypeScript app, data model types, depth logic with tests, read-only sample map, CI |
| 1 | Accounts and debates | Firebase Auth, create debate, invite other leader, members, readers, security rules |
| 2 | Map editing (done) | Claims, links, co-premise groups, unplaced notes, automatic layout, stances, inference check |
| 3 | Honest-debate tools | Comments, restate before rebut, sources, crux highlighting, map check, stance history |
| 4 | Async and live | Live listeners, presence, activity feed, optional timed rounds |
| 5 | Sub-debates | Fork, shared stances, outcomes, unresolved depth, settled references, breadcrumbs and tree |
| 6 | Admin import (moved up; import done) | YouTube link and pasted transcript, speakers to sides, select-to-map with timestamps, video seek, visibility, reader invites. Still to do: public library and search |
| 7 | AI and YouTube | Cloud Functions, AI assist review queue, budget cap, YouTube captions and transcription |
