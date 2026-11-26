# Requirements Document — DeadBolt UI

> Kiro spec for the DeadBolt frontend. In the `deadbolt` repo this file lives at
> `.kiro/specs/deadbolt-ui/requirements.md`. Visual rules come from the steering file
> `.kiro/steering/design-system.md` (copied from `DESIGN.md` in `deadbolt-lab`).
> Reference implementation: `deadbolt-lab`.

## Introduction

DeadBolt is a zero-custody digital succession app for the Kiroween 2026 **Frankenstein** category. It stitches
three technologies that don't normally touch into one creature:

- **The Brain:** Shamir's Secret Sharing (1979), splitting a vault key 2-of-3.
- **The Heart:** a Web2 heartbeat. The owner proves they're alive with one tap from email, Telegram or SMS.
- **The Hand:** an on-chain clock that releases shard C only after the heartbeat **and** a grace period have both run out.

This spec covers the frontend: the landing page, vault creation, the owner's Vitals dashboard, the heir's claim flow,
and a demo mode that compresses time for judging. All cryptography that touches plaintext runs in the browser.

## Glossary

- **Vault:** an encrypted secret plus its metadata (heir, interval, channel, shard locations).
- **Shard A / B / C:** Shamir shares of the vault key. A goes to the heir, B to the owner, C to the chain clock.
- **Pulse:** a check-in proving the owner is alive. It resets the timer.
- **Interval:** days allowed between pulses (7, 30 or 90).
- **Grace period:** a fixed 14 days that starts only after 3 missed check-ins in a row; one check-in during grace cancels the release.
- **Release:** the moment shard C becomes available to the heir.
- **Demo mode:** a simulated clock where 1 day passes per real second.

## Requirements

### Requirement 1: Landing page ("Anatomy")

**User Story:** As a first-time visitor, I want to understand what DeadBolt does within 20 seconds, so that I trust it with something important.

#### Acceptance Criteria

1. WHEN the landing page loads THEN the system SHALL show the headline "It's alive." with the italic second line "Until it isn't." above the fold on a 390px-wide screen.
2. WHEN the landing page loads THEN the system SHALL show an animated ECG trace in the volt colour.
3. The landing page SHALL present the three parts (Brain, Heart, Hand) as separate panels joined by stitched seams, each naming its technology and era.
4. The landing page SHALL show the four lifecycle states in order: Alive, Flatline, Grace, Resurrection.
5. The landing page SHALL show a custody table listing who holds shards A, B and C, followed by the invariant "Before release, no single party holds 2 shards. DeadBolt's servers hold 0."
6. The landing page SHALL alternate full-bleed engraving scenes (hero, Aldini quote, closing) with plain black content sections, and SHALL credit every engraving's source in the footer.
7. IF an engraving fails to load THEN the section SHALL still read correctly on plain black.
8. The Operating Table and Vitals SHALL NOT place imagery behind forms, the monitor or controls; only a faint etched band behind the page title is allowed.

### Requirement 2: Create a vault ("The Operating Table")

**User Story:** As an owner, I want to encrypt a secret and choose an heir in a few steps, so that it reaches the right person if I die.

#### Acceptance Criteria

1. The creation flow SHALL have four steps in order: Secret, Heir, Pulse, Stitch, with a visible stepper.
2. WHEN the owner submits step 1 with an empty secret THEN the system SHALL block progress and show "Give the creature something to guard."
3. WHEN the owner submits step 2 without an heir name THEN the system SHALL block progress and show "Name your heir."
4. The heir's email SHALL be required. IF it is missing or malformed THEN the system SHALL block progress and show an inline error.
5. Step 3 SHALL offer intervals of 7, 30 and 90 days (default 30) and channels Email, Telegram and SMS (default Email), SHALL state the rule (3 missed check-ins, then a 14-day grace period), and SHALL show the worst case in days of total silence before any release.
6. WHEN the owner taps "⚡ Throw the switch" THEN the system SHALL generate a random 256-bit key, encrypt the secret with AES-256-GCM, and split the key into three shards with a 2-of-3 threshold, all in the browser.
7. WHEN the split completes THEN the system SHALL play the split animation (key core charges, three bolts draw, shards A, B and C appear) and trigger the lightning flash once.
8. WHEN the split completes THEN the system SHALL discard the plaintext and the unsplit key from memory and clear the secret input.
9. The system SHALL NOT send the plaintext secret or the unsplit key over the network at any point.
10. WHEN the vault is created THEN the system SHALL offer shard A to the owner as a printable heir card, and shard B ONLY as a password-sealed backup (Requirement 5a). Shard B SHALL NEVER leave the browser unsealed.
11. WHEN the vault is created THEN the system SHALL hand shard C to the chain-clock adapter (Requirement 6) and SHALL NOT send shards A or B to the DeadBolt backend.

### Requirement 3: Owner dashboard ("Vitals")

**User Story:** As an owner, I want to see my vault's state and prove I'm alive in one tap, so that nothing is released while I'm still here.

#### Acceptance Criteria

1. IF no vault exists THEN the Vitals page SHALL show the empty state "The table is empty." with a link to the Operating Table.
2. WHEN a vault exists THEN the Vitals page SHALL show a state badge, a headline matching the state (see Requirement 4), and an ECG monitor whose rhythm and colour match the state.
3. The Vitals page SHALL show time until the next pulse is due, time since the last pulse, and the pulse channel.
4. The Vitals page SHALL show a lifecycle track from last pulse to release, with the grace portion hatched in stitch red.
5. WHEN the owner taps "I'm alive" in any state other than RELEASED THEN the system SHALL record a pulse, reset the timer, return the state to ALIVE, and confirm with a toast.
6. WHILE the state is FLATLINE or GRACE the pulse button SHALL turn stitch red with a faster ring animation.
7. WHILE the state is RELEASED the pulse button SHALL be disabled and its hint SHALL explain that shard C is public.
8. The Vitals page SHALL show a shard map (A dormant, B safe, C locked or released).
9. The Vitals page SHALL keep a "lab notebook" log of state transitions and pulses, stamped by vault day.

### Requirement 4: Lifecycle state machine

**User Story:** As an owner and as an heir, I want the vault's state to be unambiguous, so that everyone knows exactly what will happen and when.

#### Acceptance Criteria

1. The system SHALL derive state only from `lastPulse`, `interval`, the 14-day grace period and the current clock time.
2. WHEN now < lastPulse + interval THEN state SHALL be ALIVE with the headline "Subject is alive."
3. WHEN lastPulse + interval ≤ now < lastPulse + 3 × interval THEN state SHALL be FLATLINE with the headline "Check-in missed (n of 3)." A single missed check-in SHALL NEVER start the grace period or a release.
4. WHEN lastPulse + 3 × interval ≤ now < lastPulse + 3 × interval + 14 days THEN state SHALL be GRACE with the headline "Grace period. Tap to live.", and alarms SHALL go out on every registered channel.
5. WHEN now ≥ lastPulse + 3 × interval + 14 days THEN state SHALL be RELEASED with the headline "It has risen."
6. RELEASED SHALL be terminal: no pulse can reverse it.
7. WHEN the state changes THEN the system SHALL log the transition, and WHEN it becomes RELEASED the system SHALL trigger the lightning flash and a toast.

### Requirement 5: Heir claim ("The Reading of the Will")

**User Story:** As an heir, I want to recover what was left for me using my shard, so that I can access it without a lawyer or a company in the middle.

#### Acceptance Criteria

1. The claim page SHALL show a tombstone with the heir's name and shard C's status.
2. WHILE shard C is locked the page SHALL show when it opens if no pulse arrives, and the "Reanimate" action SHALL explain that the owner may still be alive.
3. WHEN shard C is released THEN the tombstone SHALL show a violet crack, and the released shard SHALL be shown only after the heir signs in with the account that accepted the invitation (Requirement 5b).
4. WHEN the heir provides shard A and taps "Reanimate" after release THEN the system SHALL rebuild the key from A + C, decrypt in the browser, and reveal the secret with the lightning flash.
5. IF the pasted text is not a valid shard THEN the system SHALL show "That doesn't look like a DeadBolt shard."
6. IF both shards have the same index THEN the system SHALL show "You need two different shards."
7. IF decryption fails THEN the system SHALL show "The parts don't fit. That shard belongs to another vault." and reveal nothing.

### Requirement 5a: Sealed backup and the break-glass route

**User Story:** As an owner, I want a spare piece that's useless to anyone without my password, so that I have a fallback if the technology fails without giving my heir a way in early.

#### Acceptance Criteria

1. Shard B SHALL be sealed in the browser with an owner-chosen password: Argon2id (m=19 MiB, t=2, p=1) in production, or PBKDF2-HMAC-SHA256 with at least 600,000 iterations; a random 16-byte salt; AES-256-GCM.
2. The password SHALL be at least 10 characters, typed twice, and SHALL NEVER be sent anywhere or stored.
3. The UI SHALL say plainly that there is no password reset.
4. The claim page SHALL offer a break-glass route: heir card + sealed backup + password rebuilds the key in the browser without the chain.
5. IF the password is wrong or the backup belongs to another vault THEN the system SHALL show "Wrong password, or that backup belongs to another vault." and reveal nothing.
6. The UI SHALL state the trade-off: whoever holds the backup and its password, together with the heir, could open the vault early.
7. The sealed backup SHALL also carry a copy of the encrypted vault (IV + ciphertext), so the break-glass route needs nothing from the chain, the key servers or DeadBolt.

### Requirement 5b: The heir's invitation and a release bound to their account

**User Story:** As an owner, I want the last piece to reach only my heir, so that a stolen card isn't enough to open my vault.

#### Acceptance Criteria

1. WHEN a vault is created THEN the system SHALL generate a one-time invitation code in the browser and print the invitation link on the heir's card. DeadBolt's servers SHALL NOT receive the code.
2. The invitation page (`/invite`) SHALL explain calmly what being named means, what to keep, and that nothing happens now, with one action: "Accept with Google".
3. WHEN the heir accepts THEN the vault SHALL record the heir's zkLogin address, and Vitals SHALL show "accepted as <account>" with a pointer to change the heir if that's wrong.
4. WHILE the heir has not accepted, Vitals SHALL say so as a warning.
5. The release policy SHALL require BOTH the chain clock past the release time AND the request coming from the heir's address (Seal `seal_approve`).
6. IF the heir never accepted THEN the claim page SHALL say the normal route is unavailable and point to the break-glass route.

### Requirement 5c: Managing a vault

**User Story:** As an owner, I want to change how often I check in, change who my vault is for, or delete it, so that my plan can change when my life does.

#### Acceptance Criteria

1. Vitals SHALL show a "Manage vault" card with exactly three actions: change the check-in interval, change the heir or contents, and destroy.
2. Every change SHALL be signed by the owner's address and SHALL also count as a check-in; the UI SHALL say so.
3. WHEN the owner changes the interval THEN the new interval SHALL apply from that moment.
4. WHEN the owner changes the heir or the contents THEN the system SHALL seal the vault again in the browser (new key, new pieces, new invitation code), because DeadBolt holds no copy. The owner SHALL re-enter the contents.
5. AFTER a reseal, the old card, the old sealed backup and the old invitation SHALL open nothing, and each SHALL say so in plain words if used. The chain SHALL refuse to release any piece of an older version.
6. IF the heir's email is unchanged THEN their acceptance SHALL carry over; otherwise the new heir SHALL accept their new card.
7. AFTER a reseal, the owner SHALL be taken to print the new card and save a new backup.
8. WHEN the owner destroys the vault THEN the system SHALL ask for an inline confirmation ("This can't be undone"), then delete the vault and its locked piece so nothing can ever be released.
9. WHILE the vault is released, only destroy SHALL be available.
10. Changing the heir or contents, and destroying, SHALL require proof of the sealed backup (backup + password) in addition to the owner's signature, so that a stolen sign-in can only delay a release. Changing the interval and checking in SHALL need only the signature.

### Requirement 6: Chain-clock and heartbeat adapters

**User Story:** As a judge, I want to see real integrations behind the Heart and the Hand, so that the Frankenstein stitch is genuine and not a mock.

#### Acceptance Criteria

1. The UI SHALL talk to the clock only through a `ChainClock` interface, with a `SimulatedClock` for demo mode and an on-chain implementation for live mode.
2. The UI SHALL talk to the heartbeat only through a `PulseChannel` interface, so email, Telegram and SMS links all produce the same pulse event.
3. WHEN live mode is active THEN the UI SHALL read `lastPulse` and the release state from the chain, not from local storage.
4. The UI SHALL label each trust assumption honestly (for example, which party relays pulses and which releases shard C), and SHALL NOT claim "trustless" for any component that depends on an operator.

### Requirement 6c: Reading the chain, and when it can't be reached

**User Story:** As an owner or heir, I want the app to be honest when it can't reach the chain, so that a network problem never looks like my vault opened (or like I checked in when I didn't).

#### Acceptance Criteria

1. WHEN Vitals, Claim, the check-in page or the invitation page opens THEN the system SHALL show a "Reading your vault from the chain…" state until the chain answers.
2. IF a chain read fails THEN the system SHALL keep showing the last state the chain reported, labelled "last seen" with the day it was seen, and SHALL offer "Try again".
3. A read failure SHALL NEVER cause the UI to show RELEASED, show shard C, or send the heir's release notice.
4. WHILE the chain is unreachable, check-ins, accepting the invitation, claiming, and every manage action SHALL be refused with "wasn't sent, nothing changed", never queued silently and never shown as done.
5. WHILE the chain is unreachable, the claim page SHALL say it can't tell whether the vault has opened, and SHALL point to the break-glass route, which works without the chain.
6. WHEN the chain is reachable again THEN the system SHALL catch up on the time it missed before showing any new state.
7. Demo mode SHALL include a control to cut and restore the chain.

### Requirement 6a: Signed check-ins and the check-in page

**User Story:** As an owner, I want my check-ins signed by me with nothing more than a Google sign-in, so that nobody (DeadBolt included) can fake that I'm alive or decide that I'm gone.

#### Acceptance Criteria

1. Creating a vault SHALL require the owner to sign in with Google (Sui zkLogin through Enoki), and the vault SHALL record the owner's zkLogin address as the only address allowed to check in.
2. Every check-in SHALL be a transaction signed by the owner's address. DeadBolt SHALL only sponsor the fee and SHALL NOT be able to create, sign or replay a check-in.
3. IF the sponsored fee is unavailable THEN the check-in page SHALL offer to check in from the owner's own wallet, paying the fee themselves.
4. The reminder link SHALL open the check-in page (`/pulse`) with one primary action, "I'm alive", and no other required step except signing in again if the session has expired.
5. WHEN a check-in succeeds THEN the page SHALL confirm that it was recorded on the chain and when the next check-in is due.
6. The page copy SHALL follow the state: early ("Still with us?"), missed ("You missed a check-in", n of 3), GRACE ("This is your last warning", days left, in stitch red) and RELEASED ("Too late", button disabled).
7. The Enoki API key and the Google client ID SHALL come from environment variables and SHALL NEVER be committed to the repo.

### Requirement 6b: The messages DeadBolt sends

**User Story:** As an owner, I want clear, timely nudges before anything happens, and as an heir, I want a kind, plain notice when something is left for me.

#### Acceptance Criteria

1. WHEN the 1st or 2nd check-in in a row is missed THEN the system SHALL send the owner a reminder on their chosen channel ("Still with us? (n of 3)") with a one-tap link to the check-in page.
2. WHEN the grace period starts THEN the system SHALL send the owner a "last warning" on every channel on file, repeated daily until a check-in or the release.
3. WHEN the vault is released THEN the system SHALL email the heir a gentle notice ("Something was left for you") with three plain steps and no humour. IF the heir never accepted THEN it SHALL point them to the break-glass route.
4. Messages SHALL NEVER contain the secret, any shard or the invitation code.
5. Owner messages MAY use the Raven's voice; the heir's notice SHALL NOT.
6. The prototype SHALL show every sent message in an Outbox on Vitals, timestamped by vault day.

### Requirement 7a: Honest claims

**User Story:** As a judge or a careful user, I want every promise in the UI to be backed by a mechanism and every limit to be stated, so that I can trust what DeadBolt says about itself.

#### Acceptance Criteria

1. Every trust claim in the UI SHALL map to a row in DESIGN.md's "Claims we make" table, with its mechanism and its honest limit.
2. The landing page SHALL show "What else you're trusting, and the worst it could do" for: the rules, the key servers, the owner's Google account, the sealed backup, DeadBolt itself, and the chain going quiet.
3. The UI SHALL NOT say "nobody can fake a check-in". It SHALL say DeadBolt can't sign for the owner, and that a stolen sign-in could only delay a release.
4. The UI SHALL NOT say "no server can open it early" without the limit: a colluding majority of the key-server committee plus the heir's card could.
5. Every screen that shows a simulated part (sign-in, chain clock, key servers, messages) SHALL label it, and SHALL say what is real (encryption, the 2-of-3 split, the sealed backup).
6. The Move package SHALL be made immutable before launch, and the UI claim "nobody can change the rules" SHALL only ship once it is.

### Requirement 7: Demo mode

**User Story:** As a hackathon judge, I want to watch the whole lifecycle in under two minutes, so that I can evaluate the product without waiting 44 days.

#### Acceptance Criteria

1. Demo mode SHALL be on by default and SHALL be shown by a pill in the top bar reading "Demo · 1 day = 1 s".
2. Demo mode SHALL offer Pause, 1 day/s, 5 days/s, Skip to grace and Skip to release.
3. Tapping the demo pill SHALL toggle between demo mode and real time.
4. A full run (create → missed pulse → grace → release → claim) SHALL be completable in under 120 seconds using demo controls.
5. Demo mode SHALL be clearly labelled as simulated anywhere the clock is shown.

### Requirement 8: Visual system and accessibility

**User Story:** As any user, I want an interface that is unmistakably Frankenstein-themed yet easy to use on a phone.

#### Acceptance Criteria

1. The UI SHALL follow the design-system steering file: lab black, bone, volt (life), stitch red (alarm), ether violet (chain); IM Fell English, Inter and JetBrains Mono; no amber or pumpkin orange.
2. Each colour SHALL carry one meaning only, and state SHALL never be shown by colour alone.
3. All screens SHALL be usable at 390px wide with tap targets of at least 44px.
4. WHEN the user prefers reduced motion THEN the system SHALL disable animations, including the lightning flash.
5. Engravings SHALL use only public-domain sources, with credits in the footer.
6. The system SHALL implement the four one-shot motions in the steering file (awakening, sewing, developing, the crack), and IF JavaScript or IntersectionObserver is unavailable THEN all content SHALL still be visible.
