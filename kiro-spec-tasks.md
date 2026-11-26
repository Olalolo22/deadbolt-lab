# Implementation Plan — DeadBolt UI

> Kiro spec. In the `deadbolt` repo this lives at `.kiro/specs/deadbolt-ui/tasks.md`.
> Order is demo-first: tasks 1–9 produce a complete, judgeable demo; tasks 10–12 make it live.

- [ ] 1. Scaffold the frontend and design tokens
  - Create a Next.js App Router + TypeScript app with CSS Modules (no Tailwind)
  - Add `styles/tokens.css` with every token from the design-system steering file; load IM Fell English, Inter and JetBrains Mono via `next/font`
  - Build `layout.tsx` with TopBar, the Grain overlay, the Flash layer, the Toast region and the plates credit line
  - _Requirements: 8.1, 8.3_

- [ ] 2. Port the crypto core with tests
  - [ ] 2.1 Port `shamir.js` to `lib/crypto/shamir.ts` (GF(2^8), split/combine)
    - Unit test: 200 random 32-byte keys, every 2-of-3 pair round-trips; a single share ≠ key
    - _Requirements: 2.6_
  - [ ] 2.2 Implement `lib/crypto/vault.ts`: key generation, AES-256-GCM encrypt/decrypt, `DB1-` shard encode/decode
    - Unit test: invalid shard text, wrong-vault shard → GCM failure
    - _Requirements: 2.6, 5.5, 5.7_

- [ ] 3. Implement the lifecycle state machine
  - Pure `stateOf`, `dueAt`, `graceAt`, `releaseAt` and `missedCount` in `lib/lifecycle.ts`, plus the headline map (grace only after 3 missed check-ins in a row)
  - Boundary tests at ±1 ms for each transition; RELEASED is terminal
  - _Requirements: 4.1–4.6_

- [ ] 4. Build the clock abstraction and demo mode
  - `ChainClock` interface and `SimulatedClock` (speed 0 / 1 / 5 days per second; jump to grace or release)
  - DemoPill in the top bar; vault store with `localStorage` persistence wrapped in try/catch
  - _Requirements: 6.1, 7.1–7.3, 7.5_

- [ ] 5. Build shared visual components
  - `Ecg` (sweep canvas: ALIVE 68 bpm volt, GRACE 138 bpm erratic stitch, FLATLINE/RELEASED flat)
  - `Scene` (full-bleed inverted engraving + scrim) and `EtchedBand` (faint title backdrop), following the imagery rule in the steering file
  - `ShardChip`, `Stepper`, `Toast` and the `lightning()` flash, all respecting `prefers-reduced-motion`
  - _Requirements: 1.2, 1.6, 1.7, 8.4_

- [ ] 6. Build the Anatomy landing page
  - Full-bleed hero (frontispiece), stat strip, Aldini quote scene, three organs with stitched seams, lifecycle, custody table, closing Raven scene into the footer
  - Check the 20-second test at 390px: headline + lede + CTA above the fold
  - _Requirements: 1.1–1.8_

- [ ] 7. Build the Operating Table
  - [ ] 7.1 Four-step form with the stepper, validation copy and the interval/channel radio cards
    - _Requirements: 2.1–2.5_
  - [ ] 7.2 "Throw the switch": encrypt, split, animate, drop the plaintext and key, clear the input
    - _Requirements: 2.6–2.8_
  - [ ] 7.3 Heir card (printable shard A) and owner backup download (shard B); hand C to `ChainClock.lockShard`
    - Invariant test: mocked `fetch` never receives plaintext, the key, A or B
    - _Requirements: 2.9–2.11_

- [ ] 8. Build Vitals
  - Monitor + HUD, PulseButton (urgent and disabled states), LifecycleTrack, ShardMap, LabNotebook, time-warp controls
  - Transition side effects: log, toast, and the flash on RELEASED
  - _Requirements: 3.1–3.9, 4.7, 7.2_

- [ ] 9. Build the claim page and the end-to-end demo
  - Tombstone (crack when released), shard A input, released shard C box, Reanimate → reveal
  - Error copy for invalid, duplicate and wrong-vault shards
  - Playwright E2E at 390px and 1366px: full run in under 120 s of simulated time
  - _Requirements: 5.1–5.7, 7.4_

- [ ] 10. Implement the on-chain clock (live mode)
  - [ ] 10.1 Sui Move module: vault object with `last_pulse_ms`, `pulse()` and `seal_approve` gated on `clock::timestamp_ms() ≥ last_pulse + interval + grace` (`Clock` 0x6, milliseconds throughout)
  - [ ] 10.2 `OnChainClock` adapter: `lockShard` (Seal-encrypt C), `recordPulse`, `status` and `releasedShard`
  - Live mode reads state from the chain only; a read failure never shows RELEASED
  - _Requirements: 6.1, 6.3_

- [ ] 10a. Signed check-ins
  - Google sign-in through Enoki (zkLogin) in the create flow; store the owner's address on the vault
  - Move `pulse()` that asserts `sender == owner`; Enoki-sponsored transactions; own-wallet fallback
  - `/pulse` check-in page with state-aware copy; API keys only from environment variables
  - _Requirements: 6a.1–6a.7_

- [ ] 11. Implement pulse channels
  - Backend issues one-time pulse links per channel; tapping one relays `pulse()`; always offer a direct wallet pulse
  - Alarms on every channel when FLATLINE starts and daily during GRACE
  - _Requirements: 6.2_

- [ ] 12. Add honest trust labels and the final pass
  - Trust labels on Create, Vitals and Claim exactly as in the design's trust-model table
  - Accessibility pass (tap targets, reduced motion, colour plus text for every state); screenshot every route for Devpost
  - Motion pass: awakening, sewing, developing and the crack, verified under reduced motion
  - _Requirements: 6.4, 8.2–8.6_
