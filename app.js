import { split, combine, toHex, fromHex, encodeShare, decodeShare } from "./shamir.js";

/* =========================================================
   DeadBolt Lab: client-side prototype.
   Real crypto (AES-256-GCM + 2-of-3 Shamir). Simulated chain clock.
   ========================================================= */

const DAY = 86_400_000;
const GRACE_DAYS = 14;
const MISSES_TO_GRACE = 3; // same rule as the engine: grace starts only after 3 missed check-ins in a row
const STORE_KEY = "deadbolt.vault.v1";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------------- state ---------------- */
let vault = load();
if (vault && !vault.heir) vault.heir = { accepted: false, account: null, address: null };
if (vault && !vault.inviteToken) vault.inviteToken = toHex(crypto.getRandomValues(new Uint8Array(16)));
if (vault && !vault.outbox) vault.outbox = [];
if (vault && !vault.retired) vault.retired = { cards: [], backups: [], invites: [] };
if (vault && !vault.unseen) vault.unseen = 0; // chain time that passed while we couldn't read the chain
let demo = true;          // demo: 1 day per real second
let speed = 1;            // days per real second when demo is on
let lastFrame = performance.now();

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}
function save() {
  try { vault ? localStorage.setItem(STORE_KEY, JSON.stringify(vault)) : localStorage.removeItem(STORE_KEY); } catch {}
}

/* ---------------- lifecycle maths ---------------- */
// ALIVE -> FLATLINE (1st missed check-in) -> GRACE (after 3 missed in a row) -> RELEASED (14 days later)
function stateOf(v) {
  if (!v) return null;
  const t = v.simNow;
  if (t < dueAt(v)) return "ALIVE";
  if (t < graceAt(v)) return "FLATLINE";
  if (t < releaseAt(v)) return "GRACE";
  return "RELEASED";
}
const dueAt = (v) => v.lastPulse + v.interval * DAY;
const graceAt = (v) => v.lastPulse + MISSES_TO_GRACE * v.interval * DAY;
const releaseAt = (v) => graceAt(v) + GRACE_DAYS * DAY;
const missedCount = (v) => Math.min(MISSES_TO_GRACE, Math.max(0, Math.floor((v.simNow - v.lastPulse) / (v.interval * DAY))));

function fmtDur(ms) {
  const neg = ms < 0; ms = Math.abs(ms);
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / 3_600_000);
  const s = d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  return neg ? `${s} ago` : s;
}
const dayStamp = (v, t = v.simNow) => `day ${String(Math.floor((t - v.born) / DAY)).padStart(3, "0")}`;

function log(msg, kind = "") {
  if (!vault) return;
  vault.log.push({ t: vault.simNow, msg, kind });
  if (vault.log.length > 60) vault.log.shift();
  renderLog();
}

/* ---------------- router ---------------- */
function route() {
  const path = (location.hash.replace(/^#/, "") || "/").split("?")[0];
  const known = $$(".route").map((s) => s.dataset.route);
  const target = known.includes(path) ? path : "/";
  $$(".route").forEach((s) => (s.hidden = s.dataset.route !== target));
  $$("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === target));
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  if (target === "/vitals") renderVitals(true);
  if (target === "/claim") renderClaim();
  if (target === "/pulse") { pulsedHere = false; renderPulsePage(true); }
  if (target === "/invite") renderInvite(true);
  if (target === "/vitals") renderHeirStatus();
  if (CHAIN_ROUTES.includes(target)) readChain();
  else $("#chainBanner").hidden = true;
}
window.addEventListener("hashchange", route);

/* ---------------- toast / flash ---------------- */
let toastT;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("show"), 2600);
}
function lightning() {
  const f = $("#flash");
  f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
}

/* ---------------- ECG monitor ---------------- */
function makeEcg(canvas, getMode) {
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, dpr = 1, x = 0, lastY = null, phase = 0;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h); x = 0; lastY = null;
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const wave = (p) => {
    // PQRST complex on a 0..1 phase
    const g = (c, wd, a) => a * Math.exp(-((p - c) ** 2) / (2 * wd * wd));
    return g(0.12, 0.025, 0.12) - g(0.21, 0.008, 0.12) + g(0.235, 0.01, 1) - g(0.262, 0.01, 0.28) + g(0.42, 0.045, 0.22);
  };

  return (dt) => {
    if (!w) return;
    const mode = getMode();
    const color = { ALIVE: "#9dff3a", FLATLINE: "#ede6d6", GRACE: "#e5484d", RELEASED: "#a99bff", IDLE: "#9dff3a" }[mode] || "#9dff3a";
    const bpm = mode === "GRACE" ? 138 : 68;
    const pxPerSec = Math.max(120, w / 4.5);
    const steps = Math.max(1, Math.round((dt / 1000) * pxPerSec));
    ctx.lineWidth = 2;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    for (let i = 0; i < steps; i++) {
      phase += (bpm / 60) / pxPerSec;
      if (phase >= 1) phase -= 1;
      let v;
      if (mode === "FLATLINE" || mode === "RELEASED") v = (Math.random() - 0.5) * 0.015;
      else if (mode === "GRACE") v = wave(phase) * (0.55 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.06;
      else v = wave(phase);
      const y = h * 0.62 - v * h * 0.5;
      // erase a gap ahead of the sweep
      ctx.save(); ctx.shadowBlur = 0; ctx.clearRect(x + 1, 0, 18, h); ctx.restore();
      if (lastY !== null) { ctx.beginPath(); ctx.moveTo(x - 1, lastY); ctx.lineTo(x, y); ctx.stroke(); }
      lastY = y;
      x += 1;
      if (x > w) { x = 0; lastY = null; }
    }
  };
}

const heroEcg = makeEcg($("#heroEcg"), () => "IDLE");
const vitalsEcg = makeEcg($("#ecg"), () => stateOf(vault) || "ALIVE");

/* ---------------- main loop ---------------- */
let prevState = stateOf(vault);
let prevMissed = vault ? missedCount(vault) : 0;
function frame(now) {
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  if (vault) {
    const daysPerSec = demo ? speed : 1 / 86_400;
    const adv = dt * daysPerSec * DAY / 1000;
    // The chain's clock never stops. But while we can't read it, we keep showing the last thing it told us
    // and bank the time we haven't seen yet, so a failure can never look like a release.
    if (chain.status === "ok") vault.simNow += adv;
    else vault.unseen = (vault.unseen || 0) + adv;
    const st = stateOf(vault);
    if (st !== prevState) onTransition(prevState, st);
    prevState = st;
    catchUpMessages(st);
    const m = missedCount(vault);
    if (st === "FLATLINE" && m > prevMissed && m > 1) log(`Missed check-in ${m} of ${MISSES_TO_GRACE}. Reminder sent via ${vault.channel}.`, "r");
    prevMissed = m;
  }
  if (!$('[data-route="/"]').hidden) heroEcg(dt);
  if (!$('[data-route="/vitals"]').hidden && vault) { vitalsEcg(dt); renderVitals(); renderManage(); }
  requestAnimationFrame(frame);
}

setInterval(() => { if (vault) save(); }, 1500);

function onTransition(from, to) {
  if (!vault || !from) return;
  if (to === "FLATLINE") { log(`Missed check-in 1 of ${MISSES_TO_GRACE}. Reminder sent via ${vault.channel}.`, "r"); toast(`Missed a check-in. ${vault.channel} reminder sent.`); }
  if (to === "GRACE") { log(`${MISSES_TO_GRACE} missed check-ins in a row. Grace period open: ${GRACE_DAYS} days, alarms on every channel.`, "r"); }
  if (to === "RELEASED") {
    log("Chain clock passed the deadline. Shard C released.", "e");
    lightning();
    toast("Shard C released. The heir can now claim.");
  }
  if (to === "ALIVE" && from !== "ALIVE") log("Subject revived. Timer reset.", "v");
  if (!$('[data-route="/claim"]').hidden) renderClaim();
}

/* =========================================================
   THE CHAIN CONNECTION (simulated): reading → ok, or unreachable.
   Rule: a failure never looks like a release. While the chain is quiet we show the last
   state it reported, bank the time we haven't seen, and refuse anything that needs it.
   ========================================================= */
const CHAIN_ROUTES = ["/vitals", "/claim", "/pulse", "/invite"];
const chain = { status: "ok", cut: false, timer: 0, logged: false };

function setChain(status) {
  chain.status = status;
  document.body.dataset.chain = status;
  const banner = $("#chainBanner");
  banner.hidden = status === "ok" || !vault || !CHAIN_ROUTES.includes(curRoute());
  banner.classList.toggle("down", status === "down");
  $("#chainRetry").hidden = status !== "down";
  $("#chainMsg").textContent = status === "reading"
    ? "Reading your vault from the chain…"
    : vault ? `Can't reach the chain. Showing what it last told us (${dayStamp(vault)}). Nothing is released, claimed or checked in on a guess.` : "";
  if (vault && !$('[data-route="/claim"]').hidden) renderClaim();
  if (!$('[data-route="/pulse"]').hidden) renderPulsePage(true);
}

function readChain() {
  clearTimeout(chain.timer);
  if (!vault) return setChain("ok");
  setChain("reading");
  chain.timer = setTimeout(() => {
    if (!vault) return setChain("ok");
    if (chain.cut) {
      setChain("down");
      if (!chain.logged) { chain.logged = true; log("Lost contact with the chain. Showing the last state it reported. Nothing is released or claimed on a guess.", "r"); }
      return;
    }
    const caught = vault.unseen || 0;
    vault.simNow += caught;
    vault.unseen = 0;
    setChain("ok");
    if (chain.logged) {
      chain.logged = false;
      log(`Back in contact with the chain. Caught up ${Math.round(caught / DAY)} day${Math.round(caught / DAY) === 1 ? "" : "s"} we couldn't see.`, "v");
    }
    save();
  }, chain.cut ? 1200 : 550);
}

function chainReady(what) {
  if (chain.status === "ok") return true;
  toast(chain.status === "reading"
    ? "Still reading the chain. One moment."
    : `Can't reach the chain, so ${what} wasn't sent. Nothing changed. Try again when it's back.`);
  return false;
}

// time jumps move the chain's clock, even when we can't see it
function jumpTo(t) {
  if (!vault) return;
  if (chain.status === "ok") vault.simNow = Math.max(vault.simNow, t);
  else vault.unseen = Math.max(vault.unseen || 0, t - vault.simNow);
}

$("#chainToggle").addEventListener("click", () => {
  chain.cut = !chain.cut;
  $("#chainToggle").textContent = chain.cut ? "Restore the chain" : "Cut the chain";
  $("#chainToggle").classList.toggle("on", chain.cut);
  toast(chain.cut ? "Chain cut (demo). Watch what DeadBolt refuses to guess." : "Chain restored (demo). Reading it again…");
  readChain();
});
$("#chainRetry").addEventListener("click", readChain);

// keep the sticky banner just under the header, whatever height the header wraps to
new ResizeObserver(([e]) => document.documentElement.style.setProperty("--hdr", `${Math.round(e.target.getBoundingClientRect().height)}px`))
  .observe($(".topbar"));

/* ---------------- demo pill ---------------- */
$("#demoPill").addEventListener("click", () => {
  demo = !demo;
  $("#demoPill").classList.toggle("off", !demo);
  $("#demoPillLabel").textContent = demo ? `Demo · ${speed} day${speed > 1 ? "s" : ""} = 1 s` : "Real time";
  toast(demo ? "Demo mode: time compressed." : "Real time: one day takes one day.");
});
function setSpeed(s) {
  speed = s;
  if (s > 0) demo = true;
  $("#demoPill").classList.toggle("off", !demo || s === 0);
  $("#demoPillLabel").textContent = s === 0 ? "Paused" : `Demo · ${s} day${s > 1 ? "s" : ""} = 1 s`;
  $$("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === s));
}

/* =========================================================
   OPERATING TABLE (create flow)
   ========================================================= */
let step = 1;
let forged = null; // result of throwing the switch

const WORDS = "ghost lantern velvet orbit marble thunder candle meadow riddle anchor willow spark";
const KINDS = {
  letter: {
    label: "Use a sample letter",
    placeholder: "Dear…",
    sample: `Dear Aisha,

If you're reading this, the raven was right and I'm gone. Don't panic. Here's everything you need:

1. The wallet words: ${WORDS}
2. The land documents are in the blue file, top shelf of my wardrobe.
3. Uncle Tunde still owes me ₦200,000. Collect it with a smile.

I'm proud of you. I always have been.

Love, Dad`,
  },
  keys: {
    label: "Use sample wallet words",
    placeholder: "Seed phrase, hardware wallet PIN…",
    sample: `Wallet recovery words:\n${WORDS}\n\nHardware wallet PIN: 4471 (it's in the drawer under the TV).`,
  },
  access: {
    label: "Use sample passwords",
    placeholder: "Email, bank app, phone passcode…",
    sample: "Email: dad.bello@example.com\nPassword: Lagos-Rain-1987\n\nBank app PIN: 2580\nPhone passcode: 091919",
  },
  instructions: {
    label: "Use sample instructions",
    placeholder: "Where the documents are, who to call…",
    sample: "The will is with Barrister Okafor in Marina.\nLand documents: blue file, top shelf of my wardrobe.\nLife insurance: the policy is in the same file. Call the number on the front.",
  },
};
const currentKind = () => ($('input[name="kind"]:checked') || {}).value || "letter";
const SAMPLE = KINDS.letter.sample;
function applyKind() {
  const k = KINDS[currentKind()];
  $("#secret").placeholder = k.placeholder;
  $("#fillSample").textContent = k.label;
}
$$('input[name="kind"]').forEach((r) => r.addEventListener("change", applyKind));

function renderWorstCase() {
  const days = Number(($('input[name="interval"]:checked') || {}).value || 30);
  const total = MISSES_TO_GRACE * days + GRACE_DAYS;
  $("#worstCase").textContent = `With a ${days}-day check-in, nothing can be released until ${total} days of complete silence: ${MISSES_TO_GRACE} missed check-ins, then ${GRACE_DAYS} days of alarms.`;
}
$$('input[name="interval"]').forEach((r) => r.addEventListener("change", renderWorstCase));
renderWorstCase();
$("#fillSample").addEventListener("click", () => { $("#secret").value = KINDS[currentKind()].sample; $("#secret").focus(); });

function showStep(n) {
  step = n;
  $$("[data-panel]").forEach((p) => (p.hidden = Number(p.dataset.panel) !== n));
  $$("#stepper li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("on", s === n);
    li.classList.toggle("done", s < n);
  });
  $("#backBtn").disabled = n === 1 || !!forged;
  const next = $("#nextBtn");
  if (n < 4) next.textContent = "Next";
  else next.textContent = forged ? "Open vitals →" : "⚡ Throw the switch";
  if (n === 4 && !forged) {
    $("#keyPreview").textContent = "generating on throw…";
    $("#stitchCaption").textContent = "The key will be split into 3 shards. Any 2 rebuild it.";
  }
}

function validate(n) {
  if (n === 1 && !$("#secret").value.trim()) return "The creature needs something to guard. Even a grocery list counts.";
  if (n === 2 && !$("#heirName").value.trim()) return "Name your heir. \"Whoever finds my laptop\" is not an inheritance plan.";
  if (n === 2) {
    const e = $("#heirEmail").value.trim();
    if (!e) return "We need your heir's email. It's where their invitation goes, and the only account the last piece is released to.";
    if (!/^\S+@\S+\.\S+$/.test(e)) return "That email looks cursed. Check the spelling.";
  }
  if (n === 3 && !owner) return "Sign in first, so your check-ins are signed by you and nobody else.";
  return null;
}

$("#backBtn").addEventListener("click", () => showStep(Math.max(1, step - 1)));
$("#nextBtn").addEventListener("click", async () => {
  const err = validate(step);
  if (err) { toast(err); return; }
  if (step < 4) return showStep(step + 1);
  if (forged) { location.hash = "#/vitals"; return; }
  await throwSwitch();
});

async function throwSwitch() {
  const btn = $("#nextBtn");
  btn.disabled = true;
  try {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const plaintext = new TextEncoder().encode($("#secret").value);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
    const [a, b, c] = split(keyBytes, 3, 2).map(encodeShare);

    // animate
    const stage = $("#stitchStage");
    $("#keyPreview").textContent = toHex(keyBytes);
    $("#coreBox").classList.add("charged");
    lightning();
    await wait(250);
    stage.classList.add("live");
    $('.shard[data-s="a"] code').textContent = a;
    $('.shard[data-s="b"] code').textContent = b;
    $('.shard[data-s="c"] code').textContent = c;
    await wait(700);
    $("#keyPreview").textContent = "destroyed · only shards remain";
    $("#coreBox").classList.remove("charged");
    $("#stitchCaption").innerHTML = `Plaintext encrypted (${ct.length} bytes). Key split and wiped. <b>It's alive.</b>`;

    const interval = Number($('input[name="interval"]:checked').value);
    const channel = $('input[name="channel"]:checked').value;
    const born = Date.now();
    forged = true;
    vault = {
      heirName: $("#heirName").value.trim(),
      heirEmail: $("#heirEmail").value.trim(),
      interval, channel,
      iv: toHex(iv), ct: toHex(ct),
      shards: { a, b, c },
      born, simNow: born, lastPulse: born,
      owner,
      heir: { accepted: false, account: null, address: null },
      inviteToken: toHex(crypto.getRandomValues(new Uint8Array(16))),
      outbox: [],
      retired: { cards: [], backups: [], invites: [] },
      log: [],
    };
    prevState = "ALIVE";
    log(`Creature assembled. Heir: ${vault.heirName}. Pulse every ${interval} days via ${channel}.`, "v");
    log("Key split 2-of-3: A → heir, B → owner, C → chain clock.");
    log(`Only ${owner.account} can check in. DeadBolt covers the fees.`);
    log(`Invitation link printed on ${vault.heirName}'s card. DeadBolt never sees it.`);
    save();
    $("#secret").value = "";
    $("#keepsakes").hidden = false;
    showStep(4);
  } catch (e) {
    console.error(e);
    toast("The switch failed. This browser is too old for our kind of magic. Try a newer one.");
  } finally {
    btn.disabled = false;
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================================================
   VITALS
   ========================================================= */
const HEADLINES = {
  ALIVE: "Subject is alive.",
  FLATLINE: "Check-in missed.",
  GRACE: "Grace period. Tap to live.",
  RELEASED: "It has risen.",
};

let lastVitalsState = null;
function renderVitals(force = false) {
  const has = !!vault;
  $("#vitalsEmpty").hidden = has;
  $("#vitalsLive").hidden = !has;
  if (!has) return;

  const st = stateOf(vault);
  const now = vault.simNow;
  $("#vName").textContent = `for ${vault.heirName}`;
  const missed = missedCount(vault);
  const [hudLabel, hudValue] = {
    ALIVE: ["next check-in", `in ${fmtDur(dueAt(vault) - now)}`],
    FLATLINE: ["missed in a row", `${missed} of ${MISSES_TO_GRACE}`],
    GRACE: ["opens in", fmtDur(releaseAt(vault) - now)],
    RELEASED: ["status", "released"],
  }[st];
  $("#hudDueLabel").textContent = hudLabel;
  $("#hudDue").textContent = hudValue;
  $("#hudSince").textContent = fmtDur(now - vault.lastPulse).replace(" ago", "");
  $("#hudChannel").textContent = vault.channel;
  renderHeirStatus();

  // lifecycle track: 0 = last pulse, 1 = release deadline
  const span = releaseAt(vault) - vault.lastPulse;
  const p = Math.min(1, Math.max(0, (now - vault.lastPulse) / span));
  const dueP = (vault.interval * DAY) / span;
  const graceP = (graceAt(vault) - vault.lastPulse) / span;
  $("#trackFill").style.width = `${Math.min(p, dueP) * 100}%`;
  $("#trackMissed").style.left = `${dueP * 100}%`;
  $("#trackMissed").style.width = `${Math.max(0, Math.min(p, graceP) - dueP) * 100}%`;
  $("#trackGrace").style.left = `${graceP * 100}%`;
  $("#trackGrace").style.width = `${Math.max(0, p - graceP) * 100}%`;
  $("#trackCursor").style.left = `calc(${p * 100}% - 1px)`;

  const vKey = `${st}:${missed}:${chain.status}`;
  if (vKey !== lastVitalsState || force) {
    lastVitalsState = vKey;
    $("#vHeadline").textContent = chain.status === "reading" ? "Checking the chain…" : st === "FLATLINE" ? `Check-in missed (${missed} of ${MISSES_TO_GRACE}).` : HEADLINES[st];
    const badge = $("#stateBadge");
    badge.className = `state-badge mono ${st}`;
    badge.textContent = st === "RELEASED" ? "RESURRECTED" : st;
    $("#monitor").className = `monitor ${st}`;
    $$("#stepsMini span").forEach((s) => s.classList.toggle("on", s.dataset.st === st));
    const pb = $("#pulseBtn");
    pb.classList.toggle("urgent", st === "FLATLINE" || st === "GRACE");
    pb.disabled = st === "RELEASED";
    $("#pulseHint").textContent = {
      ALIVE: "One tap resets the timer. This is what your email or Telegram link does.",
      FLATLINE: `You've missed ${missed} of ${MISSES_TO_GRACE} check-ins. Nothing happens until the third. Tap now and it all resets.`,
      GRACE: "Last chance. One tap cancels the release.",
      RELEASED: "Too late: shard C is public. Your heir can claim now.",
    }[st];
    $("#mapHeir").textContent = vault.heirName;
    renderHeirStatus();
    const mc = $("#mapC");
    mc.textContent = st === "RELEASED" ? "released" : "locked";
    mc.classList.toggle("hot", st === "RELEASED");
    renderLog();
  }
}

function renderLog() {
  const ol = $("#log");
  if (!ol || !vault) return;
  ol.innerHTML = vault.log
    .map((e) => `<li class="${e.kind}"><time>${dayStamp(vault, e.t)}</time><span>${escapeHtml(e.msg)}</span></li>`)
    .join("");
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function recordPulse(via = "sponsored") {
  if (!vault || stateOf(vault) === "RELEASED") return false;
  if (!chainReady("your check-in")) return false;
  const was = stateOf(vault);
  vault.lastPulse = vault.simNow;
  const who = vault.owner ? vault.owner.account : "the owner";
  log(via === "wallet"
    ? `Check-in signed by ${who} from their own wallet. They paid the fee.`
    : `Check-in signed by ${who}. Fee covered by DeadBolt.`, "v");
  prevState = was; // the transition handler logs a revival
  if (navigator.vibrate) navigator.vibrate(30);
  save();
  return true;
}
$("#pulseBtn").addEventListener("click", () => {
  if (recordPulse()) toast("Check-in signed. Still alive. The raven looks disappointed.");
});

$$("[data-speed]").forEach((b) => b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))));
$$("[data-jump]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!vault) return;
    if (b.dataset.jump === "grace") jumpTo(graceAt(vault) + 1000);
    if (b.dataset.jump === "release") jumpTo(releaseAt(vault) + 1000);
  })
);
$("#resetVault").addEventListener("click", async () => {
  if (!vault) return;
  const err = $("#dsErr");
  err.textContent = "";
  const btn = $("#resetVault");
  btn.disabled = true; btn.textContent = "Checking…";
  try {
    await proveOwner("ds");
  } catch (e) {
    err.textContent = e.message;
    return;
  } finally {
    btn.disabled = false; btn.textContent = "Yes, destroy it";
  }
  wipeVault("Vault destroyed. Every card and backup for it is now useless. Not even a toe was kept.");
});

function wipeVault(msg) {
  if (!vault) return;
  vault = null; forged = null; prevState = null; lastVitalsState = null;
  owner = null; renderSignin();
  heirSignedIn = false;
  save();
  $("#stitchStage").classList.remove("live");
  $$(".shard code").forEach((c) => (c.textContent = "—"));
  showStep(1);
  renderVitals(true);
  revealed = false;
  lastSealed = null;
  outboxKey = "";
  $("#outbox").innerHTML = "";
  $("#outboxEmpty").hidden = false;
  $("#sealForm").hidden = true;
  $("#reveal").hidden = true;
  $("#shardInput").value = "";
  $("#keepsakes").hidden = true;
  $("#destroyConfirm").hidden = true;
  $("#destroyAsk").hidden = false;
  $("#mgReseal").open = false;
  mgKey = "";
  chain.cut = false; $("#chainToggle").textContent = "Cut the chain"; $("#chainToggle").classList.remove("on");
  clearTimeout(chain.timer); setChain("ok");
  ["mg", "ds"].forEach((p) => { $(`#${p}Sealed`).value = ""; $(`#${p}Pw`).value = ""; });
  $("#dsErr").textContent = "";
  toast(msg);
}

/* =========================================================
   CLAIM (heir)
   ========================================================= */
function renderClaim() {
  const st = stateOf(vault);
  const tomb = $("#tomb");
  $("#tombName").textContent = vault ? `Left for ${vault.heirName}` : "A sealed vault";
  const blind = !!vault && chain.status !== "ok" && !(st === "RELEASED" && heirSignedIn);
  const released = st === "RELEASED" && !blind;
  tomb.classList.toggle("open", released);
  $("#tombMeta").textContent = !vault ? "no vault on this device" : blind ? (chain.status === "reading" ? "reading the chain…" : "chain unreachable") : released ? "shard C · released" : `shard C · locked · ${st.toLowerCase()}`;
  const box = $("#releasedBox");
  box.classList.toggle("hot", released && heirSignedIn);
  box.classList.toggle("note", !(released && heirSignedIn)); // sentences wrap at words; only the shard breaks anywhere
  box.textContent = !vault
    ? "Nothing buried here yet. Assemble a vault on the operating table first."
    : blind
    ? (chain.status === "reading"
      ? "Reading the chain…"
      : "Can't reach the chain, so we can't tell yet whether shard C has been released. We won't guess. The break-glass route below works without the chain.")
    : !released
    ? `Locked by the chain clock. Opens in ${fmtDur(releaseAt(vault) - vault.simNow)} if no check-in arrives.`
    : heirSignedIn
    ? vault.shards.c
    : `Released to ${vault.heir && vault.heir.account ? vault.heir.account : `${vault.heirName}'s account`} only. Sign in as the heir to receive it.`;
  $("#heirSigninBox").hidden = !(vault && released && !heirSignedIn);
  $("#claimError").textContent = "";
}

$("#pasteDemoShard").addEventListener("click", () => {
  if (!vault) return toast("Nothing to dig up yet. Assemble a vault first.");
  $("#shardInput").value = vault.shards.a;
});

$("#claimBtn").addEventListener("click", async () => {
  const errEl = $("#claimError");
  errEl.textContent = "";
  try {
    if (!vault) throw new Error("No vault on this device. Nothing to dig up.");
    if (await isRetired("cards", $("#shardInput").value)) throw new Error(RETIRED_CARD);
    if (chain.status !== "ok") throw new Error("Can't reach the chain right now, so shard C can't be requested. We won't guess. The break-glass route below works without the chain.");
    if (stateOf(vault) !== "RELEASED") throw new Error("Shard C is still locked. The owner may still be alive (awkward).");
    if (!heirSignedIn) throw new Error("Sign in as the heir first. The last piece only goes to their account.");
    const a = decodeShare($("#shardInput").value);
    const c = decodeShare(vault.shards.c);
    await reanimate([a, c], "shards A + C", "opened");
  } catch (e) {
    errEl.textContent = e.message;
    $("#reveal").hidden = true;
  }
});

async function reanimate(pieces, how, verb, locked = { iv: vault.iv, ct: vault.ct }) {
  if (pieces[0].x === pieces[1].x) throw new Error("Two copies of the same shard is still one shard. You need a different piece.");
  const key = await crypto.subtle.importKey("raw", combine(pieces), "AES-GCM", false, ["decrypt"]);
  let pt;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(locked.iv) }, key, fromHex(locked.ct));
  } catch {
    throw new Error("The parts don't fit. That shard belongs to another creature.");
  }
  lightning();
  $("#tomb").classList.add("risen");
  setTimeout(() => $("#tomb").classList.remove("risen"), 600);
  $("#revealText").textContent = new TextDecoder().decode(pt);
  $("#letterMeta").textContent = `Left for ${vault.heirName} · ${verb} on ${dayStamp(vault)}`;
  const letter = $(".letter"); letter.style.animation = "none"; void letter.offsetWidth; letter.style.animation = "";
  $("#reveal").hidden = false;
  $("#reveal").scrollIntoView({ behavior: "smooth", block: "center" });
  log(`${vault.heirName} rebuilt the key from ${how}.`, "e");
  revealed = true;
}

/* =========================================================
   THE OUTBOX: the three messages DeadBolt sends, in the Raven's voice
   (except the heir's notice: that one is gentle and plain, on purpose)
   ========================================================= */
let outboxKey = "";
const MESSAGE_ORDER = ["r1", "r2", "grace", "release"];

function sendMessage(kind) {
  if (!vault) return;
  vault.outbox = vault.outbox || [];
  const cycle = vault.lastPulse;
  if (vault.outbox.some((m) => m.cycle === cycle && m.kind === kind)) return;
  const at = { r1: dueAt(vault), r2: dueAt(vault) + vault.interval * DAY, grace: graceAt(vault), release: releaseAt(vault) }[kind];
  vault.outbox.push({ kind, cycle, t: at });
}
function catchUpMessages(st) {
  if (!vault) return;
  const upto = { ALIVE: -1, FLATLINE: missedCount(vault) >= 2 ? 1 : 0, GRACE: 2, RELEASED: 3 }[st];
  for (let i = 0; i <= upto; i++) sendMessage(MESSAGE_ORDER[i]);
  renderOutbox();
}

function messageFor(m) {
  const e = escapeHtml;
  const ownerAcct = vault.owner ? vault.owner.account : "the owner";
  const heirFirst = vault.heirName.split(" ")[0];
  const pulseUrl = `${location.origin}${location.pathname}#/pulse`;
  const claimUrl = `${location.origin}${location.pathname}#/claim`;
  if (m.kind === "r1" || m.kind === "r2") {
    const n = m.kind === "r1" ? 1 : 2;
    return {
      from: "The Raven &lt;raven@deadbolt.example&gt;", to: e(ownerAcct), via: e(vault.channel),
      subject: `Still with us? (${n} of 3)`, tone: "",
      body: `<p>Hello from the Raven.</p>
        <p>Your DeadBolt check-in was due on ${dayStamp(vault, m.cycle + n * vault.interval * DAY)}. Nothing has happened, and nothing will until you miss three in a row.${n === 2 ? " That's two now. One more and the grace period starts." : ""}</p>
        <a class="mail-btn" href="#/pulse">I'm alive</a>
        <p>One tap, signed by you. I can't do it for you, however much I'd like to.</p>
        <p class="mail-sign">The Raven, DeadBolt's guide</p>`,
      short: `DeadBolt: check-in ${n} of 3 missed. Nothing has happened yet. One tap to reset: ${e(pulseUrl)}`,
    };
  }
  if (m.kind === "grace") {
    return {
      from: "The Raven &lt;raven@deadbolt.example&gt;", to: e(ownerAcct), via: "every channel on file, daily",
      subject: `Last warning: your vault opens for ${e(vault.heirName)} in ${GRACE_DAYS} days`, tone: "alarm",
      body: `<p>This is the Raven, and I'm not joking this time.</p>
        <p>You've missed 3 check-ins in a row. On ${dayStamp(vault, releaseAt({ ...vault, lastPulse: m.cycle }))}, your vault opens for ${e(vault.heirName)}.</p>
        <p>If you're alive, one tap stops everything:</p>
        <a class="mail-btn alarm" href="#/pulse">I'm alive</a>
        <p>If you're reading this on their behalf because something has happened to them, you don't need to do anything.</p>
        <p>I'll send this every day until then, on every channel you gave us.</p>
        <p class="mail-sign">The Raven</p>`,
      short: `DeadBolt LAST WARNING: your vault opens for ${e(vault.heirName)} in ${GRACE_DAYS} days. If you're alive, tap now: ${e(pulseUrl)}`,
    };
  }
  const accepted = vault.heir && vault.heir.accepted;
  return {
    from: "DeadBolt &lt;notices@deadbolt.example&gt;", to: e(accepted ? vault.heir.account : vault.heirEmail), via: "Email",
    subject: "Something was left for you", tone: "heir",
    body: `<p>Dear ${e(heirFirst)},</p>
      <p>We're writing because ${e(ownerAcct)} used DeadBolt to leave you something private, and they haven't checked in for a long time. After three missed check-ins and ${GRACE_DAYS} days of warnings, it has now been released to you.</p>
      <p>We're sorry if this comes at a hard time. There's no rush. It will wait for you.</p>
      <p>When you're ready:</p>
      <ol>
        <li>Find the card they gave you.</li>
        <li>Open ${e(claimUrl)}</li>
        <li>Sign in with the Google account you accepted with, and follow the steps.</li>
      </ol>
      ${accepted ? "" : "<p>You never accepted the invitation on your card, so the usual route isn't open to you. Ask whoever holds their sealed backup (often their lawyer) about the break-glass route.</p>"}
      <a class="mail-btn" href="#/claim">Open what they left</a>
      <p class="mail-sign">DeadBolt</p>`,
    short: "",
  };
}

function renderOutbox() {
  if (!vault) return;
  const box = vault.outbox || [];
  const key = `${vault.inviteToken}|${box.length}|${vault.heir && vault.heir.accepted}`;
  if (key === outboxKey) return;
  outboxKey = key;
  $("#outboxEmpty").hidden = box.length > 0;
  $("#outbox").innerHTML = [...box].sort((a, b) => b.t - a.t).map((m) => {
    const msg = messageFor(m);
    return `<li><details>
      <summary><span class="ob-meta mono">${dayStamp(vault, m.t)} · ${msg.via} → ${msg.to}</span>
      <span class="ob-subject ${msg.tone}">${msg.subject}</span></summary>
      <div class="mail">
        <div class="mail-head mono"><b>From</b>${msg.from}<br><b>To</b>${msg.to}<br><b>Subject</b>${msg.subject}</div>
        <div class="mail-body">${msg.body}</div>
        ${msg.short ? `<div class="mail-short mono"><p><b>Telegram / SMS version:</b></p><p>${msg.short}</p></div>` : ""}
      </div></details></li>`;
  }).join("");
}

/* =========================================================
   THE HEIR: invitation, acceptance, and a release bound to their account
   ========================================================= */
let heirSignedIn = false;
let invKey = "";
const hashParams = () => new URLSearchParams(location.hash.split("?")[1] || "");
const inviteHash = () => (vault ? `#/invite?t=${vault.inviteToken}` : "#/invite");

function renderInvite(force = false) {
  const token = hashParams().get("t");
  const valid = !!vault && token === vault.inviteToken;
  const withdrawn = !!vault && !valid && !!token && vault.retired.invites.includes(token);
  const accepted = !!vault && vault.heir.accepted;
  const key = [!!vault, valid, withdrawn, accepted, vault && vault.inviteToken].join("|");
  if (key === invKey && !force) return;
  invKey = key;
  const body = $("#invBody");
  if (!vault) {
    $("#invKicker").textContent = "No invitation";
    $("#invHead").textContent = "Nothing here yet.";
    body.innerHTML = "<p>There's no vault on this device, so there's no invitation to accept.</p>";
  } else if (withdrawn) {
    $("#invKicker").textContent = "Invitation withdrawn";
    $("#invHead").textContent = "This invitation is no longer active.";
    body.innerHTML = "<p>The person who sent it changed their plans, so there's nothing for you to do here. If they've named you again, they'll give you a new card with a new link.</p>";
  } else if (!valid) {
    $("#invKicker").textContent = "Invitation link incomplete";
    $("#invHead").textContent = "Use the link on your card.";
    body.innerHTML = "<p>This link is missing its code. Open the exact link printed on the card you were given.</p>";
  } else {
    $("#invKicker").textContent = `A message for ${vault.heirName}`;
    $("#invHead").textContent = "You've been named.";
    body.innerHTML = `
      <p>${escapeHtml(vault.owner ? vault.owner.account : "Someone who cares about you")} has used DeadBolt to leave you something private. Nothing happens now, and there's nothing for you to do except one tap below.</p>
      <p>What this means:</p>
      <ul>
        <li>They check in every ${vault.interval} days. As long as they do, nothing is ever released.</li>
        <li>If they go silent for a long time (3 missed check-ins, then 14 days of alarms), you'll be told, and you'll be able to open what they left.</li>
        <li>You'll need two things then: the card they gave you, and the Google account you accept with now.</li>
      </ul>
      <p>Keep the card somewhere safe. On its own it opens nothing.</p>`;
  }
  $("#invAccept").hidden = !valid || accepted;
  const done = $("#invDone");
  done.hidden = !(valid && accepted);
  if (valid && accepted) done.textContent = `Accepted as ${vault.heir.account}. You can close this page. We hope you never need it.`;
}
$("#invAccept").addEventListener("click", () => {
  if (!vault || !chainReady("your acceptance")) return;
  vault.heir = { accepted: true, account: vault.heirEmail, address: "0x" + toHex(crypto.getRandomValues(new Uint8Array(32))) };
  log(`${vault.heirName} accepted as ${vault.heir.account}. The last piece can only be released to that account.`, "v");
  save();
  toast("Invitation accepted (simulated sign-in).");
  renderInvite(true);
});
(function invLoop() {
  if (!$('[data-route="/invite"]').hidden) renderInvite();
  requestAnimationFrame(invLoop);
})();

$("#heirSignIn").addEventListener("click", () => {
  const err = $("#claimError");
  if (!vault || !chainReady("the request")) return;
  if (!vault.heir.accepted) {
    err.textContent = `${vault.heirName} never accepted the invitation, so the chain can't release the last piece to their account. Use the break-glass route below.`;
    return;
  }
  heirSignedIn = true;
  log(`${vault.heirName} signed in as ${vault.heir.account}. Shard C released to that account.`, "e");
  renderClaim();
  toast(`Signed in as ${vault.heir.account} (simulated).`);
});

let heirStatusKey = "";
function renderHeirStatus() {
  if (!vault) return;
  const accepted = vault.heir.accepted;
  const k = `${vault.inviteToken}|${accepted}`;
  if (k === heirStatusKey) return;
  heirStatusKey = k;
  const mapA = $("#mapA");
  mapA.textContent = accepted ? "accepted" : "invited";
  mapA.classList.toggle("ok", accepted);
  const s = $("#heirStatus");
  s.innerHTML = accepted
    ? `${escapeHtml(vault.heirName)} accepted as ${escapeHtml(vault.heir.account)}. Not them? <button type="button" class="link-btn" data-open-reseal>Change your heir</button>.`
    : `${escapeHtml(vault.heirName)} hasn't accepted yet. Until they do, the chain can't release anything to them.`;
  s.classList.toggle("warn", !accepted);
  $("#inviteLink").href = inviteHash();
}

/* =========================================================
   MANAGE THE VAULT: interval, reseal (new heir or new contents), destroy.
   Every change is signed by the owner, so it also counts as a check-in.
   ========================================================= */
let mgKey = "";
const RETIRED_CARD = "That card was retired when the owner sealed the vault again. It doesn't open anything any more.";
const sha256 = async (s) => toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
async function isRetired(kind, raw) {
  if (!vault || !raw || !raw.trim()) return false;
  let norm;
  try { norm = encodeShare(decodeShare(raw)); } catch { return false; }
  return vault.retired[kind].includes(await sha256(norm));
}
const ownerName = () => (vault && vault.owner ? vault.owner.account : "the owner");

function signedChange(msg) {
  const was = stateOf(vault);
  vault.lastPulse = vault.simNow;
  log(`${msg} Signed by ${ownerName()}, so it also counts as a check-in.`, "v");
  prevState = was; // the transition handler logs a revival if they were late
  save();
}

function renderManage() {
  if (!vault) return;
  const released = stateOf(vault) === "RELEASED";
  const k = [vault.inviteToken, vault.interval, released].join("|");
  if (k === mgKey) return;
  mgKey = k;
  $$('input[name="mgInterval"]').forEach((r) => { r.checked = Number(r.value) === vault.interval; r.disabled = released; });
  $("#mgIntervalBlock").hidden = released;
  $("#mgReseal").hidden = released;
  $("#manageNote").textContent = released
    ? `Too late to change anything: the vault has already opened for ${vault.heirName}.`
    : `Every change here is signed by ${ownerName()}, so it also counts as a check-in.`;
}

$$('input[name="mgInterval"]').forEach((r) => r.addEventListener("change", () => {
  if (!vault || stateOf(vault) === "RELEASED") return;
  if (!chainReady("the change")) { mgKey = ""; renderManage(); return; }
  const n = Number(r.value);
  if (n === vault.interval) return;
  const was = vault.interval;
  vault.interval = n;
  signedChange(`Check-in interval changed from every ${was} days to every ${n}.`);
  toast(`Now every ${n} days. That counted as a check-in too.`);
}));

function openReseal() {
  const d = $("#mgReseal");
  d.open = true;
  d.scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#heirStatus").addEventListener("click", (e) => { if (e.target.closest("[data-open-reseal]")) openReseal(); });
$("#mgReseal").addEventListener("toggle", () => {
  if (!$("#mgReseal").open || !vault) return;
  renderProofs();
  $("#mgHeirName").value = vault.heirName;
  $("#mgHeirEmail").value = vault.heirEmail;
  $("#mgSecret").value = "";
  $("#mgErr").textContent = "";
});
$("#mgSample").addEventListener("click", () => { $("#mgSecret").value = SAMPLE; });

$("#mgResealGo").addEventListener("click", async () => {
  const err = $("#mgErr");
  err.textContent = "";
  if (!vault || stateOf(vault) === "RELEASED") return;
  if (!chainReady("the new seal")) return;
  const name = $("#mgHeirName").value.trim();
  const email = $("#mgHeirEmail").value.trim();
  const secret = $("#mgSecret").value;
  if (!name) { err.textContent = "Name your heir. Even if it's the same person."; return; }
  if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = "That email looks cursed. Check the spelling."; return; }
  if (!secret.trim()) { err.textContent = "Paste what you sealed before, or write it fresh. DeadBolt never kept a copy, so it can't fill this in for you."; return; }
  const btn = $("#mgResealGo");
  btn.disabled = true; btn.textContent = "Checking your backup…";
  try {
    await proveOwner("mg");
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = "Seal it again";
    return;
  }
  btn.textContent = "Sealing…";
  try {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret)));
    const [a, b, c] = split(keyBytes, 3, 2).map(encodeShare);

    const oldHeir = vault.heirName;
    const sameHeir = email.toLowerCase() === vault.heirEmail.toLowerCase();
    vault.retired.cards.push(await sha256(vault.shards.a));
    vault.retired.backups.push(await sha256(vault.shards.b));
    vault.retired.invites.push(vault.inviteToken);
    Object.assign(vault, {
      heirName: name, heirEmail: email,
      iv: toHex(iv), ct: toHex(ct),
      shards: { a, b, c },
      inviteToken: toHex(crypto.getRandomValues(new Uint8Array(16))),
      heir: sameHeir ? vault.heir : { accepted: false, account: null, address: null },
    });
    signedChange(sameHeir
      ? `Vault sealed again for ${name}: new key, new pieces. The old card, the old backup and the old invitation open nothing now.`
      : `Heir changed from ${oldHeir} to ${name}. Vault sealed again: ${oldHeir}'s card, the old backup and the old invitation open nothing now.`);
    if (!sameHeir) log(`${name} needs to accept their new card before the chain can release anything to them.`, "r");
    $("#mgSealed").value = ""; $("#mgPw").value = "";

    // old keepsakes are useless: send the owner straight to the new ones
    lastSealed = null; heirSignedIn = false; revealed = false;
    $("#reveal").hidden = true; $("#shardInput").value = "";
    $("#mgSecret").value = "";
    $("#mgReseal").open = false;
    mgKey = ""; heirStatusKey = ""; outboxKey = "";
    save();
    openKeepsakes(`Sealed again for ${escapeHtml(name)}. <b>Print the new card and save a new backup.</b> The old ones open nothing now.`);
    toast("Sealed again. Now print the new card and save a new backup.");
  } catch (e) {
    console.error(e);
    err.textContent = "Sealing failed. This browser might be too old for it.";
  } finally {
    btn.disabled = false; btn.textContent = "Seal it again";
  }
});

async function proveOwner(p) {
  const sealed = $(`#${p}Sealed`).value;
  if (!sealed.trim()) throw new Error("Paste your sealed backup first. Your Google sign-in alone can't do this, on purpose.");
  if (!$(`#${p}Pw`).value) throw new Error("Type your backup password too.");
  const opened = await openBackup(sealed, $(`#${p}Pw`).value);
  if (encodeShare(opened.share) !== vault.shards.b) throw new Error("That backup belongs to another vault, or to an older version of this one.");
}
function renderProofs() {
  $$(".proof-paste").forEach((b) => (b.hidden = !lastSealed));
  $$(".proof-none").forEach((b) => (b.hidden = !!lastSealed));
}
$$(".proof-paste").forEach((b) => b.addEventListener("click", () => {
  if (lastSealed) $(`#${b.dataset.proof}Sealed`).value = lastSealed;
}));
$$("[data-keepsakes]").forEach((b) => b.addEventListener("click", () =>
  openKeepsakes("Seal your backup here, then go back to Vitals. <b>Keep the file and the password in different places.</b>")));

function openKeepsakes(caption) {
  if (!vault) return;
  $("#stitchStage").classList.add("live");
  $('.shard[data-s="a"] code').textContent = vault.shards.a;
  $('.shard[data-s="b"] code').textContent = vault.shards.b;
  $('.shard[data-s="c"] code').textContent = vault.shards.c;
  $("#keyPreview").textContent = "destroyed · only shards remain";
  $("#stitchCaption").innerHTML = caption;
  $("#keepsakes").hidden = false;
  forged = true;
  location.hash = "#/table";
  showStep(4);
}

$("#destroyAsk").addEventListener("click", () => {
  renderProofs();
  if (!chainReady("the delete")) return;
  $("#destroyConfirm").hidden = false;
  $("#destroyAsk").hidden = true;
});
$("#destroyKeep").addEventListener("click", () => {
  $("#destroyConfirm").hidden = true;
  $("#destroyAsk").hidden = false;
});

/* =========================================================
   SIGNED CHECK-INS (simulated Google sign-in, zkLogin in the real build)
   ========================================================= */
let owner = null;
let pulsedHere = false;
let ppKey = "";

function fakeAddress() {
  return "0x" + toHex(crypto.getRandomValues(new Uint8Array(32)));
}
const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function renderSignin() {
  const btn = $("#googleBtn");
  const out = $("#signedAs");
  if (owner) {
    btn.textContent = "Signed in ✓";
    btn.classList.add("done");
    out.hidden = false;
    out.textContent = `Signed in as ${owner.account} · your check-in address ${shortAddr(owner.address)}`;
  } else {
    btn.textContent = "Continue with Google";
    btn.classList.remove("done");
    out.hidden = true;
  }
}
function signIn() {
  if (owner) return;
  owner = { account: "owner@example.com", address: fakeAddress() };
  renderSignin();
  toast("Signed in (simulated). Your check-ins will be signed by this account.");
}
$("#googleBtn").addEventListener("click", signIn);

function renderPulsePage(force = false) {
  const st = stateOf(vault);
  const missed = vault ? missedCount(vault) : 0;
  const daysLeft = vault && st === "GRACE" ? Math.ceil((releaseAt(vault) - vault.simNow) / DAY) : 0;
  const key = [st, missed, daysLeft, pulsedHere, chain.status].join("|");
  if (key === ppKey && !force) return;
  ppKey = key;
  const heir = vault ? vault.heirName : "";
  const copy = {
    none: ["Nothing to check in for.", "You don't have a vault yet. When you do, your reminder email brings you here."],
    ALIVE: ["Still with us?", "You're not due yet, but checking in early is fine. One tap resets the clock and your vault stays locked."],
    FLATLINE: ["You missed a check-in.", `That's ${missed} of 3. Nothing has happened to your vault. One tap and it's as if you never left.`],
    GRACE: ["This is your last warning.", `You've missed 3 check-ins in a row. In ${daysLeft} day${daysLeft === 1 ? "" : "s"} your vault opens for ${heir}. One tap stops it.`],
    RELEASED: ["Too late.", `Your vault has already opened for ${heir}. If you're reading this, that's awkward.`],
  }[vault ? st : "none"];
  $("#ppHead").textContent = pulsedHere ? "Got it. You're alive." : copy[0];
  $("#ppLede").textContent = pulsedHere ? "Your vault stays locked. You can close this page." : copy[1];
  $("#pp").classList.toggle("urgent", !pulsedHere && st === "GRACE");
  const canPulse = !!vault && st !== "RELEASED" && !pulsedHere && chain.status === "ok";
  $("#ppBtn").hidden = !vault || pulsedHere;
  $("#ppBtn").disabled = !canPulse;
  $("#ppBtn").classList.toggle("urgent", st === "FLATLINE" || st === "GRACE");
  $("#ppFallback").hidden = !canPulse;
  if (vault && !pulsedHere && chain.status === "down") $("#ppLede").textContent = "We can't reach the chain right now, so we can't record a check-in. Nothing has changed with your vault. Try again in a minute.";
  $("#ppMake").hidden = !!vault;
  $("#ppSign").textContent = vault && vault.owner && canPulse
    ? `Signed by ${vault.owner.account} (${shortAddr(vault.owner.address)}). DeadBolt pays the fee but can't sign for you.`
    : "";
}
function pulseFromPage(via) {
  if (!recordPulse(via)) return;
  pulsedHere = true;
  const done = $("#ppDone");
  done.hidden = false;
  done.innerHTML = `<b>Recorded on the chain</b> on ${dayStamp(vault)}. Your next check-in is due in ${vault.interval} days.` +
    (via === "wallet" ? " You paid the fee from your own wallet this time." : "");
  renderPulsePage(true);
}
$("#ppBtn").addEventListener("click", () => pulseFromPage("sponsored"));
$("#ppWallet").addEventListener("click", () => pulseFromPage("wallet"));
(function ppLoop() {
  if (!$('[data-route="/pulse"]').hidden) renderPulsePage();
  else $("#ppDone").hidden = true;
  requestAnimationFrame(ppLoop);
})();

/* =========================================================
   THE RAVEN: a guide that always says what to tap next
   ========================================================= */
let revealed = false;
let guideHushed = false;
try { guideHushed = localStorage.getItem("deadbolt.guide.hushed") === "1"; } catch {}
let guideKey = "";
let guideAction = null;
const curRoute = () => (location.hash.replace(/^#/, "") || "/").split("?")[0];
const go = (hash) => () => { location.hash = hash; };

function guideFor() {
  const r = curRoute();
  const st = stateOf(vault);
  if (vault && chain.status === "down" && CHAIN_ROUTES.includes(r))
    return ["The chain has gone quiet. I'm showing the last thing it told us, and I won't pretend anything opened. Check-ins and claims wait until it's back. Break-glass doesn't need it.",
      "Restore the chain (demo)", () => { if (chain.cut) $("#chainToggle").click(); else readChain(); }];
  if (r === "/table") {
    if (forged) return ["It's alive! Print your heir's card, and seal your own backup with a password. Mortals always forget.", "Open the vitals", go("#/vitals")];
    if (step === 1) return ["What should outlive you? I'd go with a letter. My sample has wallet words, land documents and a debt to collect in it.", "Fill a sample for me",
      () => { if (!$("#secret").value.trim()) $("#secret").value = KINDS[currentKind()].sample; showStep(2); }];
    if (step === 2) return ["Who gets it when you're gone? Choose carefully. Ravens remember.", "Use a sample heir",
      () => { if (!$("#heirName").value.trim()) $("#heirName").value = "Aisha Bello"; if (!$("#heirEmail").value.trim()) $("#heirEmail").value = "aisha@example.com"; showStep(3); }];
    if (step === 3 && !owner) return ["How often should I check you're still breathing? And sign in, so only you can say you're alive. No wallet needed.", "Sign me in (demo)", signIn];
    if (step === 3) return ["Signed in. I'll only start worrying after three missed check-ins in a row.", "Thirty days is fine", () => showStep(4)];
    return ["Pull the lever. Your secret gets locked right here in this browser. Only scrambled noise ever leaves.", "⚡ Throw the switch", () => $("#nextBtn").click()];
  }
  if (r === "/vitals") {
    if (!vault) return ["An empty table. Deeply unsettling. Let's build you a creature.", "To the operating table", go("#/table")];
    if (st === "ALIVE" && !vault.heir.accepted) return [`Steady heartbeat. ${vault.heirName}'s card has an invitation link on it. Let's see what she sees when she opens it.`, "Open the invitation", () => { location.hash = inviteHash(); }];
    if (st === "ALIVE") return ["Steady heartbeat. Now imagine you stop answering your check-ins. I'll skip ahead and show you what happens.", "Skip to a missed check-in",
      () => { jumpTo(dueAt(vault) + 1000); }];
    if (st === "FLATLINE") return ["You missed a check-in, so I've sent you a reminder. It's in the outbox below. Nothing happens until you've missed three in a row.", "Miss all three",
      () => { jumpTo(graceAt(vault) + 1000); }];
    if (st === "GRACE") return ["Three missed in a row. Grace period: 14 days of alarms on every channel. One tap undoes everything. Or…", "Let it lapse",
      () => { jumpTo(releaseAt(vault) + 1000); }];
    return ["The chain clock has spoken. Shard C is free. Your heir may now read the will.", "Go to the will", go("#/claim")];
  }
  if (r === "/invite") {
    if (!vault) return ["No invitation here. Make a vault first.", "To the operating table", go("#/table")];
    if (!vault.heir.accepted) return [`This is what ${vault.heirName} sees on day one. Calm on purpose. I save the drama for later.`, `Accept as ${vault.heirName.split(" ")[0]} (demo)`, () => $("#invAccept").click()];
    return ["Accepted. The last piece can now only ever go to that account.", "Back to the owner's vitals", go("#/vitals")];
  }
  if (r === "/pulse") {
    if (!vault) return ["This is the page your reminder email opens. Make a vault first.", "To the operating table", go("#/table")];
    if (st === "RELEASED") return ["Too late for check-ins. The will has been read.", "Go to the will", go("#/claim")];
    if (pulsedHere) return ["Recorded, and signed by you. Even I can't fake that. See you next month.", "Back to the vitals", go("#/vitals")];
    return ["This is what your monthly email opens. One tap, signed by you. Even your gran could do it.", "Tap \"I'm alive\"", () => $("#ppBtn").click()];
  }
  if (r === "/claim") {
    if (!vault) return ["Nothing buried here yet. Make a vault first, then come back to dig.", "To the operating table", go("#/table")];
    if (revealed) return [st === "RELEASED" ? "It lives again. No lawyer, no company, no early release. That's DeadBolt." : "Opened by break-glass: the card, the sealed backup and the password, no chain needed. That's the fallback working.", "Start over", () => { wipeVault("Fresh table. Run it again whenever you like."); location.hash = "#/"; }];
    if (st !== "RELEASED") return ["Too soon. The owner may still be breathing. Shard C stays locked until the grace period runs out.", "Check the vitals", go("#/vitals")];
    if (!heirSignedIn && vault.heir.accepted) return [`First, prove you're ${vault.heirName}. The last piece only goes to the account that accepted.`, `Sign in as ${vault.heirName.split(" ")[0]} (demo)`, () => $("#heirSignIn").click()];
    if (!heirSignedIn) return [`${vault.heirName} never accepted the invitation, so the normal route is shut. The break-glass route below still works with the sealed backup.`, "Check the vitals", go("#/vitals")];
    if (!revealed) return ["Paste your shard A, then reanimate. I kept a copy of the demo heir's. Ravens hoard things.", "Paste and reanimate",
      () => { $("#pasteDemoShard").click(); $("#claimBtn").click(); }];
    return ["It lives again. No lawyer, no company, no early release. That's DeadBolt.", "Start over", () => { wipeVault("Fresh table. Run it again whenever you like."); location.hash = "#/"; }];
  }
  if (!vault) return ["Your keys die with you. Unless… Want to watch the whole experiment in 60 seconds? I'll guide you.", "Run the experiment", go("#/table")];
  if (st === "RELEASED") return ["Your creature has risen. Go and see what it left behind.", "Go to the will", go("#/claim")];
  return ["Your creature is alive and twitching. Go and check its vitals.", "Open the vitals", go("#/vitals")];
}

function renderGuide(force = false) {
  const key = [curRoute(), step, !!forged, !!owner, pulsedHere, chain.status, vault ? stateOf(vault) : "none", vault ? vault.heir.accepted : "-", heirSignedIn, revealed, guideHushed].join("|");
  if (key === guideKey && !force) return;
  guideKey = key;
  const [text, label, run] = guideFor();
  guideAction = run;
  $("#guideText").textContent = text;
  $("#guideDo").textContent = label;
  $("#guide").classList.toggle("hushed", guideHushed);
  $("#guideBird").setAttribute("aria-expanded", String(!guideHushed));
  document.body.classList.toggle("guide-open", !guideHushed);
  const bubble = $("#guideBubble");
  bubble.classList.remove("swap"); void bubble.offsetWidth; bubble.classList.add("swap");
  const bird = $("#guideBird");
  bird.classList.remove("hop"); void bird.offsetWidth; bird.classList.add("hop");
}
function setHushed(v) {
  guideHushed = v;
  try { localStorage.setItem("deadbolt.guide.hushed", v ? "1" : "0"); } catch {}
  renderGuide(true);
}
$("#guideDo").addEventListener("click", () => { if (guideAction) guideAction(); renderGuide(true); });
$("#guideHush").addEventListener("click", () => setHushed(true));
$("#guideBird").addEventListener("click", () => setHushed(!guideHushed));
$$("[data-tour]").forEach((el) => el.addEventListener("click", () => setHushed(false)));
(function guideLoop() { renderGuide(); requestAnimationFrame(guideLoop); })();

/* ---------------- keepsakes: heir card + owner backup ---------------- */
$("#printCard").addEventListener("click", () => {
  if (!vault) return;
  const claimUrl = `${location.origin}${location.pathname}#/claim`;
  const inviteUrl = `${location.origin}${location.pathname}#/invite?t=${vault.inviteToken}`;
  $("#heirCard").innerHTML = `<div class="hc">
    <p class="hc-top">HERE RESTS A KEY</p>
    <h1>For ${escapeHtml(vault.heirName)}</h1>
    <p>Someone who cares about you used DeadBolt to leave you something private. This card is your half of the key.
    On its own it opens nothing, so it's safe to keep in a drawer.</p>
    <h2>Do this now</h2>
    <ol>
      <li>Open <b>${escapeHtml(inviteUrl)}</b></li>
      <li>Press <b>Accept with Google</b>. That account is the only one the last piece will ever be released to.</li>
    </ol>
    <h2>When the time comes</h2>
    <ol>
      <li>DeadBolt will let you know when the vault opens.</li>
      <li>Go to <b>${escapeHtml(claimUrl)}</b></li>
      <li>Sign in with the same Google account, type or paste the code below, then press <b>Reanimate</b>.</li>
    </ol>
    <p class="hc-code">${escapeHtml(vault.shards.a)}</p>
    <p class="hc-foot">Keep this card private. Don't photograph it or post it online.</p>
  </div>`;
  window.print();
});
/* ---------------- sealed backup (shard B never leaves unsealed) ---------------- */
const KDF_ITERATIONS = 600_000; // OWASP minimum for PBKDF2-HMAC-SHA256 (the real build: Argon2id)
let lastSealed = null;

async function passwordKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: KDF_ITERATIONS },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
// DBB2: the sealed payload is shard B plus a copy of the locked vault (it's useless without two shards).
// So break-glass needs only the heir's card, this file and the password: no chain, no DeadBolt.
async function sealBackup(shard, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt);
  const payload = JSON.stringify({ b: shard, iv: vault.iv, ct: vault.ct });
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(payload)));
  return `DBB2-${toHex(salt)}-${toHex(iv)}-${toHex(ct)}`;
}
async function openBackup(sealed, password) {
  const m = sealed.trim().match(/^DBB([12])-([0-9a-f]{32})-([0-9a-f]{24})-([0-9a-f]+)$/i);
  if (!m) throw new Error("That's not a sealed DeadBolt backup. They start with DBB2- (or DBB1- for older ones).");
  let text;
  try {
    const key = await passwordKey(password, fromHex(m[2]));
    text = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(m[3]) }, key, fromHex(m[4])));
  } catch {
    throw new Error("Wrong password, or that backup belongs to another vault.");
  }
  if (m[1] === "1") return { share: decodeShare(text), iv: null, ct: null };
  const o = JSON.parse(text);
  return { share: decodeShare(o.b), iv: o.iv, ct: o.ct };
}
function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#downloadBackup").addEventListener("click", () => {
  if (!vault) return;
  $("#sealForm").hidden = false;
  $("#sealPw").focus();
});
$("#sealGo").addEventListener("click", async () => {
  const err = $("#sealErr");
  err.textContent = "";
  const pw = $("#sealPw").value, pw2 = $("#sealPw2").value;
  if (pw.length < 10) { err.textContent = "Ten characters at least. A short sentence works well."; return; }
  if (pw !== pw2) { err.textContent = "Those two don't match. Ravens notice these things."; return; }
  const btn = $("#sealGo");
  btn.disabled = true; btn.textContent = "Sealing…";
  try {
    const sealed = await sealBackup(vault.shards.b, pw);
    lastSealed = sealed;
    downloadText("deadbolt-sealed-backup.txt", [
      "DeadBolt sealed backup (shard B)",
      "",
      "This piece is locked with a password only the owner knows. On its own it opens nothing.",
      "It also carries a locked copy of the vault. So with the heir's card AND the password, it opens the vault even if the chain and DeadBolt are both gone.",
      "Keep this file and the password in different places. Leave them only with someone you'd trust with the vault itself.",
      "",
      sealed,
      "",
    ].join("\n"));
    log("Owner backup sealed with a password. DeadBolt never saw the password.", "v");
    $("#sealPw").value = ""; $("#sealPw2").value = "";
    $("#sealForm").hidden = true;
    toast("Backup sealed and saved. Keep the file and the password in different places.");
  } catch (e) {
    console.error(e);
    err.textContent = "Sealing failed. This browser might be too old for it.";
  } finally {
    btn.disabled = false; btn.textContent = "Seal and download";
  }
});

/* ---------------- break-glass: card + sealed backup + password, no chain needed ---------------- */
$("#breakglass").addEventListener("toggle", () => { $("#bgPasteDemo").hidden = !lastSealed; });
$("#bgPasteDemo").addEventListener("click", () => { if (lastSealed) $("#bgSealed").value = lastSealed; });
$("#bgGo").addEventListener("click", async () => {
  const err = $("#bgErr");
  err.textContent = "";
  const btn = $("#bgGo");
  try {
    if (!vault) throw new Error("No vault on this device. Nothing to dig up.");
    if (!$("#shardInput").value.trim()) throw new Error("Paste your card (shard A) above first. The backup alone opens nothing.");
    if (await isRetired("cards", $("#shardInput").value)) throw new Error(RETIRED_CARD);
    const a = decodeShare($("#shardInput").value);
    btn.disabled = true; btn.textContent = "Checking the password…";
    const opened = await openBackup($("#bgSealed").value, $("#bgPw").value);
    if (await isRetired("backups", encodeShare(opened.share))) throw new Error("That backup was retired when the owner sealed the vault again. It belongs to the old version and opens nothing now.");
    // a DBB2 backup carries its own locked copy of the vault: nothing from the chain or DeadBolt is used
    const locked = opened.ct ? { iv: opened.iv, ct: opened.ct } : { iv: vault.iv, ct: vault.ct };
    await reanimate([a, opened.share], "the heir's card and the sealed backup, without the chain (break-glass)", "opened by break-glass", locked);
    $("#bgPw").value = "";
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Break the glass";
  }
});

/* ---------------- motion: reveal on scroll ---------------- */
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if ("IntersectionObserver" in window && !reduceMotion) {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }),
    { threshold: 0.22, rootMargin: "0px 0px -8% 0px" }
  );
  $$(".etched:not(.hero)").forEach((el) => { el.classList.add("dev"); io.observe(el); });
  $$(".stitch-row").forEach((el) => { el.classList.add("sew"); io.observe(el); });
}

/* ---------------- boot ---------------- */
document.querySelector('a[href="#anatomy"]').addEventListener("click", (e) => {
  e.preventDefault();
  $("#anatomy").scrollIntoView({ behavior: "smooth" });
});
setSpeed(1);
showStep(1);
route();
requestAnimationFrame((t) => { lastFrame = t; requestAnimationFrame(frame); });
