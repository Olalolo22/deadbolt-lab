import { split, combine, toHex, fromHex, encodeShare, decodeShare } from "./shamir.js";

/* =========================================================
   DeadBolt Lab: client-side prototype.
   Real crypto (AES-256-GCM + 2-of-3 Shamir). Simulated chain clock.
   ========================================================= */

const DAY = 86_400_000;
const GRACE_DAYS = 14;
const FLATLINE_DAYS = 1; // first day after a missed pulse = "flatline" alarm window
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
function stateOf(v) {
  if (!v) return null;
  const due = v.lastPulse + v.interval * DAY;
  const release = due + GRACE_DAYS * DAY;
  const t = v.simNow;
  if (t < due) return "ALIVE";
  if (t < due + FLATLINE_DAYS * DAY) return "FLATLINE";
  if (t < release) return "GRACE";
  return "RELEASED";
}
const dueAt = (v) => v.lastPulse + v.interval * DAY;
const releaseAt = (v) => dueAt(v) + GRACE_DAYS * DAY;

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
function frame(now) {
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  if (vault) {
    const daysPerSec = demo ? speed : 1 / 86_400;
    vault.simNow += dt * daysPerSec * DAY / 1000;
    const st = stateOf(vault);
    if (st !== prevState) onTransition(prevState, st);
    prevState = st;
  }
  if (!$('[data-route="/"]').hidden) heroEcg(dt);
  if (!$('[data-route="/vitals"]').hidden && vault) { vitalsEcg(dt); renderVitals(); }
  requestAnimationFrame(frame);
}

setInterval(() => { if (vault) save(); }, 1500);

function onTransition(from, to) {
  if (!vault || !from) return;
  if (to === "FLATLINE") { log(`Pulse missed. Alerts sent via ${vault.channel}.`, "r"); toast(`Pulse missed. ${vault.channel} alarm sent.`); }
  if (to === "GRACE") { log(`Grace period open: ${GRACE_DAYS} days to respond.`, "r"); }
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

const SAMPLE = "ghost lantern velvet orbit marble thunder candle meadow riddle anchor willow spark";
$("#fillSample").addEventListener("click", () => { $("#secret").value = SAMPLE; $("#secret").focus(); });

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
  if (n === 1 && !$("#secret").value.trim()) return "Give the creature something to guard.";
  if (n === 2 && !$("#heirName").value.trim()) return "Name your heir.";
  if (n === 2) {
    const e = $("#heirEmail").value.trim();
    if (e && !/^\S+@\S+\.\S+$/.test(e)) return "That email looks wrong.";
  }
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
      log: [],
    };
    prevState = "ALIVE";
    log(`Creature assembled. Heir: ${vault.heirName}. Pulse every ${interval} days via ${channel}.`, "v");
    log("Key split 2-of-3: A → heir, B → owner, C → chain clock.");
    save();
    $("#secret").value = "";
    showStep(4);
  } catch (e) {
    console.error(e);
    toast("The switch failed. Is this browser too old for WebCrypto?");
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
  FLATLINE: "Pulse missed.",
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
  $("#hudDue").textContent = st === "ALIVE" ? `in ${fmtDur(dueAt(vault) - now)}` : st === "RELEASED" ? "—" : fmtDur(dueAt(vault) - now);
  $("#hudSince").textContent = fmtDur(now - vault.lastPulse).replace(" ago", "");
  $("#hudChannel").textContent = vault.channel;

  // lifecycle track: 0 = last pulse, 1 = release deadline
  const span = releaseAt(vault) - vault.lastPulse;
  const p = Math.min(1, Math.max(0, (now - vault.lastPulse) / span));
  const dueP = (vault.interval * DAY) / span;
  $("#trackFill").style.width = `${Math.min(p, dueP) * 100}%`;
  $("#trackGrace").style.left = `${dueP * 100}%`;
  $("#trackGrace").style.width = `${Math.max(0, p - dueP) * 100}%`;
  $("#trackCursor").style.left = `calc(${p * 100}% - 1px)`;

  if (st !== lastVitalsState || force) {
    lastVitalsState = st;
    $("#vHeadline").textContent = HEADLINES[st];
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
      FLATLINE: "You missed a pulse. Tap now and nothing happens to your vault.",
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

$("#pulseBtn").addEventListener("click", () => {
  if (!vault || stateOf(vault) === "RELEASED") return;
  const was = stateOf(vault);
  vault.lastPulse = vault.simNow;
  if (was === "ALIVE") log("Pulse received. Timer reset.", "v");
  prevState = was; // transition handler logs revival
  if (navigator.vibrate) navigator.vibrate(30);
  toast("Pulse received. Still alive.");
  save();
});

$$("[data-speed]").forEach((b) => b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))));
$$("[data-jump]").forEach((b) =>
  b.addEventListener("click", () => {
    if (!vault) return;
    if (b.dataset.jump === "grace") vault.simNow = Math.max(vault.simNow, dueAt(vault) + FLATLINE_DAYS * DAY + 1000);
    if (b.dataset.jump === "release") vault.simNow = Math.max(vault.simNow, releaseAt(vault) + 1000);
  })
);
$("#resetVault").addEventListener("click", () => {
  if (!vault) return;
  vault = null; forged = null; prevState = null; lastVitalsState = null;
  save();
  $("#stitchStage").classList.remove("live");
  $$(".shard code").forEach((c) => (c.textContent = "—"));
  showStep(1);
  renderVitals(true);
  toast("Creature destroyed. Nothing was kept.");
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
    ? "No vault here. Assemble one on the operating table first."
    : released
    ? vault.shards.c
    : `Locked by the chain clock. Opens in ${fmtDur(releaseAt(vault) - vault.simNow)} if no pulse arrives.`;
  $("#claimError").textContent = "";
}

$("#pasteDemoShard").addEventListener("click", () => {
  if (!vault) return toast("No vault yet. Assemble one first.");
  $("#shardInput").value = vault.shards.a;
});

$("#claimBtn").addEventListener("click", async () => {
  const errEl = $("#claimError");
  errEl.textContent = "";
  try {
    if (!vault) throw new Error("No vault on this device.");
    if (stateOf(vault) !== "RELEASED") throw new Error("Shard C is still locked. The owner may still be alive.");
    const a = decodeShare($("#shardInput").value);
    const c = decodeShare(vault.shards.c);
    if (a.x === c.x) throw new Error("You need two different shards.");
    const keyBytes = combine([a, c]);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    let pt;
    try {
      pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(vault.iv) }, key, fromHex(vault.ct));
    } catch {
      throw new Error("The parts don't fit. That shard belongs to another vault.");
    }
    lightning();
    $("#tomb").classList.add("risen");
    setTimeout(() => $("#tomb").classList.remove("risen"), 600);
    $("#revealText").textContent = new TextDecoder().decode(pt);
    $("#reveal").hidden = false;
    $("#reveal").scrollIntoView({ behavior: "smooth", block: "center" });
    log(`${vault.heirName} rebuilt the key from shards A + C.`, "e");
  } catch (e) {
    errEl.textContent = e.message;
    $("#reveal").hidden = true;
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
