---
inclusion: always
---

# DeadBolt Design System — "The Frankenstein Protocol"

Steering doc for building the DeadBolt UI. The reference implementation is the `deadbolt-lab` repo.
Follow these rules for any UI that Kiro generates.

## Concept

DeadBolt is a creature stitched from three incompatible parts: **1979 cryptography** (Shamir), a **Web2 heartbeat**
(email/Telegram/SMS) and an **on-chain clock**. The horror is literary (Mary Shelley, 1818), not a party-store Halloween:
no pumpkins, no amber/orange, no cartoon ghosts. Tone: a Victorian laboratory notebook running on a hospital monitor.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#07090a` | page background (lab black) |
| `--surface` | `#101614` | cards, panels |
| `--line` | `#22302a` | borders |
| `--bone` | `#ede6d6` | primary text, shard B |
| `--muted` | `#84907f` | secondary text |
| `--volt` | `#9dff3a` | **life**: alive state, primary actions, shard A |
| `--stitch` | `#e5484d` | **alarm**: missed pulse, grace period, seams |
| `--ether` | `#a99bff` | **the chain**: shard C, release, resurrection |

Rule: each colour means exactly one thing. Never use volt for decoration, or red for anything except danger or stitches.

Typography:
- Display: **IM Fell English** (1818 book type) for headlines, legends and organ names. Italic for the "twist" word.
- Body: **Inter**.
- Data/labels: **JetBrains Mono** for uppercase kickers with 0.14–0.18em tracking, and for timestamps and shard strings.

## Motifs

- **Stitches:** red cross-stitched seams join the three organ panels. A seam always means "two incompatible things joined".
- **ECG trace:** sweep-style monitor. Alive = steady green PQRST at 68 bpm; grace = erratic red at 138 bpm; flatline/released = flat line.
- **Lightning flash:** full-screen flash only at moments of creation or resurrection (throwing the switch, shard C release, successful claim).
- **Tombstone:** the heir's screen. A violet crack appears when shard C releases.
- Grain + scanline overlay at ~6% opacity.

## Imagery rule: pages you feel vs pages you use

Public-domain 19th-century engravings only (von Holst 1831, Aldini 1804, *A Galvanised Corpse* 1836, Doré 1884).
Always inverted, so the ink glows bone-white on black. Never put them in boxed cards or light paper panels.

- **Pages you feel are full-bleed scenes:** the landing page and Claim. The image is the page, with a scrim behind the text.
  On the landing page, scenes alternate with plain black content sections: hero (frontispiece) → stats →
  Aldini quote scene → organs → lifecycle (corpse, faint) → custody table → closing scene (Raven) melting into the footer.
- **Pages you use stay black:** the Operating Table and Vitals. Only a faint etched band behind the page title,
  never behind forms, the monitor or the controls.
- If an image fails to load, the section must still read correctly on plain black.

## Motion: only things coming to life

Every animation is something waking up or being stitched together. Each plays once and uses only opacity,
transform, filter, clip-path or SVG stroke. All of it switches off under `prefers-reduced-motion`.

| Moment | Motion |
| --- | --- |
| Landing load | **Awakening:** the frontispiece is dark, flickers on twice like lightning (about 0.6 s and 1.1 s), then settles; the headline rises after it |
| Anatomy scrolls in | **Sewing:** organs appear in order, and each red seam is sewn top to bottom in 9 stitch steps between them |
| Any etched scene scrolls in | **Developing:** the engraving goes from faint, soft and low-contrast to sharp, like a print developing |
| Shard C releases (claim) | **The crack:** a violet crack runs down the tombstone, then splinters into three branches |
| Throw the switch / release / reveal | Full-screen lightning flash (reserved for these three moments only) |

The ECG is the only thing that moves continuously. No parallax, cursor effects or looping decoration.

## Messages (the outbox)

| When | To | Voice |
| --- | --- | --- |
| 1st and 2nd missed check-in | Owner, on their channel | The Raven, light: "Still with us? (1 of 3)" plus a one-tap "I'm alive" |
| Grace period starts (then daily) | Owner, every channel | The Raven, firm: "Last warning: your vault opens for Aisha in 14 days" |
| Release | Heir, by email | **No Raven, no jokes.** Gentle and plain: "Something was left for you", no rush, three steps |

Messages never contain secrets, shards or the invitation code. The prototype shows them in an Outbox on Vitals.

## When the chain is slow or unreachable

**Rule: a failure never looks like a release.**

- **Reading** (every chain page opens with this): a slim banner, "Reading your vault from the chain…", with the badge, headline and numbers gently pulsing. Usually under a second.
- **Unreachable:** a red banner, "Can't reach the chain. Showing what it last told us (day 042). Nothing is released, claimed or checked in on a guess.", with "Try again". The state badge adds "· last seen".
- While it's unreachable: check-ins, accepting, claiming and every manage action say "wasn't sent, nothing changed". The claim box says "we can't tell yet… we won't guess" and points to break-glass, which works without the chain.
- When the chain comes back, the app catches up on the time it missed. Only then can a real release happen, with its usual moment.
- The Raven says it plainly. The demo has a "Cut the chain" switch in Time warp so judges can see this.

## Managing a vault

A "Manage vault" card on Vitals, with three things and nothing else:

1. **Check in every 7 / 30 / 90 days.** Changes apply at once.
2. **Change your heir or what's inside.** DeadBolt never kept a copy, so the owner seals it again (pastes or rewrites the contents). New key, new pieces. The old card, the old backup and the old invitation are retired, and they say so plainly if anyone tries them ("That card was retired…", "This invitation is no longer active."). Same heir email: they stay accepted. New email: the new heir must accept. Afterwards the owner lands on the keepsakes step to print the new card and save a new backup.
3. **Destroy this vault**, behind an inline confirm (never a browser pop-up): "This can't be undone."

Every change is signed by the owner, so it also counts as a check-in, and the copy says so. After release, only destroy remains.

## The heir's side

The heir's card carries an invitation link (DeadBolt never sees it). Opening it shows a calm paper letter: "You've been
named." What it means, what to keep, nothing to do but "Accept with Google". The account they accept with is the only one
the final piece is ever released to. Vitals shows "invited" or "accepted as …". On the claim page, the heir signs in
before the released piece appears. If they never accepted, the page says so and points to the break-glass route.

## Accessibility (checked at 390px on every screen)

- **Tap areas are at least 44px tall**, even when a control looks smaller (chips, nav, the Raven's buttons, text
  links). An invisible area around each control does this, so the look doesn't change. Rows of chips sit 12px apart so
  those areas never overlap.
- **A visible focus ring** (volt, red on danger buttons) on everything you can reach with Tab, plus a "Skip to
  content" link as the first stop.
- **Headings never skip a level:** one H1 per screen, card titles are H2, the lifecycle states are H3.
- **Contrast:** all text passes WCAG AA once animations finish. Disabled buttons are the only exception, which WCAG
  allows.
- **Screen readers:** the ECG canvases are hidden from them (the state is always written in words). The toast, the
  Raven, the chain banner and every error message are live regions.
- **Reduced motion** turns off every animation, including the chain banner's pulsing.
- **Colour is never the only signal:** every state also has a word (ALIVE, FLATLINE, GRACE, RELEASED, "last seen").

## Claims we make, and what makes each one true

| Claim in the UI | What makes it true | The honest limit we also show |
| --- | --- | --- |
| "No company decides you're gone" | Release = your missed check-ins + the chain's clock, checked by public code | — |
| "Nobody can change the rules, not even us" | The Move package is made immutable (`make_immutable` destroys the UpgradeCap) | No bug fixes after launch either |
| "No admin key can open it early" | Shard C is released by a Seal key-server committee only when `seal_approve` passes | A colluding majority of the committee *plus* the heir's card could |
| "Signed by you. We can't sign for you." | zkLogin: Google sign-in + salt; DeadBolt only sponsors the fee | A stolen Google account (+ salt) could fake check-ins: it can only delay |
| "Changing your heir or deleting needs your backup" | `reseal` / `destroy` also need proof of shard B | Lose the backup and you can only check in and change the interval |
| "Break-glass works even if we vanish" | The sealed backup carries shard B *and* a locked copy of the vault | Backup + password + heir's card can open it early |
| "Nothing on a guess" | The UI shows only the last chain answer; writes are refused while unreachable | — |

Simulated parts are always labelled: sign-in, the chain clock, the key servers and the messages.

## Sealed backup and break-glass

Shard B never leaves the browser unsealed. The owner picks a password (10+ characters, typed twice, no reset) and
downloads a sealed backup. The backup also carries a locked copy of the vault, so break-glass needs nothing from the
chain or DeadBolt. Changing the heir or deleting the vault asks for this backup and its password ("Prove it's you"). On the claim page, a quiet "break-glass route" lets the heir combine their card with the
sealed backup and its password when the chain or DeadBolt has gone silent. The UI always states the trade-off: whoever
holds the backup and its password, together with the heir, could open the vault early.

## Lifecycle state machine (copy must match)

| State | Trigger | Headline | Colour |
| --- | --- | --- | --- |
| `ALIVE` | pulse within interval | "Subject is alive." | volt |
| `FLATLINE` | 1st or 2nd missed check-in in a row | "Check-in missed (n of 3)." | bone |
| `GRACE` | 3 missed check-ins in a row, for 14 days | "Grace period. Tap to live." | stitch |
| `RELEASED` | grace expired, the release piece opens | "It has risen." | ether |

A single pulse in any state except `RELEASED` returns to `ALIVE`.

## Custody invariant (must appear in the UI)

> Before release, no single party holds 2 shards. DeadBolt's servers hold 0.

A = heir (dormant card) · B = owner backup · C = time-locked to the chain clock.

## Screens

1. **Anatomy** (`/`): hero "It's alive. / *Until it isn't.*", hero ECG, stat strip, three organs, lifecycle, custody table, CTA.
2. **Operating Table** (`/table`): stepper Secret → Heir → Pulse → Stitch. The final button reads "⚡ Throw the switch".
3. **Vitals** (`/vitals`): monitor + HUD, a 150px circular "I'm alive" button (turns red when urgent), lifecycle track, shard map, time warp (demo only), manage vault, lab notebook log, outbox.
4. **Check-in page** (`/pulse`): what the reminder email opens. Black, big type, one giant "I'm alive" button, the signer shown underneath, a quiet own-wallet fallback. Copy changes with the state (early, missed n of 3, last warning, too late).
5. **Claim** (`/claim`): tombstone + shard A input + released shard C + "Reanimate" → reveal panel.

## Demo mode (required for judging)

Time compresses to 1 day = 1 second, with Pause / 1 day/s / 5 days/s / Skip to grace / Skip to release.
The whole lifecycle must be demoable in under 2 minutes.

## Accessibility

- Mobile-first; tap targets ≥ 44px; supports `prefers-reduced-motion`.
- Colour is never the only signal: state badges and step chips always carry text labels.
