# DeadBolt Lab — UI/UX design prototype

> **It's alive. Until it isn't.**
> A Frankenstein-themed design prototype for DeadBolt: zero-custody digital succession built from three stitched parts.

This repo is the **design reference** for the DeadBolt Kiroween 2026 entry. It is deliberately separate from the main
`deadbolt` repo, which is built through Kiro specs, steering and hooks. Use this repo to see, click and test the
experience; the production build lives in `deadbolt`.

## The creature (Frankenstein category)

| Part | Technology | Era |
| --- | --- | --- |
| **The Brain** | Shamir's Secret Sharing, 2-of-3 over GF(2⁸) | 1979 |
| **The Heart** | Email / Telegram / SMS "I'm alive" heartbeat | Web2 |
| **The Hand** | Shard C time-locked to an on-chain clock | Web3 |

Three technologies that never normally touch, stitched into one app that does what none can alone.

## Screens

| Route | Name | What it shows |
| --- | --- | --- |
| `#/` | **Anatomy** | Landing: hero ECG, the three organs stitched together, the 4-state lifecycle and an honest shard-custody table |
| `#/table` | **The Operating Table** | 4-step create wizard: Secret → Heir → Pulse → Stitch ("throw the switch") |
| `#/vitals` | **Vitals** | Owner dashboard: live ECG monitor, I'm-alive pulse button, lifecycle track, shard map, time warp and lab notebook |
| `#/claim` | **The Reading of the Will** | Heir claim: tombstone cracks open when shard C releases; shard A + C rebuild and decrypt |

## What is real and what is simulated

- **Real:** AES-256-GCM encryption (WebCrypto), 2-of-3 Shamir split and recombination, decryption on claim. Everything runs in the browser.
- **Simulated:** the chain clock and the heartbeat channel. A demo clock runs at **1 day = 1 second**, with "skip to grace" and "skip to release" controls so the whole lifecycle fits in a 2-minute video.
- State is kept in `localStorage` for this browser only. This is a design prototype, **not** production key custody.

## Plates (imagery)

Public-domain 19th-century engravings, loaded from Wikimedia Commons and treated two ways:
inverted into glowing etched backdrops, or printed as bone-paper "plates" with museum captions.

- Theodor von Holst: frontispiece to *Frankenstein* (1831), as the hero backdrop
- Giovanni Aldini: *Essai sur le galvanisme* (1804), Wellcome Collection, CC BY 4.0, as Plate I and the operating table
- *A Galvanised Corpse* (1836), behind the lifecycle and Vitals
- Gustave Doré: *The Raven* (1884), behind the claim page and the closing card

If an image fails to load, its plate hides itself and the page still works.

## Run

No build step and no dependencies.

```bash
python3 -m http.server 8000   # or: npx serve .
```

**Vercel:** import the repo → Framework preset **Other** → leave build command empty → Deploy.

## Files

```
index.html     all four screens + the full design system (inline CSS)
shamir.js      Shamir's Secret Sharing over GF(2^8)
app.js         router, lifecycle state machine, ECG monitor, create/vitals/claim flows
DESIGN.md      design spec — drop into .kiro/steering/ in the main repo so Kiro builds to it
```
