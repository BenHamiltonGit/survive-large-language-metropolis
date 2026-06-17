import { createClient } from "@supabase/supabase-js";
import "./styles.css";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLIC_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY);
const supabase = supabaseReady ? createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY) : null;
const LOCAL_AI_ONLY = import.meta.env.DEV || import.meta.env.VITE_USE_LOCAL_AI_ONLY === "true";
const GUESS_SECONDS = 30;
const REVEAL_GUESS_STAGGER = 2;
const REVEAL_TRUTH_HOLD = 5;
const REVEAL_SEAT_GAP = 1;
const REVEAL_FINAL_HOLD = 8;

const COLORS = ["#6ee7b7", "#f7c948", "#8bd3ff", "#fca5a5", "#c4b5fd", "#fdba74", "#a7f3d0", "#f0abfc"];
const COLOR_NAMES = ["Mint", "Gold", "Sky", "Red", "Violet", "Orange", "Teal", "Pink"];
const PALETTE = COLORS.map((color, index) => ({ color, name: COLOR_NAMES[index], icon: COLOR_NAMES[index][0] }));
const FILLER = [
  "that tracks",
  "wait, maybe",
  "noted",
  "i have a weird read",
  "same energy as before",
  "tiny clue there",
  "i do not buy it",
  "this is too clean",
  "interesting timing",
  "say less",
  "hmm",
];

const local = {
  participantId: localStorage.getItem("llm-metropolis-participant-id") || "",
};

const state = {
  phase: "connect",
  room: null,
  participant: null,
  participants: [],
  game: null,
  seats: [],
  messages: [],
  guesses: [],
  guessDrafts: {},
  drafts: { public: "", direct: {} },
  selectedDmSeatId: "",
  countdown: 0,
  tickTimer: null,
  realtimeChannel: null,
  aiSendLocks: new Set(),
  aiDelayCache: new Map(),
  aiLockScope: "",
  isStartingGame: false,
  isAutoSubmittingGuesses: false,
  guessFormError: "",
  lobbyNotice: "",
  inviteCode: "",
  inviteRoom: null,
  inviteError: "",
  windowMeta: {},
  nextWindowZ: 10,
  draggingWindow: null,
  isLeavingRoom: false,
  hasLoadedMessages: false,
  knownMessageIds: new Set(),
  lastPlayingRoundKey: "",
  hasSeenPlayingRound: false,
  toast: null,
  toastTimer: null,
  audioReady: false,
  audioContext: null,
  skipRestoreKeys: new Set(),
};

const app = document.getElementById("app");

function markAudioReady() {
  state.audioReady = true;
}

function audioContext() {
  if (!state.audioReady) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!state.audioContext) state.audioContext = new AudioContextClass();
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

function playToneSequence(notes) {
  const context = audioContext();
  if (!context) return;
  const start = context.currentTime + 0.01;
  notes.forEach((note, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = start + index * note.gap;
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(note.volume, noteStart + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + note.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + note.duration + 0.02);
  });
}

function playPublicMessageSound() {
  playToneSequence([{ frequency: 740, duration: 0.08, gap: 0.1, volume: 0.035 }]);
}

function playDirectMessageSound() {
  playToneSequence([
    { frequency: 660, duration: 0.07, gap: 0.09, volume: 0.035 },
    { frequency: 830, duration: 0.07, gap: 0.09, volume: 0.035 },
    { frequency: 990, duration: 0.09, gap: 0.09, volume: 0.032 },
  ]);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  state.toast = { message, id: Date.now() };
  render();
  state.toastTimer = setTimeout(() => {
    state.toast = null;
    render();
  }, 1800);
}

function html(strings, ...values) {
  return strings.map((string, index) => string + (values[index] ?? "")).join("");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function sanitizeStoredText(value = "", maxLength = 1000) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, "[phone]")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[url]")
    .replace(/\b(?:sk|sbp|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{12,}\b/g, "[secret]")
    .replace(/\b(api[_-]?key|password|passwd|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function nowPlus(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function secondsUntil(value) {
  if (!value) return 0;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000));
}

function stableRandom(seed) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function stableShuffle(items, seed) {
  return [...items].sort((left, right) => stableRandom(`${seed}:${left.id}`) - stableRandom(`${seed}:${right.id}`));
}

function aiDelaySeconds(kind, seed) {
  if (!state.aiDelayCache.has(seed)) {
    const roundSeconds = settings().roundSeconds;
    const earliest = Math.min(Math.max(4, Math.floor(roundSeconds * 0.16)), 10);
    const latest = Math.max(earliest + 1, roundSeconds - Math.min(8, Math.floor(roundSeconds * 0.18)));
    const band = kind === "public" ? [0.15, 0.45] : [0.35, 0.88];
    const offset = band[0] + Math.random() * (band[1] - band[0]);
    const delay = Math.min(latest, Math.max(earliest, Math.round(earliest + (latest - earliest) * offset)));
    state.aiDelayCache.set(seed, delay);
  }
  return state.aiDelayCache.get(seed);
}

function reactionDelaySeconds(seed, min = 4, max = 12) {
  if (!state.aiDelayCache.has(seed)) {
    const spread = Math.max(1, max - min);
    state.aiDelayCache.set(seed, Math.round(min + spread * stableRandom(seed)));
  }
  return state.aiDelayCache.get(seed);
}

function aiStaggerSeconds(seed, aiSeat, max = 8) {
  return Math.round(stableRandom(`${seed}:${aiSeat.id}:stagger`) * max);
}

function isHost() {
  return Boolean(state.participant?.is_host);
}

function settings() {
  return {
    aiCount: 2,
    roundCount: 3,
    roundSeconds: 60,
    charLimit: 160,
    ...(state.room?.settings || {}),
  };
}

function mySeat() {
  return state.seats.find((seat) => seat.participant_id === state.participant?.id);
}

function seatById(id) {
  return state.seats.find((seat) => seat.id === id);
}

function participantById(id) {
  return state.participants.find((participant) => participant.id === id);
}

function currentRoundMessages() {
  return state.messages.filter((message) => message.round_number === state.game?.round_number);
}

function secondsSinceMessage(message) {
  return Math.max(0, (Date.now() - new Date(message.created_at).getTime()) / 1000);
}

function messageTime(message) {
  return new Date(message.created_at).getTime();
}

function bodyMentionsSeat(body, seat) {
  const text = String(body || "").toLowerCase();
  const alias = String(seat.alias || "").toLowerCase();
  const compactAlias = alias.replace(/\s+/g, "");
  const compactText = text.replace(/\s+/g, "");
  return Boolean(alias && (text.includes(alias) || compactText.includes(compactAlias)));
}

function seatName(id) {
  return seatById(id)?.alias || "Unknown";
}

function copyLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("room", state.room.code);
  copyText(url.toString(), "Invite link copied.");
}

function copyRoomCode() {
  copyText(state.room.code, "Room code copied.");
}

function copyText(value, message) {
  navigator.clipboard?.writeText(value);
  state.lobbyNotice = message;
  render();
}

function lobbySummary() {
  const s = settings();
  const humanCount = state.participants.length;
  const totalSeats = humanCount + s.aiCount;
  const canStart = humanCount >= 2 && !state.isStartingGame;
  const startReason = humanCount < 2 ? "Waiting for at least 2 human players." : "Ready to start.";
  return { ...s, humanCount, totalSeats, canStart, startReason };
}

function defaultWindowMeta(id) {
  const dmIndex = id.startsWith("dm-") ? Math.max(0, state.seats.findIndex((seat) => `dm-${seat.id}` === id)) : 0;
  const defaults = {
    monitor: { x: 14, y: 14, w: 280, z: 3 },
    labels: { x: 14, y: 410, w: 280, z: 4 },
    public: { x: 310, y: 14, w: 570, z: 5 },
    identities: { x: 900, y: 14, w: 360, z: 3 },
  };
  return defaults[id] || { x: 900 + (dmIndex % 2) * 22, y: 290 + dmIndex * 36, w: 360, z: 7 + dmIndex };
}

function getWindowMeta(id) {
  if (!state.windowMeta[id]) state.windowMeta[id] = { ...defaultWindowMeta(id), minimized: false, closed: false };
  return state.windowMeta[id];
}

function focusWindow(id) {
  const meta = getWindowMeta(id);
  state.nextWindowZ += 1;
  meta.z = state.nextWindowZ;
}

function windowStyle(id) {
  const meta = getWindowMeta(id);
  return `left:${meta.x}px;top:${meta.y}px;width:${meta.w}px;z-index:${meta.z};`;
}

function desktopWindow(id, title, body, className = "") {
  const meta = getWindowMeta(id);
  if (meta.closed || meta.minimized) return "";
  return `
    <section class="window desktop-window ${className}" data-window-id="${id}" style="${windowStyle(id)}">
      <div class="window-titlebar" data-window-id="${id}">
        <span>${escapeHtml(title)}</span>
        <span class="window-controls">
          <button type="button" title="Minimize" data-window-action="minimize" data-window-id="${id}">_</button>
          <button type="button" title="Close" data-window-action="close" data-window-id="${id}">X</button>
        </span>
      </div>
      ${body}
    </section>
  `;
}

function taskbarWindows() {
  return Object.entries(state.windowMeta)
    .filter(([, meta]) => meta.minimized || meta.closed)
    .map(([id]) => `<button type="button" class="taskbar-button" data-window-action="restore" data-window-id="${id}">${escapeHtml(windowTitle(id))}</button>`)
    .join("");
}

function windowTitle(id) {
  if (id === "monitor") return "PLAYER_MONITOR.SYS";
  if (id === "identities") return "IDENTITIES.DIR";
  if (id === "public") return "PUBLIC_BOARD.EXE";
  if (id === "labels") return "LABEL_NOTES.EXE";
  if (id.startsWith("dm-")) return `${seatById(id.slice(3))?.alias || "DM"}.dm`;
  return id;
}

function activeStatus() {
  if (state.room?.status === "results" || state.game?.status === "results") return "results";
  if (state.game?.status === "playing") return "playing";
  if (state.room?.status === "guessing" || state.game?.status === "guessing") return "guessing";
  return state.room?.status || state.phase;
}

function topbar() {
  const phase = activeStatus();
  const gameLabel = state.room ? `Room ${state.room.code}` : "No room";
  let timer = "--";
  if (phase === "playing") timer = `Round ${state.game.round_number}/${settings().roundCount} - ${state.countdown}s`;
  if (phase === "guessing") timer = `Guesses close in ${state.countdown}s`;
  if (phase === "results") timer = `Next game ${state.countdown}s`;
  if (phase === "playing" || phase === "guessing") {
    const hudTitle = phase === "guessing" ? "GUESS_TIMER.EXE" : "GAME_TIMER.EXE";
    const timerText = `${state.countdown}s`;
    const roundText =
      phase === "guessing"
        ? "Final labels"
        : `Round ${state.game.round_number}/${settings().roundCount}`;
    return html`
      <section class="game-hud window">
        <div class="window-titlebar topbar-titlebar">
          <span>${hudTitle}</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="game-hud-main">
          <div>
            <span class="pill" id="phasePill">${escapeHtml(phase)}</span>
            <span class="pill muted" id="roomPill">${escapeHtml(gameLabel)}</span>
            <span class="pill muted" id="roundPill">${escapeHtml(roundText)}</span>
          </div>
          <strong class="big-timer" id="timerPill">${escapeHtml(timerText)}</strong>
        </div>
      </section>
    `;
  }
  return html`
    <section class="topbar window">
      <div class="window-titlebar topbar-titlebar">
        <span>SLLM_OS.EXE</span>
        <span class="window-controls">_ [] X</span>
      </div>
      <div class="topbar-main">
        <div>
          <p class="eyebrow">Survive Large Language Metropolis</p>
          <h1>Survive Large Language Metropolis</h1>
        </div>
        <div class="status-strip">
          <span class="pill" id="phasePill">${escapeHtml(phase)}</span>
          <span class="pill muted" id="timerPill">${escapeHtml(timer)}</span>
          <span class="pill muted" id="roomPill">${escapeHtml(gameLabel)}</span>
        </div>
      </div>
    </section>
  `;
}

function captureFocusInfo() {
  const el = document.activeElement;
  if (
    !el ||
    !app.contains(el) ||
    !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
  ) {
    return null;
  }
  return {
    formId: el.closest("form")?.id || "",
    name: el.name || "",
    id: el.id || "",
    selectionStart: el.selectionStart,
    selectionEnd: el.selectionEnd,
    scrollTop: el.scrollTop,
  };
}

function restoreFocusInfo(info) {
  if (!info) return;
  let el = null;
  if (info.formId && info.name) {
    el = document.getElementById(info.formId)?.querySelector(`[name="${info.name}"]`) || null;
  } else if (info.id) {
    el = document.getElementById(info.id);
  }
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollTop = info.scrollTop;
  if (typeof info.selectionStart === "number" && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    try {
      el.setSelectionRange(info.selectionStart, info.selectionEnd);
    } catch {
      // selection range not supported for this input type; ignore
    }
  }
}

function captureScrollPositions() {
  const positions = {};
  document.querySelectorAll("[data-scroll-id]").forEach((el) => {
    positions[el.dataset.scrollId] = el.scrollTop;
  });
  return positions;
}

function restoreScrollPositions(positions) {
  if (!positions) return;
  document.querySelectorAll("[data-scroll-id]").forEach((el) => {
    const top = positions[el.dataset.scrollId];
    if (typeof top === "number") el.scrollTop = top;
  });
}

function captureFormValues() {
  const values = {};
  document.querySelectorAll("[name]").forEach((el) => {
    const key = `${el.closest("form")?.id || "global"}:${el.name}`;
    values[key] = el.value;
  });
  return values;
}

function restoreFormValues(values) {
  if (!values) return;
  document.querySelectorAll("[name]").forEach((el) => {
    const key = `${el.closest("form")?.id || "global"}:${el.name}`;
    if (state.skipRestoreKeys.has(key)) return;
    if (Object.prototype.hasOwnProperty.call(values, key)) el.value = values[key];
  });
  state.skipRestoreKeys.clear();
}

function render() {
  const focusInfo = captureFocusInfo();
  const scrollPositions = captureScrollPositions();
  const formValues = captureFormValues();
  const phase = activeStatus();
  const view =
    state.phase === "connect"
      ? renderConnect()
      : state.phase === "invite"
        ? renderInviteJoin()
        : phase === "playing"
          ? renderGame()
          : phase === "results"
            ? renderResults()
            : phase === "guessing"
              ? renderGuessing()
              : renderLobby();

  app.innerHTML = html`<main class="app-shell">${topbar()}${view}${toastHtml()}</main>`;
  bindCommonEvents();
  restoreFormValues(formValues);
  restoreFocusInfo(focusInfo);
  restoreScrollPositions(scrollPositions);
}

function toastHtml() {
  if (!state.toast) return "";
  return `<div class="system-toast" role="status">${escapeHtml(state.toast.message)}</div>`;
}

function renderInviteJoin() {
  return html`
    <section class="connect-view invite-view">
      <div class="intro-copy window intro-window">
        <div class="window-titlebar">
          <span>INVITE_FOUND.URL</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body">
          <p class="eyebrow">Join room</p>
          <h2>Enter your name.</h2>
          <p>You were invited to room ${escapeHtml(state.inviteCode)}. Pick the name other players will see in the lobby.</p>
          <div class="room-code">${escapeHtml(state.inviteCode)}</div>
        </div>
      </div>
      <form class="panel window modal-window" id="inviteJoinForm">
        <div class="window-titlebar">
          <span>JOIN_ROOM.DLG</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body form-body">
          ${state.inviteError ? `<div class="notice">${escapeHtml(state.inviteError)}</div>` : ""}
          <label>
            Your name
            <input name="name" maxlength="32" placeholder="Name" required autofocus />
          </label>
          <div class="actions">
            <button class="primary" type="submit" ${state.inviteError ? "disabled" : ""}>Join room</button>
            <button class="secondary" id="cancelInviteJoin" type="button">Not now</button>
          </div>
        </div>
      </form>
    </section>
  `;
}

function renderConnect() {
  const roomParam = new URLSearchParams(window.location.search).get("room") || "";
  return html`
    <section class="connect-view">
      <div class="intro-copy window intro-window">
        <div class="window-titlebar">
          <span>ROOM_WIZARD.TXT</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body">
        <h2>Create a room, send the code, read the room.</h2>
        <p>
          Online rooms sync through Supabase Realtime. Each game anonymizes everyone,
          adds a chosen number of AI's, limits each message by character count, then scores only your own final guesses.
        </p>
        </div>
      </div>
      <form class="panel window" id="connectForm">
        <div class="window-titlebar">
          <span>CONNECT.DLG</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body form-body">
        ${!supabaseReady
          ? `<div class="notice">Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before running multiplayer.</div>`
          : ""}
        <label>
          Your name
          <input name="name" maxlength="32" placeholder="Name" required />
        </label>
        <label>
          Room code
          <input name="roomCode" maxlength="8" value="${escapeHtml(roomParam)}" placeholder="Leave blank to create" />
        </label>
        <div class="actions">
          <button class="primary" name="intent" value="create" ${!supabaseReady ? "disabled" : ""}>Create room</button>
          <button class="secondary" name="intent" value="join" ${!supabaseReady ? "disabled" : ""}>Join room</button>
        </div>
        </div>
      </form>
    </section>
  `;
}

function renderLobby() {
  const summary = lobbySummary();
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", state.room.code);
  return html`
    <section class="lobby-view">
      <div class="intro-copy window intro-window">
        <div class="window-titlebar">
          <span>INVITE_PANEL.INI</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body">
        <p class="eyebrow">Lobby</p>
        <h2>Send the room code.</h2>
        <p>
          Players join with the code or link. The host sets the number of AI's, round count,
          round length, and message character limit.
        </p>
        <div class="room-code">${escapeHtml(state.room.code)}</div>
        <div class="invite-box">
          <label>Invite link<input readonly value="${escapeHtml(inviteUrl.toString())}" /></label>
        </div>
        <div class="actions lobby-actions">
          <button id="copyCode" class="secondary">Copy room code</button>
          <button id="copyLink" class="secondary">Copy invite link</button>
        </div>
        ${state.lobbyNotice ? `<div class="notice compact">${escapeHtml(state.lobbyNotice)}</div>` : ""}
        </div>
      </div>
      <section class="panel window">
        <div class="window-titlebar">
          <span>ROOM_SETTINGS.EXE</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body form-body">
        <div class="lobby-stats">
          <div><span>Humans</span><strong>${summary.humanCount}</strong></div>
          <div><span>AI's</span><strong>${summary.aiCount}</strong></div>
          <div><span>Total identities</span><strong>${summary.totalSeats}</strong></div>
          <div><span>Rounds</span><strong>${summary.roundCount}</strong></div>
        </div>
        <div>
          <div class="section-title"><span>Players</span></div>
          <div class="player-list">
            ${state.participants
              .map(
                (participant) => `
                  <div class="player-row">
                    <strong>${escapeHtml(participant.display_name)}</strong>
                    <span>${participant.id === state.participant?.id ? "you" : ""}${participant.id === state.participant?.id && participant.is_host ? " / " : ""}${participant.is_host ? "host" : "joined"}</span>
                  </div>`,
              )
              .join("")}
          </div>
        </div>
        ${isHost()
          ? html`
              <form id="settingsForm" data-preserve-values>
                <div class="form-grid">
                  <label>Number of AI's<input name="aiCount" type="number" min="1" max="8" value="${summary.aiCount}" /></label>
                  <label>Rounds<input name="roundCount" type="number" min="1" max="8" value="${summary.roundCount}" /></label>
                  <label>Seconds per round<input name="roundSeconds" type="number" min="10" max="180" value="${summary.roundSeconds}" /></label>
                  <label>Character limit<input name="charLimit" type="number" min="40" max="280" value="${summary.charLimit}" /></label>
                </div>
                <div class="notice compact">${escapeHtml(summary.startReason)} Start also saves these settings.</div>
                <div class="actions" style="margin-top:16px">
                  <button class="secondary" type="submit">Save settings</button>
                  <button class="primary" id="startGame" type="button" ${summary.canStart ? "" : "disabled"}>${state.isStartingGame ? "Starting..." : "Start game"}</button>
                </div>
              </form>
            `
          : `<div class="notice">Waiting for the host to start.</div>`}
        </div>
      </section>
    </section>
  `;
}

function renderGame() {
  const seat = mySeat();
  const s = settings();
  const publicLeft = Math.max(0, 2 - messagesFromMe("public").length);
  const dmLeft = Math.max(0, 4 - messagesFromMe("direct").length);
  const identityStrip = topIdentityStrip(seat);
  const monitorBody = `
    <div class="window-body" data-scroll-id="monitor">
      <div class="panel-section">
        <div class="section-title"><span>You are</span></div>
        <div class="identity">${seat ? identityName(seat) : "No seat yet"}</div>
      </div>
      <div class="panel-section">
        <div class="section-title"><span>Allowances</span></div>
        <div class="allowances">
          <div class="allowance"><span>Public</span><strong>${publicLeft}</strong></div>
          <div class="allowance"><span>DMs</span><strong>${dmLeft}</strong></div>
          <div class="allowance"><span>Character limit</span><strong>${s.charLimit}</strong></div>
        </div>
      </div>
      <div class="panel-section">
        <div class="section-title"><span>Scoreboard</span></div>
        <div class="scoreboard">${scoreboardRows()}</div>
      </div>
    </div>
  `;
  const identitiesBody = `<div class="identity-rail window-body">${state.seats
    .filter((entry) => entry.id !== seat?.id)
    .map(
      (entry) => `
        <button class="identity identity-button" type="button" data-seat-id="${entry.id}">
          ${identityName(entry)}
          <div class="identity-meta">Click to DM</div>
        </button>`,
    )
    .join("")}</div>`;
  const publicBody = `
    <div class="message-list" data-scroll-id="board-public">${publicMessages()}</div>
    <form id="publicForm" class="composer">
      <textarea name="body" rows="2" maxlength="${s.charLimit}" placeholder="Public posts this round">${escapeHtml(state.drafts.public)}</textarea>
      <div class="composer-row">
        <span class="counter">${publicLeft} left / character limit ${s.charLimit}</span>
        <button type="submit" ${publicLeft <= 0 ? "disabled" : ""}>Post</button>
      </div>
    </form>
  `;
  return html`
    <section class="game-view">
      ${identityStrip}
      <div class="desktop-surface">
        ${desktopWindow("monitor", "PLAYER_MONITOR.SYS", monitorBody, "monitor-window")}
        ${desktopWindow("identities", "IDENTITIES.DIR", identitiesBody, "identities-window")}
        ${desktopWindow("public", "PUBLIC_BOARD.EXE", publicBody, "board-window")}
        ${dmWindows(dmLeft)}
        <div class="desktop-taskbar">${taskbarWindows()}</div>
      </div>
    </section>
  `;
}

function topIdentityStrip(myCurrentSeat) {
  return `
    <section class="identity-strip window">
      <div class="window-titlebar">
        <span>IDENTITY_BAR.EXE</span>
        <span class="window-controls">_ [] X</span>
      </div>
      <div class="identity-strip-body">
        ${state.seats
          .filter((entry) => entry.id !== myCurrentSeat?.id)
          .map(
            (entry) => `
              <article class="identity-strip-card">
                <button class="identity identity-button identity-strip-button" type="button" data-seat-id="${entry.id}" title="Open DM">
                  ${identityName(entry)}
                </button>
                ${labelDraftControls(entry)}
              </article>`,
          )
          .join("")}
      </div>
    </section>`;
}

function renderGuessing() {
  const submitted = state.guesses.some((guess) => guess.participant_id === state.participant?.id);
  return html`
    <section class="guess-view">
      <div class="guess-head window">
        <div class="window-titlebar">
          <span>FINAL_READ.EXE</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body header-window-body">
          <div>
          <p class="eyebrow">Final read</p>
          <h2>Label every identity</h2>
          </div>
          <div class="guess-status">
            <strong id="guessTimerPill">${state.countdown}s</strong>
            <span class="pill muted">${state.guesses.length}/${state.participants.length} submitted</span>
          </div>
        </div>
      </div>
      ${submitted
        ? `<div class="notice">Your guesses are in. Waiting for everyone else.</div>`
        : html`<form id="guessForm" class="guess-grid">
            ${state.seats
              .filter((seat) => seat.id !== mySeat()?.id)
              .map(guessCard)
              .join("")}
            <div class="guess-submit-row">
              <button class="primary guess-submit" type="submit">Submit guesses</button>
              ${state.guessFormError ? `<span class="guess-form-error">${escapeHtml(state.guessFormError)}</span>` : ""}
            </div>
          </form>`}
    </section>
  `;
}

function resultsTimeline() {
  const numSeats = Math.max(1, state.seats.length);
  const numGuessers = Math.max(1, state.participants.length);
  const perSeat = numGuessers * REVEAL_GUESS_STAGGER + REVEAL_TRUTH_HOLD + REVEAL_SEAT_GAP;
  const seatsDuration = numSeats * perSeat;
  return { perSeat, seatsDuration, numGuessers, numSeats, total: seatsDuration + REVEAL_FINAL_HOLD };
}

function guessEntryFor(participantId, seatId) {
  const submitted = state.guesses.find((guess) => guess.participant_id === participantId);
  return submitted?.guesses?.find((entry) => entry.seatId === seatId) || null;
}

function pointsForEntry(seat, entry) {
  if (!entry) return 0;
  let points = 0;
  if (entry.kind === seat.kind) points += 2;
  if (seat.kind === "human" && entry.participantId === seat.participant_id) points += 2;
  return points;
}

function seatTruthLabel(seat) {
  const swatch = (text) => `<span style="color:${seat.color};font-weight:800">${text}</span>`;
  return seat.kind === "human"
    ? `Human &mdash; ${swatch(escapeHtml(participantById(seat.participant_id)?.display_name || "Unknown"))}`
    : swatch(`AI impersonating ${escapeHtml(participantById(seat.mimic_participant_id)?.display_name || "Unknown")}`);
}

function guessLabel(entry) {
  if (!entry || !entry.kind || entry.kind === "unanswered") return "didn't lock in a guess";
  if (entry.kind === "ai") return "says <strong>AI</strong>";
  const bet = entry.participantId ? participantById(entry.participantId)?.display_name : null;
  return bet ? `says <strong>human</strong> &mdash; betting it's <strong>${coloredName(entry.participantId, bet)}</strong>` : "says <strong>human</strong>";
}

function seatHeaderName(seat, revealed) {
  if (!revealed) return identityName(seat);
  const label =
    seat.kind === "human"
      ? escapeHtml(participantById(seat.participant_id)?.display_name || "Unknown")
      : `AI impersonating ${escapeHtml(participantById(seat.mimic_participant_id)?.display_name || "Unknown")}`;
  return `<div class="identity-name"><span class="avatar" style="background:${seat.color}">${escapeHtml(seat.icon)}</span><span style="color:${seat.color};font-weight:800">${label}</span></div>`;
}

function seatRevealCard(seat, revealedCount, stage, isActive) {
  const lines = state.participants
    .map((participant, index) => {
      const visible = index < revealedCount;
      if (!visible) return `<div class="reveal-line pending"><span class="reveal-placeholder">&middot;&middot;&middot;</span></div>`;
      const entry = guessEntryFor(participant.id, seat.id);
      const points = stage === "truth" ? pointsForEntry(seat, entry) : null;
      const isNewest = isActive && stage === "cascade" && index === revealedCount - 1;
      return `
        <div class="reveal-line shown ${isNewest ? "just-in" : ""}">
          <span class="reveal-name">${coloredName(participant.id, participant.display_name)}</span>
          <span class="reveal-guess">${guessLabel(entry)}</span>
          ${points !== null ? `<span class="reveal-points ${points > 0 ? "earned" : "zero"}">+${points}</span>` : ""}
        </div>`;
    })
    .join("");

  return `
    <article class="reveal-stage window ${isActive ? "active" : "settled"}">
      <div class="window-titlebar">
        <span>${escapeHtml(seat.alias)}.LOG</span>
        <span class="window-controls">_ [] X</span>
      </div>
      <div class="window-body">
        <div class="reveal-stage-head">${seatHeaderName(seat, stage === "truth")}</div>
        <div class="reveal-lines">${lines}</div>
        ${stage === "truth" ? `<div class="reveal-truth-banner ${isActive ? "pop" : ""}">${seatTruthLabel(seat)}</div>` : ""}
      </div>
    </article>`;
}

function revealProgress() {
  const timeline = resultsTimeline();
  const elapsed = Math.min(timeline.total, Math.max(0, timeline.total - state.countdown));
  const seats = state.seats;
  if (seats.length === 0 || elapsed >= timeline.seatsDuration) {
    return { done: true, timeline, seats };
  }
  const seatIndex = Math.min(seats.length - 1, Math.floor(elapsed / timeline.perSeat));
  const withinSeat = elapsed - seatIndex * timeline.perSeat;
  const cascadeEnd = timeline.numGuessers * REVEAL_GUESS_STAGGER;
  const stage = withinSeat < cascadeEnd ? "cascade" : "truth";
  const revealedCount =
    stage === "cascade" ? Math.min(timeline.numGuessers, Math.floor(withinSeat / REVEAL_GUESS_STAGGER) + 1) : timeline.numGuessers;
  return { done: false, timeline, seats, seatIndex, stage, revealedCount };
}

function revealSignature() {
  if (state.room?.status !== "results" && state.game?.status !== "results") return "";
  const progress = revealProgress();
  if (progress.done) return "final";
  return `cascade:${progress.seatIndex}:${progress.stage}:${progress.revealedCount}`;
}

function renderResults() {
  const progress = revealProgress();
  if (progress.done) return renderFinalStandings();
  const { seats, seatIndex, stage, revealedCount, timeline } = progress;

  const cards = seats
    .slice(0, seatIndex + 1)
    .map((seat, index) => {
      if (index < seatIndex) return seatRevealCard(seat, timeline.numGuessers, "truth", false);
      return seatRevealCard(seat, revealedCount, stage, true);
    })
    .join("");

  return html`
    <section class="results-view reveal-view">
      <div class="results-head window">
        <div class="window-titlebar">
          <span>SCORE_REVEAL.LOG</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body header-window-body">
          <div>
            <p class="eyebrow">Identity ${seatIndex + 1} of ${seats.length}</p>
            <h2>Who was this?</h2>
          </div>
          <div class="countdown">Next identity soon</div>
        </div>
      </div>
      <div class="reveal-track" id="revealTrack" data-seat-index="${seatIndex}">${cards}</div>
    </section>
  `;
}

function renderFinalStandings() {
  const winnerPoints = Math.max(...state.participants.map((participant) => participant.last_points || 0), 0);
  const winners = state.participants.filter((participant) => participant.last_points === winnerPoints);
  return html`
    <section class="results-view">
      <div class="results-head window">
        <div class="window-titlebar">
          <span>SCORE_REVEAL.LOG</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body header-window-body">
          <div>
          <p class="eyebrow">Final standings</p>
          <h2>${winners.map((winner) => coloredName(winner.id, winner.display_name)).join(", ") || "No winner"} won</h2>
          </div>
          <div class="countdown" id="resultsCountdown">Next game in ${state.countdown}</div>
        </div>
      </div>
      <div class="results-grid">
        ${state.seats
          .map(
            (seat) =>
              `<article class="reveal-card window"><div class="window-titlebar"><span>${escapeHtml(seat.alias)}.ID</span><span class="window-controls">_ [] X</span></div><div class="window-body"><h3>${identityName(seat)}</h3><p>${seatTruthLabel(seat)}</p></div></article>`,
          )
          .join("")}
        <article class="reveal-card window"><div class="window-titlebar"><span>STANDINGS.TXT</span><span class="window-controls">_ [] X</span></div><div class="window-body"><h3>Table standings</h3>${scoreboardRows(true)}</div></article>
      </div>
    </section>
  `;
}

function identityName(seat) {
  return `<div class="identity-name"><span class="avatar" style="background:${seat.color}">${escapeHtml(seat.icon)}</span><span style="color:${seat.color};font-weight:800">${escapeHtml(seat.alias)}</span></div>`;
}

function participantColor(participantId) {
  const seat = state.seats.find((entry) => entry.kind === "human" && entry.participant_id === participantId);
  return seat?.color || null;
}

function coloredName(participantId, name) {
  const color = participantColor(participantId);
  const safeName = escapeHtml(name || "Unknown");
  return color ? `<span style="color:${color};font-weight:950;text-shadow:0 0 1px rgba(31,27,22,0.55)">${safeName}</span>` : safeName;
}

function scoreboardRows(showLast = false) {
  return state.participants
    .map(
      (participant) => `
        <div class="${showLast ? "result-row" : "score-row"}">
          <strong>${coloredName(participant.id, participant.display_name)}</strong>
          <span>${showLast ? `+${participant.last_points || 0} / ` : ""}${participant.total_points} pts / ${participant.wins} wins</span>
        </div>`,
    )
    .join("");
}

function messageHtml(message) {
  const from = seatById(message.from_seat_id);
  const to = message.to_seat_id ? seatById(message.to_seat_id) : null;
  const fromSpan = `<span style="color:${from?.color || "inherit"};font-weight:800">${escapeHtml(from?.alias || "Unknown")}</span>`;
  const label = to ? `${fromSpan} to ${escapeHtml(to.alias)}` : fromSpan;
  return `
    <article class="message" style="border-left-color:${from?.color || "#343945"}">
      <div class="message-head"><span>${label}</span><span>R${message.round_number}</span></div>
      <p>${escapeHtml(message.body)}</p>
    </article>`;
}

function publicMessages() {
  return state.messages.filter((message) => message.channel === "public").map(messageHtml).join("") || `<article class="message"><p>No public messages yet.</p></article>`;
}

function directMessagesFor(otherId) {
  const mine = mySeat();
  const messages = state.messages.filter(
    (message) =>
      message.channel === "direct" &&
      ((message.from_seat_id === mine?.id && message.to_seat_id === otherId) ||
        (message.from_seat_id === otherId && message.to_seat_id === mine?.id)),
  );
  return messages.map(messageHtml).join("") || `<article class="message"><p>No DMs in this thread.</p></article>`;
}

function dmPreviewLine(otherId) {
  const mine = mySeat();
  const messages = state.messages.filter(
    (message) =>
      message.channel === "direct" &&
      ((message.from_seat_id === mine?.id && message.to_seat_id === otherId) ||
        (message.from_seat_id === otherId && message.to_seat_id === mine?.id)),
  );
  const latest = messages[messages.length - 1];
  if (!latest) return `<p class="dm-preview-body">No messages yet &mdash; click to start a DM.</p>`;
  const from = seatById(latest.from_seat_id);
  const isMine = from?.id === mine?.id;
  const fromLabel = isMine
    ? "You"
    : `<span style="color:${from?.color || "inherit"};font-weight:800">${escapeHtml(from?.alias || "Unknown")}</span>`;
  return `
    <div class="dm-preview-meta"><span>${fromLabel}</span><span>R${latest.round_number}</span></div>
    <p class="dm-preview-body">${escapeHtml(latest.body)}</p>`;
}

function dmWindows(dmLeft) {
  const mine = mySeat();
  if (!mine) return "";
  const threadSeatIds = new Set(
    state.messages
      .filter((message) => message.channel === "direct" && (message.from_seat_id === mine.id || message.to_seat_id === mine.id))
      .map((message) => (message.from_seat_id === mine.id ? message.to_seat_id : message.from_seat_id)),
  );
  if (state.selectedDmSeatId) threadSeatIds.add(state.selectedDmSeatId);

  return [...threadSeatIds]
    .filter(Boolean)
    .map((seatId) => {
      const seat = seatById(seatId);
      if (!seat) return "";
      const isFocused = seatId === state.selectedDmSeatId;
      const body = isFocused
        ? `
          <div class="message-list" data-scroll-id="dm-${seat.id}">${directMessagesFor(seatId)}</div>
          <form id="dmForm" class="composer">
            <textarea name="body" rows="2" maxlength="${settings().charLimit}" placeholder="Message ${escapeHtml(seat.alias)}">${escapeHtml(state.drafts.direct[seat.id] || "")}</textarea>
            <div class="composer-row">
              <span class="counter">${dmLeft} DMs left</span>
              <button type="submit" ${dmLeft <= 0 ? "disabled" : ""}>Send</button>
            </div>
          </form>`
        : `<div class="dm-preview focus-dm" data-seat-id="${seat.id}">${dmPreviewLine(seatId)}</div>`;
      return desktopWindow(`dm-${seat.id}`, `${seat.alias}.dm`, body, `dm-window ${isFocused ? "focused" : "collapsed"}`);
    })
    .join("");
}

function messagesFromMe(channel) {
  const mine = mySeat();
  return state.messages.filter(
    (message) =>
      message.from_seat_id === mine?.id &&
      message.channel === channel &&
      message.round_number === state.game?.round_number,
  );
}

function guessCard(seat) {
  return `
    <article class="guess-card window">
      <div class="window-titlebar">
        <span>${escapeHtml(seat.alias)}.GUESS</span>
        <span class="window-controls">_ [] X</span>
      </div>
      <div class="window-body">
      ${labelDraftRow(seat)}
      </div>
    </article>`;
}

function labelDraftRow(seat) {
  return `
    <div class="label-draft-row">
      ${identityName(seat)}
      ${labelDraftControls(seat)}
    </div>`;
}

function labelDraftControls(seat) {
  const draft = state.guessDrafts[seat.id] || {};
  const humanOptions = [`<option value="">No human match</option>`]
    .concat(
      state.participants
        .filter((participant) => participant.id !== state.participant?.id)
        .map(
          (participant) =>
            `<option value="${participant.id}" ${participant.id === draft.participantId ? "selected" : ""}>${escapeHtml(participant.display_name)}</option>`,
        ),
    )
    .join("");
  return `
    <div class="guess-fields">
        <div class="guess-type-buttons" role="group" aria-label="Choose identity type for ${escapeHtml(seat.alias)}">
          <button class="guess-type-button ${draft.kind === "human" ? "selected" : ""}" type="button" data-seat-id="${seat.id}" data-kind="human">Human</button>
          <button class="guess-type-button ${draft.kind === "ai" ? "selected" : ""}" type="button" data-seat-id="${seat.id}" data-kind="ai">AI</button>
        </div>
        ${
          draft.kind === "human"
            ? `<label>Bonus human match<select class="guess-human-select" name="${seat.id}-human" data-seat-id="${seat.id}">${humanOptions}</select></label>`
            : `<input type="hidden" name="${seat.id}-human" value="" />`
        }
    </div>`;
}

function bindCommonEvents() {
  document.getElementById("connectForm")?.addEventListener("submit", onConnect);
  document.getElementById("inviteJoinForm")?.addEventListener("submit", onInviteJoin);
  document.getElementById("cancelInviteJoin")?.addEventListener("click", cancelInviteJoin);
  document.getElementById("settingsForm")?.addEventListener("submit", onSaveSettings);
  document.getElementById("startGame")?.addEventListener("click", startGame);
  document.getElementById("copyLink")?.addEventListener("click", copyLink);
  document.getElementById("copyCode")?.addEventListener("click", copyRoomCode);
  document.getElementById("publicForm")?.addEventListener("submit", onPublicMessage);
  document.getElementById("dmForm")?.addEventListener("submit", onDirectMessage);
  document.querySelectorAll(".composer textarea").forEach((textarea) => {
    textarea.addEventListener("keydown", onComposerKeydown);
    textarea.addEventListener("input", onComposerInput);
  });
  document.querySelectorAll(".identity-button").forEach((button) => {
    button.addEventListener("click", () => openDmWindow(button.dataset.seatId || ""));
  });
  document.querySelectorAll(".focus-dm").forEach((button) => {
    button.addEventListener("click", () => openDmWindow(button.dataset.seatId || ""));
  });
  document.querySelectorAll("[data-window-action]").forEach((button) => {
    button.addEventListener("click", onWindowAction);
  });
  document.querySelectorAll(".guess-type-button").forEach((button) => {
    button.addEventListener("click", onGuessTypeClick);
  });
  document.querySelectorAll(".guess-human-select").forEach((select) => {
    select.addEventListener("change", onGuessHumanChange);
  });
  document.querySelectorAll(".desktop-window .window-titlebar").forEach((titlebar) => {
    titlebar.addEventListener("pointerdown", onWindowDragStart);
  });
  document.getElementById("guessForm")?.addEventListener("submit", onSubmitGuesses);
  const revealTrack = document.getElementById("revealTrack");
  if (revealTrack) {
    const seatIndex = Number(revealTrack.dataset.seatIndex || 0);
    if (seatIndex !== lastRevealTrackSeatIndex) {
      lastRevealTrackSeatIndex = seatIndex;
      revealTrack.scrollLeft = revealTrack.scrollWidth;
    }
  } else {
    lastRevealTrackSeatIndex = -1;
  }
}

function openDmWindow(seatId) {
  if (!seatId) return;
  state.selectedDmSeatId = seatId;
  const meta = getWindowMeta(`dm-${seatId}`);
  meta.closed = false;
  meta.minimized = false;
  focusWindow(`dm-${seatId}`);
  render();
}

function onGuessTypeClick(event) {
  const seatId = event.currentTarget.dataset.seatId;
  const kind = event.currentTarget.dataset.kind;
  state.guessDrafts[seatId] = {
    ...(state.guessDrafts[seatId] || {}),
    kind,
    participantId: kind === "human" ? state.guessDrafts[seatId]?.participantId || "" : null,
  };
  state.guessFormError = "";
  render();
}

function onGuessHumanChange(event) {
  const seatId = event.currentTarget.dataset.seatId;
  state.guessDrafts[seatId] = {
    ...(state.guessDrafts[seatId] || {}),
    kind: "human",
    participantId: event.currentTarget.value || "",
  };
}

function onComposerKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  event.currentTarget.closest("form")?.requestSubmit();
}

function onComposerInput(event) {
  const formId = event.currentTarget.closest("form")?.id;
  if (formId === "publicForm") state.drafts.public = event.currentTarget.value;
  if (formId === "dmForm" && state.selectedDmSeatId) state.drafts.direct[state.selectedDmSeatId] = event.currentTarget.value;
}

function onWindowAction(event) {
  const id = event.currentTarget.dataset.windowId;
  const action = event.currentTarget.dataset.windowAction;
  const meta = getWindowMeta(id);
  if (action === "minimize") meta.minimized = true;
  if (action === "close") meta.closed = true;
  if (action === "restore") {
    meta.closed = false;
    meta.minimized = false;
    focusWindow(id);
  }
  render();
}

function onWindowDragStart(event) {
  if (event.target.closest("button")) return;
  const id = event.currentTarget.dataset.windowId;
  const meta = getWindowMeta(id);
  focusWindow(id);
  state.draggingWindow = {
    id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: meta.x,
    originY: meta.y,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  window.addEventListener("pointermove", onWindowDragMove);
  window.addEventListener("pointerup", onWindowDragEnd, { once: true });
}

function onWindowDragMove(event) {
  const drag = state.draggingWindow;
  if (!drag) return;
  const meta = getWindowMeta(drag.id);
  const desktop = document.querySelector(".desktop-surface");
  const maxX = Math.max(0, (desktop?.clientWidth || 1200) - meta.w - 12);
  meta.x = Math.min(maxX, Math.max(0, drag.originX + event.clientX - drag.startX));
  meta.y = Math.max(0, drag.originY + event.clientY - drag.startY);
  const element = document.querySelector(`[data-window-id="${drag.id}"].desktop-window`);
  if (element) element.style.cssText = `${windowStyle(drag.id)}`;
}

function onWindowDragEnd() {
  window.removeEventListener("pointermove", onWindowDragMove);
  state.draggingWindow = null;
}

async function onInviteJoin(event) {
  event.preventDefault();
  if (state.inviteError) return;
  const form = new FormData(event.currentTarget);
  const displayName = String(form.get("name") || "").trim().slice(0, 32);
  if (!displayName) return;
  await joinRoom(state.inviteCode, displayName);
}

function cancelInviteJoin() {
  state.phase = "connect";
  state.inviteCode = "";
  state.inviteRoom = null;
  state.inviteError = "";
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
  render();
}

async function onConnect(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const form = new FormData(event.currentTarget);
  const displayName = String(form.get("name") || "").trim().slice(0, 32);
  const code = String(form.get("roomCode") || "").trim().toUpperCase();
  if (submitter?.value === "join" && code) {
    await joinRoom(code, displayName);
  } else {
    await createRoom(displayName);
  }
}

async function createRoom(displayName) {
  const code = randomCode();
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .insert({ code, settings: settings() })
    .select("*")
    .single();
  if (roomError) return alert(roomError.message);

  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .insert({ room_id: room.id, display_name: displayName, is_host: true })
    .select("*")
    .single();
  if (participantError) return alert(participantError.message);

  await supabase.from("rooms").update({ host_participant_id: participant.id }).eq("id", room.id);
  local.participantId = participant.id;
  localStorage.setItem("llm-metropolis-participant-id", participant.id);
  await loadRoom(code);
}

async function joinRoom(code, displayName) {
  const { data: room, error: roomError } = await supabase.from("rooms").select("*").eq("code", code).single();
  if (roomError) return alert("Room not found.");
  if (room.status !== "lobby") return alert("That room is already in progress.");
  const { data: participant, error: participantError } = await supabase
    .from("participants")
    .insert({ room_id: room.id, display_name: displayName, is_host: false })
    .select("*")
    .single();
  if (participantError) return alert(participantError.message);
  local.participantId = participant.id;
  localStorage.setItem("llm-metropolis-participant-id", participant.id);
  await loadRoom(code);
}

async function loadRoom(code) {
  const { data: room, error } = await supabase.from("rooms").select("*").eq("code", code).single();
  if (error) return alert(error.message);
  state.room = room;
  state.phase = "room";
  state.hasLoadedMessages = false;
  state.knownMessageIds = new Set();
  state.lastPlayingRoundKey = "";
  state.hasSeenPlayingRound = false;
  await refreshAll();
  subscribeRoom();
  startLocalTimer();
  const url = new URL(window.location.href);
  url.searchParams.set("room", room.code);
  window.history.replaceState({}, "", url);
}

async function refreshAll() {
  if (!state.room) return;
  const keepLabelSelectOpen =
    document.activeElement instanceof HTMLSelectElement && document.activeElement.classList.contains("guess-human-select");
  const previousMessageIds = new Set(state.knownMessageIds);
  const previousRoundKey = state.lastPlayingRoundKey;
  const [roomRes, participantsRes, gamesRes] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", state.room.id).single(),
    supabase.from("participants").select("*").eq("room_id", state.room.id).is("left_at", null).order("created_at"),
    supabase.from("games").select("*").eq("room_id", state.room.id).order("created_at", { ascending: false }).limit(1),
  ]);
  if (roomRes.data) state.room = roomRes.data;
  state.participants = participantsRes.data || [];
  state.participant = state.participants.find((participant) => participant.id === local.participantId) || null;
  state.game = gamesRes.data?.[0] || null;
  if (state.room?.status === "results" && state.game) state.game = { ...state.game, status: "results" };

  if (state.game) {
    const [seatsRes, messagesRes, guessesRes] = await Promise.all([
      supabase.from("seats").select("*").eq("game_id", state.game.id).order("created_at"),
      supabase.from("messages").select("*").eq("game_id", state.game.id).order("created_at"),
      supabase.from("guesses").select("*").eq("game_id", state.game.id),
    ]);
    state.seats = seatsRes.data || [];
    state.messages = messagesRes.data || [];
    state.guesses = guessesRes.data || [];
    handleRealtimeEffects(previousMessageIds, previousRoundKey);
  } else {
    state.seats = [];
    state.messages = [];
    state.guesses = [];
    state.knownMessageIds = new Set();
    state.lastPlayingRoundKey = "";
    state.hasSeenPlayingRound = false;
  }
  updateCountdown();
  if (keepLabelSelectOpen && activeStatus() === "playing") {
    updateTimerDisplay();
    await hostMaintenance();
    return;
  }
  render();
  await hostMaintenance();
}

function handleRealtimeEffects(previousMessageIds, previousRoundKey) {
  const mine = mySeat();
  const newMessages = state.messages.filter((message) => !previousMessageIds.has(message.id));
  const shouldNotify = state.hasLoadedMessages && Boolean(mine);
  state.knownMessageIds = new Set(state.messages.map((message) => message.id));
  state.hasLoadedMessages = true;

  if (shouldNotify && newMessages.length) {
    const incoming = newMessages.filter((message) => message.from_seat_id !== mine.id);
    const hasDirect = incoming.some(
      (message) => message.channel === "direct" && (message.to_seat_id === mine.id || message.from_seat_id === mine.id),
    );
    const hasPublic = incoming.some((message) => message.channel === "public");
    if (hasDirect) playDirectMessageSound();
    else if (hasPublic) playPublicMessageSound();
  }

  const roundKey = state.game?.status === "playing" ? `${state.game.id}:${state.game.round_number}` : "";
  if (roundKey && state.hasSeenPlayingRound && roundKey !== previousRoundKey) {
    showToast("Message limits refreshed");
    playToneSequence([
      { frequency: 520, duration: 0.06, gap: 0.08, volume: 0.025 },
      { frequency: 700, duration: 0.08, gap: 0.08, volume: 0.025 },
    ]);
  }
  if (roundKey) {
    state.lastPlayingRoundKey = roundKey;
    state.hasSeenPlayingRound = true;
  }
}

function subscribeRoom() {
  if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
  state.realtimeChannel = supabase
    .channel(`room-${state.room.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${state.room.id}` }, refreshAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `room_id=eq.${state.room.id}` }, refreshAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `room_id=eq.${state.room.id}` }, refreshAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `room_id=eq.${state.room.id}` }, refreshAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "seats" }, refreshAll)
    .on("postgres_changes", { event: "*", schema: "public", table: "guesses" }, refreshAll)
    .subscribe();
}

let lastRevealSignature = "";
let lastRevealTrackSeatIndex = -1;

function startLocalTimer() {
  clearInterval(state.tickTimer);
  state.tickTimer = setInterval(async () => {
    updateCountdown();
    const phase = activeStatus();
    if (phase === "results") {
      const signature = revealSignature();
      if (signature !== lastRevealSignature) {
        lastRevealSignature = signature;
        render();
      }
      const countdownEl = document.getElementById("resultsCountdown");
      if (countdownEl) countdownEl.textContent = `Next game in ${state.countdown}`;
    } else {
      lastRevealSignature = "";
      updateTimerDisplay();
    }
    if (phase === "guessing" && state.countdown <= 0) {
      await autoSubmitGuesses();
    }
    await hostMaintenance();
  }, 1000);
}

function updateCountdown() {
  const phase = activeStatus();
  if (phase === "results") state.countdown = secondsUntil(state.room?.next_game_at);
  else if (phase === "playing") state.countdown = secondsUntil(state.game?.round_ends_at);
  else if (phase === "guessing") state.countdown = secondsUntil(state.game?.round_ends_at);
  else state.countdown = 0;
}

function updateTimerDisplay() {
  const phase = activeStatus();
  let timer = "--";
  if (phase === "playing") timer = `Round ${state.game.round_number}/${settings().roundCount} - ${state.countdown}s`;
  if (phase === "guessing") timer = `Guesses close in ${state.countdown}s`;
  if (phase === "results") timer = `Next game ${state.countdown}s`;
  const phasePill = document.getElementById("phasePill");
  const timerPill = document.getElementById("timerPill");
  const roomPill = document.getElementById("roomPill");
  const roundPill = document.getElementById("roundPill");
  const guessTimerPill = document.getElementById("guessTimerPill");
  if (phasePill) phasePill.textContent = phase;
  if (timerPill) timerPill.textContent = phase === "playing" || phase === "guessing" ? `${state.countdown}s` : timer;
  if (roomPill) roomPill.textContent = state.room ? `Room ${state.room.code}` : "No room";
  if (roundPill) {
    roundPill.textContent =
      phase === "guessing" ? "Final labels" : `Round ${state.game?.round_number || 0}/${settings().roundCount}`;
  }
  if (guessTimerPill) guessTimerPill.textContent = `${state.countdown}s`;
}

function leaveRoomRequestOptions(participantId, keepalive = false) {
  return {
    method: "POST",
    keepalive,
    headers: {
      apikey: SUPABASE_PUBLIC_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLIC_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ leaving_participant_id: participantId }),
  };
}

async function leaveCurrentRoom({ keepalive = false } = {}) {
  if (!supabaseReady || state.isLeavingRoom || !local.participantId) return;
  state.isLeavingRoom = true;
  const participantId = local.participantId;
  local.participantId = "";
  localStorage.removeItem("llm-metropolis-participant-id");

  if (keepalive) {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/leave_room`, leaveRoomRequestOptions(participantId, true)).catch(() => {});
    return;
  }

  const { error } = await supabase.rpc("leave_room", { leaving_participant_id: participantId });
  if (error) console.warn("Failed to leave room:", error.message);
}

async function onSaveSettings(event) {
  event.preventDefault();
  const nextSettings = settingsFromForm(event.currentTarget);
  const { error } = await supabase.from("rooms").update({ settings: nextSettings }).eq("id", state.room.id);
  if (error) {
    state.lobbyNotice = "";
    render();
    return alert(error.message);
  }
  state.room = { ...state.room, settings: nextSettings };
  state.lobbyNotice = "Settings saved.";
  render();
}

function settingsFromForm(formElement) {
  const form = new FormData(formElement);
  return {
    aiCount: clamp(form.get("aiCount"), 1, 8, 2),
    roundCount: clamp(form.get("roundCount"), 1, 8, 3),
    roundSeconds: clamp(form.get("roundSeconds"), 10, 180, 60),
    charLimit: clamp(form.get("charLimit"), 40, 280, 160),
  };
}

function clamp(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function startGame() {
  if (!isHost() || state.isStartingGame) return;
  if (state.participants.length < 2) return alert("You need at least 2 human players before starting.");
  state.isStartingGame = true;
  render();
  const settingsForm = document.getElementById("settingsForm");
  const s = settingsForm ? settingsFromForm(settingsForm) : settings();
  const { error: settingsError } = await supabase.from("rooms").update({ settings: s }).eq("id", state.room.id);
  if (settingsError) {
    state.isStartingGame = false;
    render();
    return alert(settingsError.message);
  }
  const nextGameNumber = (state.room.game_number || 0) + 1;
  const { data: game, error: gameError } = await supabase
    .from("games")
    .insert({
      room_id: state.room.id,
      game_number: nextGameNumber,
      status: "playing",
      round_number: 1,
      round_ends_at: nowPlus(s.roundSeconds),
    })
    .select("*")
    .single();
  if (gameError) {
    state.isStartingGame = false;
    render();
    return alert(gameError.message);
  }

  const seats = buildSeats(game.id, s.aiCount);
  const { error: seatsError } = await supabase.from("seats").insert(seats);
  if (seatsError) {
    state.isStartingGame = false;
    render();
    return alert(seatsError.message);
  }
  const { data: updatedRoom, error: roomUpdateError } = await supabase
    .from("rooms")
    .update({ status: "playing", game_number: nextGameNumber, next_game_at: null })
    .eq("id", state.room.id)
    .select("*")
    .single();
  if (roomUpdateError) {
    state.isStartingGame = false;
    render();
    return alert(roomUpdateError.message);
  }
  state.room = updatedRoom;
  state.game = game;
  state.isStartingGame = false;
  await refreshAll();
}

function buildSeats(gameId, aiCount) {
  const palette = shuffle(PALETTE);
  const targets = shuffle(state.participants);
  const humanSeats = state.participants.map((participant, index) => ({
    game_id: gameId,
    participant_id: participant.id,
    kind: "human",
    alias: palette[index % palette.length].name,
    icon: palette[index % palette.length].icon,
    color: palette[index % palette.length].color,
  }));
  const aiSeats = Array.from({ length: aiCount }, (_, index) => {
    const target = targets[index % targets.length];
    return {
      game_id: gameId,
      kind: "ai",
      mimic_participant_id: target.id,
      alias: palette[(humanSeats.length + index) % palette.length].name,
      icon: palette[(humanSeats.length + index) % palette.length].icon,
      color: palette[(humanSeats.length + index) % palette.length].color,
    };
  });
  return shuffle([...humanSeats, ...aiSeats]);
}

async function onPublicMessage(event) {
  event.preventDefault();
  const mine = mySeat();
  if (!mine || messagesFromMe("public").length >= 2) return;
  const body = String(new FormData(event.currentTarget).get("body") || "").trim();
  const sent = await insertMessage(mine.id, "public", body);
  if (sent) {
    state.drafts.public = "";
    state.skipRestoreKeys.add("publicForm:body");
    event.currentTarget.reset();
  }
}

async function onDirectMessage(event) {
  event.preventDefault();
  const mine = mySeat();
  const toSeatId = state.selectedDmSeatId;
  if (messagesFromMe("direct").length >= 4) return;
  const body = String(new FormData(event.currentTarget).get("body") || "").trim();
  const sent = await insertMessage(mine.id, "direct", body, toSeatId);
  if (sent) {
    state.drafts.direct[toSeatId] = "";
    state.skipRestoreKeys.add("dmForm:body");
    event.currentTarget.reset();
  }
}

async function insertMessage(fromSeatId, channel, body, toSeatId = null) {
  const clean = body.slice(0, settings().charLimit);
  if (!clean) return false;
  const { data, error } = await supabase.from("messages").insert({
    room_id: state.room.id,
    game_id: state.game.id,
    round_number: state.game.round_number,
    from_seat_id: fromSeatId,
    to_seat_id: toSeatId,
    channel,
    body: clean,
  }).select("id").single();
  if (error) {
    alert(error.message);
    return false;
  }
  await savePlayerMemory(fromSeatId, data.id, clean);
  return true;
}

async function savePlayerMemory(fromSeatId, messageId, body) {
  const seat = seatById(fromSeatId);
  if (seat?.kind !== "human" || !seat.participant_id) return;
  const sanitized = sanitizeStoredText(body);
  if (!sanitized) return;
  await supabase.from("player_memories").upsert(
    {
      participant_id: seat.participant_id,
      message_id: messageId,
      body: sanitized,
    },
    { onConflict: "message_id", ignoreDuplicates: true },
  );
}

async function onSubmitGuesses(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const guessableSeats = state.seats.filter((seat) => seat.id !== mySeat()?.id);
  const missing = guessableSeats.find((seat) => !state.guessDrafts[seat.id]?.kind);
  if (missing) {
    state.guessFormError = `Choose Human or AI for ${missing.alias}.`;
    render();
    return;
  }
  state.guessFormError = "";
  await submitGuessPayload(buildGuessPayload(form, false));
  await refreshAll();
}

function buildGuessPayload(form, allowBlanks) {
  return state.seats.filter((seat) => seat.id !== mySeat()?.id).map((seat) => {
    const kind = state.guessDrafts[seat.id]?.kind;
    const finalKind = kind || (allowBlanks ? "unanswered" : "");
    return {
      seatId: seat.id,
      kind: finalKind,
      participantId:
        finalKind === "human" ? state.guessDrafts[seat.id]?.participantId || form?.get(`${seat.id}-human`) || null : null,
    };
  });
}

async function submitGuessPayload(guesses) {
  const { error } = await supabase.from("guesses").upsert({
    game_id: state.game.id,
    participant_id: state.participant.id,
    guesses,
  }, { onConflict: "game_id,participant_id" });
  if (error) alert(error.message);
  return !error;
}

async function autoSubmitGuesses() {
  if (state.isAutoSubmittingGuesses || !state.game || !state.participant) return;
  if (state.guesses.some((guess) => guess.participant_id === state.participant.id)) return;
  state.isAutoSubmittingGuesses = true;
  await submitGuessPayload(buildGuessPayload(null, true));
  state.isAutoSubmittingGuesses = false;
  await refreshAll();
}

async function hostMaintenance() {
  if (!isHost() || !state.room) return;
  const phase = activeStatus();
  if (phase === "playing" && state.countdown <= 0) {
    if (state.game.round_number >= settings().roundCount) {
      await supabase.from("games").update({ status: "guessing", round_ends_at: nowPlus(GUESS_SECONDS) }).eq("id", state.game.id);
      await supabase.from("rooms").update({ status: "guessing" }).eq("id", state.room.id);
      return;
    }
    await supabase
      .from("games")
      .update({ round_number: state.game.round_number + 1, round_ends_at: nowPlus(settings().roundSeconds) })
      .eq("id", state.game.id);
    await refreshAll();
  }
  if (phase === "playing") {
    await runAiRoundMessages();
  }
  if (
    phase === "guessing" &&
    state.participants.length > 0 &&
    (state.countdown <= 0 || state.guesses.length >= state.participants.length)
  ) {
    await scoreGame();
  }
  if (phase === "results" && state.countdown <= 0) {
    await startGame();
  }
}

async function scoreGame() {
  const updates = [];
  let high = 0;
  for (const participant of state.participants) {
    const submitted = state.guesses.find((guess) => guess.participant_id === participant.id);
    let points = 0;
    for (const guess of submitted?.guesses || []) {
      const seat = seatById(guess.seatId);
      if (!seat) continue;
      if (guess.kind === seat.kind) points += 2;
      if (seat.kind === "human" && guess.participantId === seat.participant_id) points += 2;
    }
    high = Math.max(high, points);
    updates.push({ participant, points });
  }

  for (const entry of updates) {
    await supabase
      .from("participants")
      .update({
        last_points: entry.points,
        total_points: entry.participant.total_points + entry.points,
        wins: entry.participant.wins + (entry.points === high ? 1 : 0),
      })
      .eq("id", entry.participant.id);
    await supabase.from("guesses").update({ points: entry.points }).eq("game_id", state.game.id).eq("participant_id", entry.participant.id);
  }
  const nextGameAt = nowPlus(resultsTimeline().total);
  await supabase.from("games").update({ status: "results" }).eq("id", state.game.id);
  await supabase.from("rooms").update({ status: "results", next_game_at: nextGameAt }).eq("id", state.room.id);
  state.game = { ...state.game, status: "results" };
  state.room = { ...state.room, status: "results", next_game_at: nextGameAt };
  updateCountdown();
  render();
}

async function runReactiveAiMessages(aiSeats, lockScope) {
  const messages = currentRoundMessages();
  const directIncoming = messages
    .filter((message) => message.channel === "direct")
    .sort((left, right) => messageTime(left) - messageTime(right));
  const publicIncoming = messages
    .filter((message) => message.channel === "public")
    .sort((left, right) => messageTime(left) - messageTime(right));

  for (const aiSeat of aiSeats) {
    if (!(await hasMimicSamples(aiSeat))) continue;
    const aiMessages = messages.filter((message) => message.from_seat_id === aiSeat.id);

    for (const incoming of directIncoming.filter((message) => message.to_seat_id === aiSeat.id && message.from_seat_id !== aiSeat.id)) {
      const directKey = `${lockScope}:${aiSeat.id}:react-direct:${incoming.id}`;
      const alreadyReplied = aiMessages.some(
        (message) =>
          message.channel === "direct" &&
          message.to_seat_id === incoming.from_seat_id &&
          messageTime(message) > messageTime(incoming),
      );
      const directCount = aiMessages.filter((message) => message.channel === "direct").length;
      const incomingSeat = seatById(incoming.from_seat_id);
      const delay =
        reactionDelaySeconds(`${directKey}:delay`, incomingSeat?.kind === "ai" ? 6 : 4, incomingSeat?.kind === "ai" ? 13 : 10) +
        aiStaggerSeconds(directKey, aiSeat, 7);
      if (!alreadyReplied && directCount < 8 && secondsSinceMessage(incoming) >= delay && !state.aiSendLocks.has(directKey)) {
        state.aiSendLocks.add(directKey);
        const sent = await insertAiMessage(aiSeat, "direct", incoming.from_seat_id, incoming.id, "direct_reply");
        if (!sent) state.aiSendLocks.delete(directKey);
      }
    }

    for (const incoming of publicIncoming.filter((message) => message.from_seat_id !== aiSeat.id)) {
      const publicKey = `${lockScope}:${aiSeat.id}:react-public:${incoming.id}`;
      const mentioned = bodyMentionsSeat(incoming.body, aiSeat);
      const incomingSeat = seatById(incoming.from_seat_id);
      const responseChance = incomingSeat?.kind === "ai" ? 0.16 : 0.25;
      const shouldReply = mentioned || stableRandom(`${publicKey}:chance`) <= responseChance;
      if (!shouldReply) continue;

      const alreadyReplied = aiMessages.some(
        (message) => message.channel === "public" && messageTime(message) > messageTime(incoming),
      );
      const publicCount = aiMessages.filter((message) => message.channel === "public").length;
      const maxPublicMessages = mentioned ? 4 : 3;
      const delay =
        reactionDelaySeconds(`${publicKey}:delay`, mentioned ? 3 : incomingSeat?.kind === "ai" ? 8 : 6, mentioned ? 9 : 16) +
        aiStaggerSeconds(publicKey, aiSeat, mentioned ? 5 : 10);
      if (!alreadyReplied && publicCount < maxPublicMessages && secondsSinceMessage(incoming) >= delay && !state.aiSendLocks.has(publicKey)) {
        state.aiSendLocks.add(publicKey);
        const sent = await insertAiMessage(aiSeat, "public", null, incoming.id, "public_reply");
        if (!sent) state.aiSendLocks.delete(publicKey);
      }
    }
  }
}

async function runAiRoundMessages() {
  if (!isHost() || !state.game) return;
  const lockScope = `${state.game.id}:${state.game.round_number}`;
  if (state.aiLockScope !== lockScope) {
    state.aiSendLocks.clear();
    state.aiDelayCache.clear();
    state.aiLockScope = lockScope;
  }

  const elapsed = settings().roundSeconds - state.countdown;
  const aiSeats = state.seats.filter((seat) => seat.kind === "ai");
  await runReactiveAiMessages(aiSeats, lockScope);
  for (const aiSeat of aiSeats) {
    if (!(await hasMimicSamples(aiSeat))) continue;
    const publicKey = `${lockScope}:${aiSeat.id}:public`;
    const publicCount = state.messages.filter(
      (message) => message.from_seat_id === aiSeat.id && message.channel === "public" && message.round_number === state.game.round_number,
    ).length;
    const publicDelay = aiDelaySeconds("public", publicKey) + aiStaggerSeconds(publicKey, aiSeat, 10);
    if (publicCount === 0 && elapsed >= publicDelay && !state.aiSendLocks.has(publicKey)) {
      state.aiSendLocks.add(publicKey);
      const sent = await insertAiMessage(aiSeat, "public", null, null, "proactive_public");
      if (!sent) state.aiSendLocks.delete(publicKey);
    }

    const targets = stableShuffle(state.seats.filter((seat) => seat.kind === "human"), `${lockScope}:${aiSeat.id}:targets`).slice(0, 2);
    for (const [index, target] of targets.entries()) {
      const directKey = `${lockScope}:${aiSeat.id}:direct:${target.id}`;
      const alreadySent = state.messages.some(
        (message) =>
          message.from_seat_id === aiSeat.id &&
          message.to_seat_id === target.id &&
          message.channel === "direct" &&
          message.round_number === state.game.round_number,
      );
      const directDelay = aiDelaySeconds("direct", `${directKey}:${index}`) + aiStaggerSeconds(`${directKey}:${index}`, aiSeat, 12);
      if (!alreadySent && elapsed >= directDelay && !state.aiSendLocks.has(directKey)) {
        state.aiSendLocks.add(directKey);
        const sent = await insertAiMessage(aiSeat, "direct", target.id, null, "proactive_direct");
        if (!sent) state.aiSendLocks.delete(directKey);
      }
    }
  }
}

async function insertAiMessage(aiSeat, channel, toSeatId, triggerMessageId = null, replyMode = "proactive") {
  if (LOCAL_AI_ONLY) return insertLocalAiMessage(aiSeat, channel, toSeatId, triggerMessageId);

  const { data, error } = await supabase.functions.invoke("ai-turn", {
    body: {
      roomId: state.room.id,
      gameId: state.game.id,
      seatId: aiSeat.id,
      channel,
      toSeatId,
      triggerMessageId,
      replyMode,
    },
  });

  if (!error && data?.message) {
    await refreshAll();
    return true;
  }

  console.warn("Falling back to local AI mock:", error?.message || data?.error || "unknown edge function response");
  return insertLocalAiMessage(aiSeat, channel, toSeatId, triggerMessageId);
}

async function insertLocalAiMessage(aiSeat, channel, toSeatId, triggerMessageId = null) {
  const body = await generateAiText(aiSeat, triggerMessageId);
  if (!body) return false;
  await waitForTypingDelay(body);
  const fallback = await supabase.from("messages").insert({
    room_id: state.room.id,
    game_id: state.game.id,
    round_number: state.game.round_number,
    from_seat_id: aiSeat.id,
    to_seat_id: toSeatId,
    channel,
    body,
  });
  if (fallback.error) alert(fallback.error.message);
  return !fallback.error;
}

function typingDelayMs(body) {
  const length = String(body || "").length;
  const charsPerSecond = 7 + Math.random() * 6;
  const thinkingMs = 500 + Math.random() * 1400;
  const typoPauseMs = stableRandom(`${body}:typing-pause`) > 0.78 ? 700 + Math.random() * 1300 : 0;
  return Math.min(12000, Math.max(900, Math.round(thinkingMs + (length / charsPerSecond) * 1000 + typoPauseMs)));
}

function waitForTypingDelay(body) {
  return new Promise((resolve) => setTimeout(resolve, typingDelayMs(body)));
}

function currentMimicMessages(aiSeat) {
  const targetSeatIds = state.seats
    .filter((seat) => seat.participant_id === aiSeat.mimic_participant_id)
    .map((seat) => seat.id);
  return state.messages.filter((message) => targetSeatIds.includes(message.from_seat_id)).map((message) => message.body);
}

async function historicalMimicMessages(aiSeat, limit = 20) {
  const { data: historicalSeats } = await supabase
    .from("seats")
    .select("id")
    .eq("participant_id", aiSeat.mimic_participant_id)
    .eq("kind", "human")
    .limit(30);
  const historicalSeatIds = (historicalSeats || []).map((seat) => seat.id);
  let historicalMessages = [];
  if (historicalSeatIds.length) {
    const { data } = await supabase
      .from("messages")
      .select("body")
      .in("from_seat_id", historicalSeatIds)
      .order("created_at", { ascending: false })
      .limit(limit);
    historicalMessages = data || [];
  }
  return historicalMessages.map((row) => row.body);
}

async function hasMimicSamples(aiSeat) {
  if (currentMimicMessages(aiSeat).length > 0) return true;
  return (await historicalMimicMessages(aiSeat, 1)).length > 0;
}

async function generateAiText(aiSeat, triggerMessageId = null) {
  const currentSamples = currentMimicMessages(aiSeat);
  const historicalMessages = await historicalMimicMessages(aiSeat);
  const samples = [...currentSamples, ...historicalMessages];
  if (samples.length) {
    const trigger = state.messages.find((message) => message.id === triggerMessageId);
    const sample = samples[Math.floor(Math.random() * samples.length)];
    const source = trigger?.body || sample;
    const words = source.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
    const tail = FILLER[Math.floor(Math.random() * FILLER.length)];
    return `${words} - ${tail}`.slice(0, settings().charLimit);
  }
  return "";
}

async function boot() {
  if (supabaseReady) {
    const code = new URLSearchParams(window.location.search).get("room");
    if (code) {
      await bootInviteLink(code.toUpperCase());
      return;
    }
  }
  render();
}

async function bootInviteLink(code) {
  const { data: room, error } = await supabase.from("rooms").select("*").eq("code", code).single();
  state.inviteCode = code;
  if (error || !room) {
    state.phase = "invite";
    state.inviteError = "Room not found.";
    render();
    return;
  }

  if (local.participantId) {
    const { data: participant } = await supabase
      .from("participants")
      .select("id")
      .eq("id", local.participantId)
      .eq("room_id", room.id)
      .is("left_at", null)
      .maybeSingle();
    if (participant) {
      await loadRoom(code);
      return;
    }
  }

  state.inviteRoom = room;
  state.phase = "invite";
  state.inviteError = room.status === "lobby" ? "" : "That room is already in progress.";
  render();
}

window.render_game_to_text = () =>
  JSON.stringify({
    phase: state.room?.status || state.phase,
    room: state.room?.code || null,
    participant: state.participant?.display_name || null,
    game: state.game?.game_number || 0,
    round: state.game?.round_number || 0,
    countdown: state.countdown,
    seats: state.seats.map((seat) => ({ alias: seat.alias, kind: seat.kind })),
    messages: state.messages.length,
    guesses: state.guesses.length,
  });

window.advanceTime = async (ms) => {
  state.countdown = Math.max(0, state.countdown - Math.ceil(ms / 1000));
  render();
  await hostMaintenance();
};

window.addEventListener("pagehide", () => {
  leaveCurrentRoom({ keepalive: true });
});

window.addEventListener("pointerdown", markAudioReady, { once: true });
window.addEventListener("keydown", markAudioReady, { once: true });

boot();
