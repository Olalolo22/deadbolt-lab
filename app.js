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
    vault.simNow += dt * daysPerSec * DAY / 1000;
    const st = stateOf(vault);
    if (st !== prevState) onTransition(prevState, st);
    prevState = st;
    const m = missedCount(vault);
    if (st === "FLATLINE" && m > prevMissed && m > 1) log(`Missed check-in ${m} of ${MISSES_TO_GRACE}. Reminder sent via ${vault.channel}.`, "r");
    prevMissed = m;
  }
  if (!$('[data-route="/"]').hidden) heroEcg(dt);
  if (!$('[data-route="/vitals"]').hidden && vault) { vitalsEcg(dt); renderVitals(); }
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
    if (e && !/^\S+@\S+\.\S+$/.test(e)) return "That email looks cursed. Check the spelling.";
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
      log: [],
    };
    prevState = "ALIVE";
    log(`Creature assembled. Heir: ${vault.heirName}. Pulse every ${interval} days via ${channel}.`, "v");
    log("Key split 2-of-3: A → heir, B → owner, C → chain clock.");
    log(`Only ${owner.account} can check in. DeadBolt covers the fees.`);
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

  const vKey = `${st}:${missed}`;
  if (vKey !== lastVitalsState || force) {
    lastVitalsState = vKey;
    $("#vHeadline").textContent = st === "FLATLINE" ? `Check-in missed (${missed} of ${MISSES_TO_GRACE}).` : HEADLINES[st];
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
    if (b.dataset.jump === "grace") vault.simNow = Math.max(vault.simNow, graceAt(vault) + 1000);
    if (b.dataset.jump === "release") vault.simNow = Math.max(vault.simNow, releaseAt(vault) + 1000);
  })
);
$("#resetVault").addEventListener("click", () => {
  if (!vault) return;
  vault = null; forged = null; prevState = null; lastVitalsState = null;
  owner = null; renderSignin();
  save();
  $("#stitchStage").classList.remove("live");
  $$(".shard code").forEach((c) => (c.textContent = "—"));
  showStep(1);
  renderVitals(true);
  revealed = false;
  $("#reveal").hidden = true;
  $("#shardInput").value = "";
  $("#keepsakes").hidden = true;
  toast("Creature destroyed. Nothing was kept, not even a toe.");
});

/* =========================================================
   CLAIM (heir)
   ========================================================= */
function renderClaim() {
  const st = stateOf(vault);
  const tomb = $("#tomb");
  $("#tombName").textContent = vault ? `Left for ${vault.heirName}` : "A sealed vault";
  const released = st === "RELEASED";
  tomb.classList.toggle("open", released);
  $("#tombMeta").textContent = !vault ? "no vault on this device" : released ? "shard C · released" : `shard C · locked · ${st.toLowerCase()}`;
  const box = $("#releasedBox");
  box.classList.toggle("hot", released);
  box.textContent = !vault
    ? "Nothing buried here yet. Assemble a vault on the operating table first."
    : released
    ? vault.shards.c
    : `Locked by the chain clock. Opens in ${fmtDur(releaseAt(vault) - vault.simNow)} if no pulse arrives.`;
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
    if (stateOf(vault) !== "RELEASED") throw new Error("Shard C is still locked. The owner may still be alive (awkward).");
    const a = decodeShare($("#shardInput").value);
    const c = decodeShare(vault.shards.c);
    if (a.x === c.x) throw new Error("Two copies of the same shard is still one shard. You need a different piece.");
    const keyBytes = combine([a, c]);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    let pt;
    try {
      pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(vault.iv) }, key, fromHex(vault.ct));
    } catch {
      throw new Error("The parts don't fit. That shard belongs to another creature.");
    }
    lightning();
    $("#tomb").classList.add("risen");
    setTimeout(() => $("#tomb").classList.remove("risen"), 600);
    $("#revealText").textContent = new TextDecoder().decode(pt);
    $("#letterMeta").textContent = `Left for ${vault.heirName} · opened on ${dayStamp(vault)}`;
    const letter = $(".letter"); letter.style.animation = "none"; void letter.offsetWidth; letter.style.animation = "";
    $("#reveal").hidden = false;
    $("#reveal").scrollIntoView({ behavior: "smooth", block: "center" });
    log(`${vault.heirName} rebuilt the key from shards A + C.`, "e");
    revealed = true;
  } catch (e) {
    errEl.textContent = e.message;
    $("#reveal").hidden = true;
  }
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
  const key = [st, missed, daysLeft, pulsedHere].join("|");
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
  const canPulse = !!vault && st !== "RELEASED" && !pulsedHere;
  $("#ppBtn").hidden = !vault || pulsedHere;
  $("#ppBtn").disabled = !canPulse;
  $("#ppBtn").classList.toggle("urgent", st === "FLATLINE" || st === "GRACE");
  $("#ppFallback").hidden = !canPulse;
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
  if (r === "/table") {
    if (forged) return ["It's alive! Shard A belongs to your heir. Print their card now. Mortals always forget.", "Open the vitals", go("#/vitals")];
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
    if (st === "ALIVE") return ["Steady heartbeat. Now imagine you stop answering your check-ins. I'll skip ahead and show you what happens.", "Skip to a missed check-in",
      () => { vault.simNow = Math.max(vault.simNow, dueAt(vault) + 1000); }];
    if (st === "FLATLINE") return ["You missed a check-in. I'm pecking at your inbox. Nothing happens until you've missed three in a row, and one tap resets it all.", "Miss all three",
      () => { vault.simNow = Math.max(vault.simNow, graceAt(vault) + 1000); }];
    if (st === "GRACE") return ["Three missed in a row. Grace period: 14 days of alarms on every channel. One tap undoes everything. Or…", "Let it lapse",
      () => { vault.simNow = Math.max(vault.simNow, releaseAt(vault) + 1000); }];
    return ["The chain clock has spoken. Shard C is free. Your heir may now read the will.", "Go to the will", go("#/claim")];
  }
  if (r === "/pulse") {
    if (!vault) return ["This is the page your reminder email opens. Make a vault first.", "To the operating table", go("#/table")];
    if (st === "RELEASED") return ["Too late for check-ins. The will has been read.", "Go to the will", go("#/claim")];
    if (pulsedHere) return ["Recorded, and signed by you. Even I can't fake that. See you next month.", "Back to the vitals", go("#/vitals")];
    return ["This is what your monthly email opens. One tap, signed by you. Even your gran could do it.", "Tap \"I'm alive\"", () => $("#ppBtn").click()];
  }
  if (r === "/claim") {
    if (!vault) return ["Nothing buried here yet. Make a vault first, then come back to dig.", "To the operating table", go("#/table")];
    if (st !== "RELEASED") return ["Too soon. The owner may still be breathing. Shard C stays locked until the grace period runs out.", "Check the vitals", go("#/vitals")];
    if (!revealed) return ["Paste your shard A, then reanimate. I kept a copy of the demo heir's. Ravens hoard things.", "Paste and reanimate",
      () => { $("#pasteDemoShard").click(); $("#claimBtn").click(); }];
    return ["It lives again. No lawyer, no company, no early release. That's DeadBolt.", "Start over", () => { $("#resetVault").click(); location.hash = "#/"; }];
  }
  if (!vault) return ["Your keys die with you. Unless… Want to watch the whole experiment in 60 seconds? I'll guide you.", "Run the experiment", go("#/table")];
  if (st === "RELEASED") return ["Your creature has risen. Go and see what it left behind.", "Go to the will", go("#/claim")];
  return ["Your creature is alive and twitching. Go and check its vitals.", "Open the vitals", go("#/vitals")];
}

function renderGuide(force = false) {
  const key = [curRoute(), step, !!forged, !!owner, pulsedHere, vault ? stateOf(vault) : "none", revealed, guideHushed].join("|");
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
  $("#heirCard").innerHTML = `<div class="hc">
    <p class="hc-top">HERE RESTS A KEY</p>
    <h1>For ${escapeHtml(vault.heirName)}</h1>
    <p>Someone who cares about you used DeadBolt to leave you something private. This card is your half of the key.
    On its own it opens nothing, so it's safe to keep in a drawer.</p>
    <h2>When the time comes</h2>
    <ol>
      <li>DeadBolt will let you know when the vault opens.</li>
      <li>Go to <b>${escapeHtml(claimUrl)}</b></li>
      <li>Type or paste the code below, then press <b>Reanimate</b>.</li>
    </ol>
    <p class="hc-code">${escapeHtml(vault.shards.a)}</p>
    <p class="hc-foot">Keep this card private. Don't photograph it or post it online.</p>
  </div>`;
  window.print();
});
$("#downloadBackup").addEventListener("click", () => {
  if (!vault) return;
  const text = [
    "DeadBolt owner backup (shard B)",
    "",
    "This is YOUR piece of the key, not your heir's.",
    "Keep it somewhere safe and offline. On its own it opens nothing.",
    "",
    vault.shards.b,
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: "deadbolt-backup-shard-B.txt" });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup saved. Hide it somewhere better than your Downloads folder.");
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
  $$(".anatomy").forEach((el) => { el.classList.add("sew"); io.observe(el); });
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
