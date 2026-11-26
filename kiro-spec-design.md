# Design Document — DeadBolt UI

> Kiro spec. In the `deadbolt` repo this lives at `.kiro/specs/deadbolt-ui/design.md`.

## Overview

The DeadBolt UI is a Next.js (App Router) + TypeScript frontend styled with CSS Modules (no Tailwind). It ports the
`deadbolt-lab` prototype into production structure. All plaintext-touching cryptography runs client-side; the backend
and chain only ever see ciphertext and shard C.

Two runtime modes share every component:

| Mode | Clock | Pulse source | Storage |
| --- | --- | --- | --- |
| **Demo** (default) | `SimulatedClock` (1 day = 1 s) | Pulse button only | `localStorage` |
| **Live** | `OnChainClock` | Email / Telegram / SMS links + button | Chain + backend metadata |

## Architecture

```
app/
  page.tsx                  Anatomy (landing)
  table/page.tsx            Operating Table (create)
  vitals/page.tsx           Vitals (owner)
  claim/page.tsx            Reading of the Will (heir)
  layout.tsx                TopBar, DemoPill, Grain, Flash, Toast, PlatesCredit
components/
  Ecg.tsx                   sweep-style canvas monitor, props: mode
  Plate.tsx                 bone-paper engraving card with caption + onError hide
  Etched.tsx                full-bleed inverted engraving backdrop
  Stepper.tsx, ShardChip.tsx, PulseButton.tsx, LifecycleTrack.tsx, ShardMap.tsx, LabNotebook.tsx, Tombstone.tsx
lib/
  crypto/shamir.ts          GF(2^8) split/combine (ported from deadbolt-lab/shamir.js)
  crypto/vault.ts           AES-256-GCM encrypt/decrypt, key generation, shard encode/decode
  lifecycle.ts              pure state machine: stateOf(), dueAt(), releaseAt()
  clock/ChainClock.ts       interface + SimulatedClock + OnChainClock
  pulse/PulseChannel.ts     interface + implementations
  store/vaultStore.ts       React context; persistence per mode
styles/
  tokens.css                design tokens from the steering file
```

### Data flow: create

1. The browser generates a 32-byte key and a 12-byte IV and encrypts the secret (AES-256-GCM).
2. `shamir.split(key, 3, 2)` produces A, B and C; the key and plaintext references are dropped.
3. A → heir card (download/print), B → owner backup (download), C → `ChainClock.lockShard(c, releaseAt)`.
4. Ciphertext + IV + metadata → the vault store (demo) or the backend (live). No shard is sent to the backend.

### Data flow: claim

1. The heir pastes A. The UI asks `ChainClock.releasedShard(vaultId)`.
2. If released, `shamir.combine([A, C])` → AES-GCM decrypt → reveal. A GCM auth failure means the wrong shard.

## Components and Interfaces

```ts
type LifecycleState = "ALIVE" | "FLATLINE" | "GRACE" | "RELEASED";

interface ChainClock {
  now(): Promise<number>;                                  // ms
  lockShard(vaultId: string, shard: string, intervalMs: number, graceMs: number): Promise<void>;
  recordPulse(vaultId: string): Promise<{ lastPulse: number }>;
  status(vaultId: string): Promise<{ lastPulse: number; released: boolean }>;
  releasedShard(vaultId: string): Promise<string | null>;  // null until released
}

interface PulseChannel {
  kind: "Email" | "Telegram" | "SMS" | "Button";
  // live: backend issues one-time pulse links; tapping one calls ChainClock.recordPulse
}
```

**Recommended `OnChainClock`:** a Sui Move object storing `last_pulse_ms`, read with `clock::timestamp_ms()`, with shard C
encrypted via **Sui Seal** under a `seal_approve` policy that passes only when
`now ≥ last_pulse + interval + grace`. This is the pattern already proven in Persist. Any chain with a native clock and
policy-gated decryption works behind the same interface.

### Lifecycle (pure, unit-tested)

```ts
const DAY = 86_400_000, GRACE = 14 * DAY, MISSES = 3; // matches the engine's steering rules
stateOf({ lastPulse, intervalMs }, now):
  now < lastPulse + intervalMs                        → ALIVE
  now < lastPulse + MISSES * intervalMs               → FLATLINE  (1st or 2nd missed check-in)
  now < lastPulse + MISSES * intervalMs + GRACE       → GRACE     (alarms on every channel)
  otherwise                                           → RELEASED  (terminal)
```

### Shard encoding

`DB1-<index>-<hex>`. This is human-pasteable and versioned, so the format can change later.

## Data Models

```ts
interface Vault {
  id: string;
  heirName: string;
  heirEmail?: string;
  intervalDays: 7 | 30 | 90;
  channel: "Email" | "Telegram" | "SMS";
  iv: string;          // hex
  ciphertext: string;  // hex
  born: number;        // ms
  lastPulse: number;   // ms (live: mirrored from chain)
  log: { t: number; msg: string; kind: "v" | "r" | "e" | "" }[];
  // demo only, never sent anywhere:
  demoShards?: { a: string; b: string; c: string };
}
```

## Trust model (displayed in the UI)

| Component | Trust | Label shown |
| --- | --- | --- |
| Shamir split, AES-GCM | None: runs in the owner's browser | "Encrypted on your device" |
| Shard C release | Chain clock + Seal key-server threshold | "Released by the chain clock" |
| Email/Telegram pulse relay | The DeadBolt relayer submits the pulse transaction | "Relayed by DeadBolt. You can always pulse directly with your wallet." |

**Known risk, stated honestly:** if the relayer stops relaying, an owner who only uses email could be released early.
The mitigations are a wallet pulse that is always available, plus pre-deadline alarms on every channel during GRACE.

## Error Handling

- WebCrypto unavailable → block creation with "This browser is too old for WebCrypto."
- Invalid shard text, duplicate shard index, GCM auth failure → the exact copy in Requirement 5.
- Chain read failure in live mode → keep the last known state, show "Chain unreachable. Showing last known state," and never infer RELEASED from a failure.
- Engraving load failure → the plate hides itself (`onError`).

## Testing Strategy

- **Unit:** `shamir` round-trip for every 2-of-3 pair, 200 random keys; `lifecycle.stateOf` at each boundary (±1 ms); shard encode/decode.
- **Invariant tests** (wired to the existing Kiro save hook): no network call carries plaintext, the unsplit key, or shards A or B (assert on mocked `fetch`); RELEASED is terminal.
- **E2E (Playwright, 390px and 1366px):** create → skip to grace → pulse → back to ALIVE; create → skip to release → claim → reveal matches the input.
- **Visual:** screenshot each route in demo mode for the Devpost gallery.
