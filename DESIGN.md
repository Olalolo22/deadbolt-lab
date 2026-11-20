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

## Lifecycle state machine (copy must match)

| State | Trigger | Headline | Colour |
| --- | --- | --- | --- |
| `ALIVE` | pulse within interval | "Subject is alive." | volt |
| `FLATLINE` | first day after a missed pulse | "Pulse missed." | bone |
| `GRACE` | days 1–14 after a missed pulse | "Grace period. Tap to live." | stitch |
| `RELEASED` | grace expired, shard C opens | "It has risen." | ether |

A single pulse in any state except `RELEASED` returns to `ALIVE`.

## Custody invariant (must appear in the UI)

> Before release, no single party holds 2 shards. DeadBolt's servers hold 0.

A = heir (dormant card) · B = owner backup · C = time-locked to the chain clock.

## Screens

1. **Anatomy** (`/`): hero "It's alive. / *Until it isn't.*", hero ECG, stat strip, three organs, lifecycle, custody table, CTA.
2. **Operating Table** (`/table`): stepper Secret → Heir → Pulse → Stitch. The final button reads "⚡ Throw the switch".
3. **Vitals** (`/vitals`): monitor + HUD, a 150px circular "I'm alive" button (turns red when urgent), lifecycle track, shard map, time warp (demo only), lab notebook log.
4. **Claim** (`/claim`): tombstone + shard A input + released shard C + "Reanimate" → reveal panel.

## Demo mode (required for judging)

Time compresses to 1 day = 1 second, with Pause / 1 day/s / 5 days/s / Skip to grace / Skip to release.
The whole lifecycle must be demoable in under 2 minutes.

## Accessibility

- Mobile-first; tap targets ≥ 44px; supports `prefers-reduced-motion`.
- Colour is never the only signal: state badges and step chips always carry text labels.
