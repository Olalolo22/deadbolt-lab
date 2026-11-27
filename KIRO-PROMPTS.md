# Kiro prompt pack: from the lab to the real DeadBolt

This is the order of prompts to paste into the Kiro CLI, inside the real `deadbolt` repo, to rebuild everything from
this lab as a proper app. The lab is the picture on the box. Kiro builds the real thing, from the spec, with tests,
and every step leaves a trail in `.kiro/` and in git that judges can see.

**How to use it**

- Paste one prompt at a time. Read what Kiro did, run the check under the prompt, commit, then move on.
- Start every new chat session with the "session opener" below. Kiro CLI doesn't always read your steering and spec
  files on its own, so tell it to.
- If a prompt's work is too big for one go, say "continue with the next sub-task" rather than pasting it again.
- Don't hand-edit the code yourself unless you must. If something's wrong, tell Kiro what's wrong. That's the Kiro
  story the judges want to see.

**Your week (deadline: Fri Dec 4, 11 PM Lagos)**

| Day | Prompts |
| --- | --- |
| Fri–Sat | 0 → 4 (setup, spec, test vectors, scaffold, crypto) |
| Sun–Mon | 5 → 8 (lifecycle, screens, vitals) |
| Tue | 9 → 10 (claim, invite, check-in page, the Raven, end-to-end test). **Cut line: everything after this is a bonus.** |
| Wed–Thu | 11 → 12 only if Tuesday ended green; otherwise polish, then record the video |
| Fri | 13 (honest final pass, README, Devpost text). Submit by the afternoon, not at 10:59 PM. |

---

## Session opener (paste at the start of every chat)

```text
Before anything else, read these files fully and keep them in mind for this whole session:
- .kiro/steering/security-invariants.md
- .kiro/steering/design-system.md
- .kiro/specs/deadbolt-ui/requirements.md
- .kiro/specs/deadbolt-ui/design.md
- .kiro/specs/deadbolt-ui/tasks.md
The visual and behavioural reference is docs/prototype/ (index.html, app.js, shamir.js). When the spec and the
prototype disagree, the spec wins; tell me about the disagreement instead of guessing.
Reply with one line per file saying you've read it, then wait for my next message.
```

---

## Prompt 0: Bring the spec and the reference into the repo

Run this yourself in a terminal at the root of `deadbolt` (or paste it to Kiro and ask it to run it):

```bash
mkdir -p .kiro/specs/deadbolt-ui docs/prototype
B=https://raw.githubusercontent.com/Olalolo22/deadbolt-lab/main
curl -fsSL $B/kiro-spec-requirements.md -o .kiro/specs/deadbolt-ui/requirements.md
curl -fsSL $B/kiro-spec-design.md       -o .kiro/specs/deadbolt-ui/design.md
curl -fsSL $B/kiro-spec-tasks.md        -o .kiro/specs/deadbolt-ui/tasks.md
curl -fsSL $B/DESIGN.md                 -o .kiro/steering/design-system.md
for f in index.html app.js shamir.js; do curl -fsSL $B/$f -o docs/prototype/$f; done
```

Then paste:

```text
I've added a UI spec at .kiro/specs/deadbolt-ui/, a design-system steering file at .kiro/steering/design-system.md,
and a static design prototype at docs/prototype/.

1. Add docs/prototype/README.md explaining, in plain English, that this is a hand-made, client-side design prototype
   used only as the visual and behavioural reference, that it was built outside Kiro, and that the real app in web/
   is built by Kiro from the spec. Link the live prototype at https://deadbolt-lab.vercel.app.
2. Change the front matter of design-system.md so it is included only when working on the web app:
   inclusion: fileMatch with fileMatchPattern "web/**". Keep security-invariants.md always included.
3. Don't change any code yet.
```

**Check:** `git status` shows the new files. **Commit:** `docs(kiro): add deadbolt-ui spec, design-system steering and design prototype reference`

---

## Prompt 1: Let Kiro reconcile the two specs

```text
/spec deadbolt-ui
Compare .kiro/specs/deadbolt-ui with .kiro/specs/deadbolt-core and .kiro/steering/security-invariants.md.

1. The Python engine names states ACTIVE / PING_MISSED / GRACE_PERIOD / DECEASED_RELEASED; the UI names them
   ALIVE / FLATLINE / GRACE / RELEASED. Add a short "State names" table to deadbolt-ui/design.md mapping one to the
   other. Don't rename anything in the Python code.
2. List every place where the two specs disagree on a rule (missed check-ins before grace, grace length, what
   resets the clock, what is terminal). Don't fix anything yet; show me the list.
3. Add these invariants to security-invariants.md, worded as rules, numbered after the existing ones:
   - A failure to read the chain must never be shown as a release, and never trigger the heir's notice.
   - A stolen owner sign-in may only delay a release: changing the heir, changing the contents, or destroying a vault
     also requires proof of the owner's sealed backup.
   - The sealed backup carries shard B and a copy of the encrypted vault, so the break-glass route needs nothing from
     the chain or DeadBolt.
   - Every trust claim shown in the UI must match the "Claims we make" table in design-system.md, including its limit.
```

**Check:** read the disagreement list. If there are real conflicts, reply "use the UI spec's rule and update
deadbolt-core to match, with a note" (the engine and the UI must tell the same story).
**Commit:** `docs(kiro): reconcile deadbolt-ui with deadbolt-core; add release and sign-in invariants`

---

## Prompt 2: One source of truth for the rules (test vectors)

```text
The Python engine is the reference for the lifecycle rules. The web app must match it exactly.

1. Write scripts/export_vectors.py. It drives src/vault.py's HeartbeatVault through at least 60 scenarios
   (intervals 7/30/90 days; check-in early, on time, after 1 and 2 misses, during grace, after release; time
   points 1 ms either side of each deadline) and writes tests/vectors/lifecycle.json with, for each scenario:
   interval_days, last_checkin_ms, now_ms, expected_state (use the UI names from the mapping table),
   missed_count.
2. Do the same for crypto in tests/vectors/crypto.json: 20 random 32-byte keys, their 3 shares (x and y as hex), and
   an AES-256-GCM ciphertext of a known message with its iv, made with src/crypto.py.
3. Add a pytest that regenerates both files and fails if they differ from what's committed.
4. If the engine can't produce a scenario the UI spec describes, stop and tell me rather than inventing one.
```

**Check:** `python3 -m pytest -q` is green. **Commit:** `test(vectors): export lifecycle and crypto vectors from the Python engine`

---

## Prompt 3: Scaffold the web app (task 1) and its hooks

```text
/spec deadbolt-ui
Do task 1 only.
- Create the app in web/ (Next.js App Router, TypeScript, CSS Modules, no Tailwind). Use vitest for unit tests.
- Tokens exactly as in design-system.md; fonts via next/font (IM Fell English, Inter, JetBrains Mono).
- layout.tsx with the TopBar (logo, Anatomy / Operate / Vitals / Claim, the demo pill), grain overlay, flash layer,
  toast region and the plates credit line. Match docs/prototype/index.html for look and spacing at 390px.
- Then add two hooks in .kiro/hooks/, in the same JSON format as the existing invariant-audit-on-save.json:
  a) on save of web/src/lib/**: run the web unit tests;
  b) on save of web/src/lib/lifecycle.ts or web/src/lib/crypto/**: run only the vector tests (they come later; make
     the hook pass with "no tests yet" until then).
- Add a CI job for web/ (install, typecheck, unit tests) next to the Python job.
- Tick task 1 in tasks.md when done.
```

**Check:** `cd web && npm run dev`, open it on your phone (same Wi-Fi) or desktop at 390px. Then connect the repo to
Vercel with **Root Directory = web**.
**Commit:** `feat(web): scaffold Next.js app, tokens, layout, web hooks and CI (Task 1)`

---

## Prompt 4: The crypto core (task 2, plus the sealed backup from 7.3)

```text
/spec deadbolt-ui
Do task 2, and the sealing part of task 7.3, in web/src/lib/crypto/.
- shamir.ts: GF(2^8) split/combine, ported from docs/prototype/shamir.js.
- vault.ts: random 32-byte key, AES-256-GCM encrypt/decrypt with WebCrypto, DB1- shard encode/decode.
- backup.ts: DBB2 sealed backup exactly as in design.md ("Sealed backup format"): PBKDF2-HMAC-SHA256 at 600,000
  iterations, random 16-byte salt, AES-256-GCM, payload { b, iv, ct }. Still open DBB1.
- Tests: the ones listed under tasks 2.1, 2.2 and 7.4, plus a test that combines the shares in
  tests/vectors/crypto.json and decrypts the Python ciphertext. If the byte layout differs from the Python engine,
  adapt in the test, not in the engine, and tell me what differed.
- Security invariants apply: no plaintext, key or shard may ever be logged or sent over the network. Add the
  "mocked fetch never sees plaintext, key, A or B" test from task 7.
- Tick what you finished in tasks.md.
```

**Check:** the save hook fires and passes. **Commit:** `feat(web): crypto core with cross-language vectors and DBB2 backups (Task 2, 7.3)`

---

## Prompt 5: Rules, clock, demo mode and chain states (tasks 3, 4, and the demo half of 10.3)

```text
/spec deadbolt-ui
Do tasks 3 and 4, and from task 10.3 everything that works in demo mode.
- lib/lifecycle.ts: pure stateOf, dueAt, graceAt, releaseAt, missedCount. It must pass every case in
  tests/vectors/lifecycle.json. Add the ±1 ms boundary tests.
- lib/clock/: the ChainClock interface and SimulatedClock (speeds 0/1/5 days per second, jump to grace/release).
- Chain connection states: reading / ok / unreachable. The UI only learns chain time while "ok"; time that passes
  while unreachable is banked and caught up on reconnect, so an outage can never render RELEASED. Writes are
  refused while not ok. Include the demo "Cut the chain" switch. Follow docs/prototype/app.js (search for
  "THE CHAIN CONNECTION") for behaviour.
- Vault store in localStorage behind try/catch, with the migrations the prototype does at the top of app.js.
- Test: "a read failure during GRACE past the release time never renders RELEASED".
- Tick the tasks.
```

**Commit:** `feat(web): lifecycle (matches Python vectors), simulated clock, chain states (Task 3, 4, 10.3)`

---

## Prompt 6: Shared visuals and the landing page (tasks 5 and 6)

```text
/spec deadbolt-ui
Do tasks 5 and 6. Match docs/prototype/index.html for layout, copy and motion. Use the copy exactly, including
the "What else you're trusting, and the worst it could do" list and the "In this demo…" line (requirement 7a).
Images: the public-domain engravings the prototype hotlinks from Wikimedia; keep the credit line.
Check the 20-second test at 390px: headline, lede and the main button above the fold.
Respect prefers-reduced-motion everywhere. Tick the tasks.
```

**Check:** compare your phone side by side with deadbolt-lab.vercel.app. Tell Kiro exactly what looks off.
**Commit:** `feat(web): ECG, scenes, landing page (Task 5, 6)`

---

## Prompt 7: The Operating Table (task 7)

```text
/spec deadbolt-ui
Do task 7 (7.1 to 7.4) on /table.
- The four steps, with the kind chips (letter, wallet words, passwords, instructions) and their samples from
  docs/prototype/app.js (KINDS).
- Simulated Google sign-in on step 3 (label it "Demo"), the worst-case line, the 3-missed rule note.
- Throw the switch: encrypt, split, animate, then drop the plaintext and the key.
- Keepsakes: print the heir's card (with the invite link), "Seal my backup" with the password form.
- Tick the tasks.
```

**Commit:** `feat(web): operating table, heir card and sealed backup (Task 7)`

---

## Prompt 8: Vitals (task 8, plus the demo halves of 10b and 10c)

```text
/spec deadbolt-ui
Do task 8, plus everything in tasks 10b and 10c that works in demo mode:
- Monitor, HUD, the I'm-alive button, lifecycle track, shard map with the heir's accepted/invited status,
  time warp, lab notebook.
- Outbox with the four messages, copied exactly from docs/prototype/app.js (messageFor). One per event per
  check-in cycle. The heir's notice has no jokes.
- Manage vault: interval; change heir or contents (reseal) and destroy, both behind "Prove it's you" (sealed backup
  + password); retired card/backup/invitation messages.
- The demo label at the bottom of Vitals.
- Tick the tasks.
```

**Commit:** `feat(web): vitals, outbox, manage vault (Task 8, 10b, 10c)`

---

## Prompt 9: The heir's side and the check-in page (task 9)

```text
/spec deadbolt-ui
Do task 9: /invite, /pulse and /claim, including break-glass (task 7.4's UI) and every error message from the
prototype. Then write the Playwright end-to-end tests from design.md ("Testing Strategy") at 390px and 1366px,
plus one that cuts the chain during grace and checks nothing is released until it's restored.
Tick the tasks.
```

**Check:** `npx playwright test` is green. **Commit:** `feat(web): invite, check-in page, claim and break-glass with E2E (Task 9)`

---

## Prompt 10: The Raven (requirement 7b, task 9a)

```text
/spec deadbolt-ui
Do task 9a, the Raven guide. Port guideFor() from docs/prototype/app.js as a pure function of
(route, step, vault state, chain status, flags) returning { text, label, action }, with unit tests for each
route/state pair. The guided tour must go from the landing page to the reveal with only taps on the Raven's button,
exactly like the prototype. Add a Playwright test that does the whole tour. Tick the task.
```

**Commit:** `feat(web): the Raven guide and full guided-tour test (Task 9a)`

**Cut line.** If you're here by Tuesday night, everything is judgeable. Deploy, record a rough video now as a safety
net, then decide on 11–12.

---

## Prompt 11 (bonus): The Move package on Sui testnet (tasks 10.1, 10a and 10c Move)

```text
/spec deadbolt-ui
Do task 10.1 and the Move parts of 10a and 10c, in move/ (Sui Move 2024).
- Vault object, pulse (sender == owner), accept_heir (invite hash), set_interval, reseal and destroy (both need the
  manage_hash proof), and seal_approve (clock past release AND sender is the heir AND id is the current version),
  exactly as in design.md. Milliseconds from Clock 0x6 everywhere.
- Move unit tests for every assert, including: the sponsor can't pulse; a non-heir can't pass seal_approve; an old
  version id is refused; reseal/destroy without the proof fail.
- Publish to testnet with a script that prints the package id. Keep the UpgradeCap for now and say so in the README.
  Don't call make_immutable unless I say so.
- Don't change the web app yet.
```

**Commit:** `feat(move): vault, pulse, heir binding, manage and seal_approve on testnet (Task 10.1)`

## Prompt 12 (bonus): Live mode behind a switch (tasks 10.2, 10a)

```text
/spec deadbolt-ui
Add OnChainClock (task 10.2) and Enoki/zkLogin sign-in (task 10a) behind a "Live (testnet)" switch. Demo mode
stays the default. Read every key from environment variables only; commit a .env.example, never a real key.
Use Seal for shard C with the key servers from an env variable. Everything the chain can't do yet stays labelled
"simulated". Write down in design.md exactly which parts are live and which are still simulated.
```

**Commit:** `feat(web): live testnet mode behind a switch (Task 10.2, 10a)`

---

## Prompt 13: The honest final pass, README and Devpost text (task 12)

```text
/spec deadbolt-ui
Do task 12.
1. Go through every trust claim in the web app and check it against "Claims we make" in design-system.md. List any
   claim that isn't true in this build (for example "nobody can change the rules" while the UpgradeCap still exists)
   and reword it to what is true. Show me the list before and after.
2. Accessibility pass: tap targets, focus order, reduced motion, colour plus text for every state.
3. Rewrite README.md in plain, conversational English: what DeadBolt is, the 60-second demo link, what's real and
   what's simulated, how to run it, and a section "How Kiro built this" that points to the specs, steering files,
   hooks and the commit history, with one or two concrete moments (for example the test vectors that tie the web app
   to the Python engine, and the hook that blocks a broken invariant).
4. Draft the Devpost "How we built it" and "Challenges" sections from the same material. Keep it human, no jargon.
```

**Commit:** `docs: honest final pass, accessibility, README and Devpost draft (Task 12)`

---

## When Kiro goes off track

- `/context show` tells you what it's actually looking at. Re-paste the session opener if the spec isn't in there.
- Long session getting confused? `/compact`, then re-paste the session opener.
- It "fixed" the Python engine to make a web test pass? Reply: "Revert that. The engine is the reference. Fix the
  web code, or tell me why the engine is wrong."
- It invented copy? Reply: "Use the exact copy from docs/prototype for that screen."
