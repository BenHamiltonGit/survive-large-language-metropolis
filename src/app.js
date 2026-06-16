import { createClient } from "@supabase/supabase-js";
import "./styles.css";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLIC_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_PUBLIC_KEY);
const supabase = supabaseReady ? createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY) : null;

const BOT_NAMES = [
  "Clippy Prime",
  "Null Susan",
  "Captcha Kid",
  "Regex Romeo",
  "Cache Cowboy",
  "Syntax Violet",
  "Token Tony",
  "Vector Vera",
  "Model Mabel",
  "Latency Lou",
  "Cursor Jade",
  "Patch Nora",
];
const ICONS = ["AI", "DM", "404", "OK", "JS", "SQL", "TXT", "CPU", "RAM", "UX", "API", "CLI"];
const COLORS = ["#6ee7b7", "#f7c948", "#8bd3ff", "#fca5a5", "#c4b5fd", "#fdba74", "#a7f3d0", "#f0abfc"];
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
  selectedDmSeatId: "",
  countdown: 0,
  tickTimer: null,
  realtimeChannel: null,
};

const app = document.getElementById("app");

function html(strings, ...values) {
  return strings.map((string, index) => string + (values[index] ?? "")).join("");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
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

function seatName(id) {
  return seatById(id)?.alias || "Unknown";
}

function copyLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("room", state.room.code);
  navigator.clipboard?.writeText(url.toString());
}

function topbar() {
  const phase = state.room?.status || state.phase;
  const gameLabel = state.room ? `Room ${state.room.code}` : "No room";
  let timer = "--";
  if (state.game?.status === "playing") timer = `Round ${state.game.round_number}/${settings().roundCount} - ${state.countdown}s`;
  if (state.room?.status === "results") timer = `Next game ${state.countdown}s`;
  return html`
    <section class="topbar window">
      <div class="window-titlebar topbar-titlebar">
        <span>SLLM_OS.EXE</span>
        <span class="window-controls">_ [] X</span>
      </div>
      <div class="topbar-main">
        <div>
          <p class="eyebrow">Survive Large Language Metropolis</p>
          <h1>Bot or Not</h1>
        </div>
        <div class="status-strip">
          <span class="pill">${escapeHtml(phase)}</span>
          <span class="pill muted">${escapeHtml(timer)}</span>
          <span class="pill muted">${escapeHtml(gameLabel)}</span>
        </div>
      </div>
    </section>
  `;
}

function render() {
  const view =
    state.phase === "connect"
      ? renderConnect()
      : state.room?.status === "lobby"
        ? renderLobby()
        : state.room?.status === "guessing"
          ? renderGuessing()
          : state.room?.status === "results"
            ? renderResults()
            : renderGame();

  app.innerHTML = html`<main class="app-shell">${topbar()}${view}</main>`;
  bindCommonEvents();
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
          adds AI seats, limits each message by character count, then scores only your own final guesses.
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
          <input name="name" maxlength="32" value="Ben" required />
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
  const s = settings();
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
          Players join with the code or link. The host sets AI seats, round count,
          round length, and message character limit.
        </p>
        <div class="room-code">${escapeHtml(state.room.code)}</div>
        <div class="actions" style="margin-top:16px">
          <button id="copyLink" class="secondary">Copy invite link</button>
        </div>
        </div>
      </div>
      <section class="panel window">
        <div class="window-titlebar">
          <span>ROOM_SETTINGS.EXE</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body form-body">
        <div>
          <div class="section-title"><span>Players</span></div>
          <div class="player-list">
            ${state.participants
              .map(
                (participant) => `
                  <div class="player-row">
                    <strong>${escapeHtml(participant.display_name)}</strong>
                    <span>${participant.is_host ? "host" : "joined"}</span>
                  </div>`,
              )
              .join("")}
          </div>
        </div>
        ${isHost()
          ? html`
              <form id="settingsForm">
                <div class="form-grid">
                  <label>AI seats<input name="aiCount" type="number" min="1" max="8" value="${s.aiCount}" /></label>
                  <label>Rounds<input name="roundCount" type="number" min="1" max="8" value="${s.roundCount}" /></label>
                  <label>Seconds per round<input name="roundSeconds" type="number" min="10" max="180" value="${s.roundSeconds}" /></label>
                  <label>Character limit<input name="charLimit" type="number" min="40" max="280" value="${s.charLimit}" /></label>
                </div>
                <div class="actions" style="margin-top:16px">
                  <button class="secondary" type="submit">Save settings</button>
                  <button class="primary" id="startGame" type="button">Start game</button>
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
  const publicLeft = Math.max(0, 1 - messagesFromMe("public").length);
  const newDmLeft = Math.max(0, 2 - newDmsFromMe().length);
  const replyLeft = Math.max(0, 2 - repliesFromMe().length);
  return html`
    <section class="game-view">
      <aside class="side-panel window">
        <div class="window-titlebar">
          <span>PLAYER_MONITOR.SYS</span>
          <span class="window-controls">_ [] X</span>
        </div>
        <div class="window-body">
        <div class="panel-section">
          <div class="section-title"><span>You are</span></div>
          <div class="identity">${seat ? identityName(seat) : "No seat yet"}</div>
        </div>
        <div class="panel-section">
          <div class="section-title"><span>Allowances</span></div>
          <div class="allowances">
            <div class="allowance"><span>Public</span><strong>${publicLeft}</strong></div>
            <div class="allowance"><span>New DMs</span><strong>${newDmLeft}</strong></div>
            <div class="allowance"><span>Replies</span><strong>${replyLeft}</strong></div>
            <div class="allowance"><span>Character limit</span><strong>${s.charLimit}</strong></div>
          </div>
        </div>
        <div class="panel-section">
          <div class="section-title"><span>Scoreboard</span></div>
          <div class="scoreboard">${scoreboardRows()}</div>
        </div>
        </div>
      </aside>
      <section class="play-area">
        <div class="identity-rail">${state.seats.map((entry) => `<article class="identity">${identityName(entry)}<div class="identity-meta">Anonymous seat</div></article>`).join("")}</div>
        <div class="desktop-surface">
          <section class="window board-window">
            <div class="window-titlebar">
              <span>Public Board</span>
              <span class="window-controls">_ [] X</span>
            </div>
            <div class="message-list">${publicMessages()}</div>
            <form id="publicForm" class="composer">
              <textarea name="body" rows="2" maxlength="${s.charLimit}" placeholder="One public post this round"></textarea>
              <div class="composer-row">
                <span class="counter">character limit ${s.charLimit}</span>
                <button type="submit" ${publicLeft <= 0 ? "disabled" : ""}>Post</button>
              </div>
            </form>
          </section>

          <section class="window dm-launcher">
            <div class="window-titlebar">
              <span>Open Direct Message</span>
              <span class="window-controls">_ [] X</span>
            </div>
            <div class="dm-controls">
              <select id="dmSeat">${dmOptions()}</select>
            </div>
          </section>

          <div class="dm-window-grid">${dmWindows(newDmLeft, replyLeft)}</div>
        </div>
      </section>
    </section>
  `;
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
          <span class="pill muted">${state.guesses.length}/${state.participants.length} submitted</span>
        </div>
      </div>
      ${submitted
        ? `<div class="notice">Your guesses are in. Waiting for everyone else.</div>`
        : html`<form id="guessForm" class="guess-grid">
            ${state.seats.map(guessCard).join("")}
            <button class="primary guess-submit" type="submit">Submit guesses</button>
          </form>`}
    </section>
  `;
}

function renderResults() {
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
          <p class="eyebrow">Results</p>
          <h2>${escapeHtml(winners.map((winner) => winner.display_name).join(", ") || "No winner")} won</h2>
          </div>
          <div class="countdown">Next game in ${state.countdown}</div>
        </div>
      </div>
      <div class="results-grid">
        ${state.seats
          .map((seat) => {
            const truth =
              seat.kind === "human"
                ? `Human: ${escapeHtml(participantById(seat.participant_id)?.display_name || "Unknown")}`
                : `AI, mimicking ${escapeHtml(participantById(seat.mimic_participant_id)?.display_name || "Unknown")}`;
            return `<article class="reveal-card window"><div class="window-titlebar"><span>${escapeHtml(seat.alias)}.ID</span><span class="window-controls">_ [] X</span></div><div class="window-body"><h3>${identityName(seat)}</h3><p>${truth}</p></div></article>`;
          })
          .join("")}
        <article class="reveal-card window"><div class="window-titlebar"><span>STANDINGS.TXT</span><span class="window-controls">_ [] X</span></div><div class="window-body"><h3>Table standings</h3>${scoreboardRows(true)}</div></article>
      </div>
    </section>
  `;
}

function identityName(seat) {
  return `<div class="identity-name"><span class="avatar" style="background:${seat.color}">${escapeHtml(seat.icon)}</span>${escapeHtml(seat.alias)}</div>`;
}

function scoreboardRows(showLast = false) {
  return state.participants
    .map(
      (participant) => `
        <div class="${showLast ? "result-row" : "score-row"}">
          <strong>${escapeHtml(participant.display_name)}</strong>
          <span>${showLast ? `+${participant.last_points || 0} / ` : ""}${participant.total_points} pts / ${participant.wins} wins</span>
        </div>`,
    )
    .join("");
}

function messageHtml(message) {
  const from = seatById(message.from_seat_id);
  const to = message.to_seat_id ? seatById(message.to_seat_id) : null;
  const label = to ? `${from?.alias || "Unknown"} to ${to.alias}` : from?.alias || "Unknown";
  return `
    <article class="message" style="border-left-color:${from?.color || "#343945"}">
      <div class="message-head"><span>${escapeHtml(label)}</span><span>R${message.round_number}</span></div>
      <p>${escapeHtml(message.body)}</p>
    </article>`;
}

function publicMessages() {
  return state.messages.filter((message) => message.channel === "public").map(messageHtml).join("") || `<article class="message"><p>No public messages yet.</p></article>`;
}

function dmOptions() {
  const mine = mySeat();
  const options = state.seats
    .filter((seat) => seat.id !== mine?.id)
    .map((seat) => `<option value="${seat.id}" ${seat.id === state.selectedDmSeatId ? "selected" : ""}>${escapeHtml(seat.alias)}</option>`)
    .join("");
  return options;
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

function dmWindows(newDmLeft, replyLeft) {
  const mine = mySeat();
  if (!mine) return "";
  const threadSeatIds = new Set(
    state.messages
      .filter((message) => message.channel === "direct" && (message.from_seat_id === mine.id || message.to_seat_id === mine.id))
      .map((message) => (message.from_seat_id === mine.id ? message.to_seat_id : message.from_seat_id)),
  );
  const defaultSeat = state.selectedDmSeatId || state.seats.find((seat) => seat.id !== mine.id)?.id;
  if (defaultSeat) threadSeatIds.add(defaultSeat);
  state.selectedDmSeatId = defaultSeat || "";

  return [...threadSeatIds]
    .filter(Boolean)
    .map((seatId) => {
      const seat = seatById(seatId);
      if (!seat) return "";
      const isFocused = seatId === state.selectedDmSeatId;
      return `
        <section class="window dm-window ${isFocused ? "focused" : ""}">
          <div class="window-titlebar">
            <span>${escapeHtml(seat.alias)}.dm</span>
            <span class="window-controls">_ [] X</span>
          </div>
          <div class="message-list compact">${directMessagesFor(seatId)}</div>
          ${
            isFocused
              ? `<form id="dmForm" class="composer">
                  <textarea name="body" rows="2" maxlength="${settings().charLimit}" placeholder="Message ${escapeHtml(seat.alias)}"></textarea>
                  <div class="composer-row">
                    <span class="counter">new ${newDmLeft} / replies ${replyLeft}</span>
                    <button type="submit" ${newDmLeft <= 0 && replyLeft <= 0 ? "disabled" : ""}>Send</button>
                  </div>
                </form>`
              : `<button class="secondary focus-dm" type="button" data-seat-id="${seat.id}">Open this window</button>`
          }
        </section>
      `;
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

function hasPriorDmWith(seatId) {
  const mine = mySeat();
  return state.messages.some(
    (message) =>
      message.channel === "direct" &&
      ((message.from_seat_id === mine?.id && message.to_seat_id === seatId) ||
        (message.from_seat_id === seatId && message.to_seat_id === mine?.id)),
  );
}

function newDmsFromMe() {
  const mine = mySeat();
  return state.messages.filter(
    (message) =>
      message.from_seat_id === mine?.id &&
      message.channel === "direct" &&
      message.round_number === state.game?.round_number &&
      !state.messages.some(
        (prior) =>
          prior.created_at < message.created_at &&
          prior.channel === "direct" &&
          ((prior.from_seat_id === message.from_seat_id && prior.to_seat_id === message.to_seat_id) ||
            (prior.from_seat_id === message.to_seat_id && prior.to_seat_id === message.from_seat_id)),
      ),
  );
}

function repliesFromMe() {
  const mine = mySeat();
  return state.messages.filter(
    (message) =>
      message.from_seat_id === mine?.id &&
      message.channel === "direct" &&
      message.round_number === state.game?.round_number &&
      state.messages.some(
        (prior) =>
          prior.created_at < message.created_at &&
          prior.channel === "direct" &&
          ((prior.from_seat_id === message.from_seat_id && prior.to_seat_id === message.to_seat_id) ||
            (prior.from_seat_id === message.to_seat_id && prior.to_seat_id === message.from_seat_id)),
      ),
  );
}

function guessCard(seat) {
  const humanOptions = [`<option value="">No human match</option>`]
    .concat(state.participants.map((participant) => `<option value="${participant.id}">${escapeHtml(participant.display_name)}</option>`))
    .join("");
  return `
    <article class="guess-card window">
      <div class="window-titlebar">
        <span>${escapeHtml(seat.alias)}.GUESS</span>
        <span class="window-controls">_ [] X</span>
      </div>
      <div class="window-body">
      ${identityName(seat)}
      <div class="guess-fields">
        <label>Type<select name="${seat.id}-kind"><option value="human">Human</option><option value="ai">AI</option></select></label>
        <label>Bonus human match<select name="${seat.id}-human">${humanOptions}</select></label>
      </div>
      </div>
    </article>`;
}

function bindCommonEvents() {
  document.getElementById("connectForm")?.addEventListener("submit", onConnect);
  document.getElementById("settingsForm")?.addEventListener("submit", onSaveSettings);
  document.getElementById("startGame")?.addEventListener("click", startGame);
  document.getElementById("copyLink")?.addEventListener("click", copyLink);
  document.getElementById("publicForm")?.addEventListener("submit", onPublicMessage);
  document.getElementById("dmForm")?.addEventListener("submit", onDirectMessage);
  document.getElementById("dmSeat")?.addEventListener("change", (event) => {
    state.selectedDmSeatId = event.target.value;
    render();
  });
  document.querySelectorAll(".focus-dm").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDmSeatId = button.dataset.seatId || "";
      render();
    });
  });
  document.getElementById("guessForm")?.addEventListener("submit", onSubmitGuesses);
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
  await refreshAll();
  subscribeRoom();
  startLocalTimer();
  const url = new URL(window.location.href);
  url.searchParams.set("room", room.code);
  window.history.replaceState({}, "", url);
}

async function refreshAll() {
  if (!state.room) return;
  const [participantsRes, gamesRes] = await Promise.all([
    supabase.from("participants").select("*").eq("room_id", state.room.id).order("created_at"),
    supabase.from("games").select("*").eq("room_id", state.room.id).order("created_at", { ascending: false }).limit(1),
  ]);
  state.participants = participantsRes.data || [];
  state.participant = state.participants.find((participant) => participant.id === local.participantId) || null;
  state.game = gamesRes.data?.[0] || null;

  if (state.game) {
    const [seatsRes, messagesRes, guessesRes] = await Promise.all([
      supabase.from("seats").select("*").eq("game_id", state.game.id).order("created_at"),
      supabase.from("messages").select("*").eq("game_id", state.game.id).order("created_at"),
      supabase.from("guesses").select("*").eq("game_id", state.game.id),
    ]);
    state.seats = seatsRes.data || [];
    state.messages = messagesRes.data || [];
    state.guesses = guessesRes.data || [];
  } else {
    state.seats = [];
    state.messages = [];
    state.guesses = [];
  }
  updateCountdown();
  render();
  await hostMaintenance();
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

function startLocalTimer() {
  clearInterval(state.tickTimer);
  state.tickTimer = setInterval(async () => {
    updateCountdown();
    render();
    await hostMaintenance();
  }, 1000);
}

function updateCountdown() {
  if (state.game?.status === "playing") state.countdown = secondsUntil(state.game.round_ends_at);
  else if (state.room?.status === "results") state.countdown = secondsUntil(state.room.next_game_at);
  else state.countdown = 0;
}

async function onSaveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const nextSettings = {
    aiCount: clamp(form.get("aiCount"), 1, 8, 2),
    roundCount: clamp(form.get("roundCount"), 1, 8, 3),
    roundSeconds: clamp(form.get("roundSeconds"), 10, 180, 60),
    charLimit: clamp(form.get("charLimit"), 40, 280, 160),
  };
  const { error } = await supabase.from("rooms").update({ settings: nextSettings }).eq("id", state.room.id);
  if (error) alert(error.message);
}

function clamp(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function startGame() {
  if (!isHost()) return;
  const s = settings();
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
  if (gameError) return alert(gameError.message);

  const seats = buildSeats(game.id, s.aiCount);
  const { error: seatsError } = await supabase.from("seats").insert(seats);
  if (seatsError) return alert(seatsError.message);
  await supabase.from("rooms").update({ status: "playing", game_number: nextGameNumber, next_game_at: null }).eq("id", state.room.id);
  await refreshAll();
}

function buildSeats(gameId, aiCount) {
  const names = shuffle(BOT_NAMES);
  const icons = shuffle(ICONS);
  const colors = shuffle(COLORS);
  const targets = shuffle(state.participants);
  const humanSeats = state.participants.map((participant, index) => ({
    game_id: gameId,
    participant_id: participant.id,
    kind: "human",
    alias: names[index % names.length],
    icon: icons[index % icons.length],
    color: colors[index % colors.length],
  }));
  const aiSeats = Array.from({ length: aiCount }, (_, index) => {
    const target = targets[index % targets.length];
    return {
      game_id: gameId,
      kind: "ai",
      mimic_participant_id: target.id,
      alias: names[(humanSeats.length + index) % names.length],
      icon: icons[(humanSeats.length + index) % icons.length],
      color: colors[(humanSeats.length + index) % colors.length],
    };
  });
  return shuffle([...humanSeats, ...aiSeats]);
}

async function onPublicMessage(event) {
  event.preventDefault();
  const mine = mySeat();
  if (!mine || messagesFromMe("public").length >= 1) return;
  const body = String(new FormData(event.currentTarget).get("body") || "").trim();
  await insertMessage(mine.id, "public", body);
}

async function onDirectMessage(event) {
  event.preventDefault();
  const mine = mySeat();
  const toSeatId = state.selectedDmSeatId || document.getElementById("dmSeat")?.value;
  const isReply = hasPriorDmWith(toSeatId);
  if (isReply && repliesFromMe().length >= 2) return;
  if (!isReply && newDmsFromMe().length >= 2) return;
  const body = String(new FormData(event.currentTarget).get("body") || "").trim();
  await insertMessage(mine.id, "direct", body, toSeatId);
}

async function insertMessage(fromSeatId, channel, body, toSeatId = null) {
  const clean = body.slice(0, settings().charLimit);
  if (!clean) return;
  const { error } = await supabase.from("messages").insert({
    room_id: state.room.id,
    game_id: state.game.id,
    round_number: state.game.round_number,
    from_seat_id: fromSeatId,
    to_seat_id: toSeatId,
    channel,
    body: clean,
  });
  if (error) alert(error.message);
}

async function onSubmitGuesses(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const guesses = state.seats.map((seat) => ({
    seatId: seat.id,
    kind: form.get(`${seat.id}-kind`),
    participantId: form.get(`${seat.id}-human`) || null,
  }));
  const { error } = await supabase.from("guesses").insert({
    game_id: state.game.id,
    participant_id: state.participant.id,
    guesses,
  });
  if (error) alert(error.message);
  await refreshAll();
}

async function hostMaintenance() {
  if (!isHost() || !state.room) return;
  if (state.game?.status === "playing" && state.countdown <= 0) {
    if (state.game.round_number >= settings().roundCount) {
      await supabase.from("games").update({ status: "guessing" }).eq("id", state.game.id);
      await supabase.from("rooms").update({ status: "guessing" }).eq("id", state.room.id);
      return;
    }
    await supabase
      .from("games")
      .update({ round_number: state.game.round_number + 1, round_ends_at: nowPlus(settings().roundSeconds) })
      .eq("id", state.game.id);
    await refreshAll();
  }
  if (state.game?.status === "playing" && state.countdown <= Math.max(0, settings().roundSeconds - 8)) {
    await runAiRoundMessages();
  }
  if (state.room.status === "guessing" && state.guesses.length >= state.participants.length && state.participants.length > 0) {
    await scoreGame();
  }
  if (state.room.status === "results" && state.countdown <= 0) {
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
  await supabase.from("games").update({ status: "results" }).eq("id", state.game.id);
  await supabase.from("rooms").update({ status: "results", next_game_at: nowPlus(15) }).eq("id", state.room.id);
}

async function runAiRoundMessages() {
  if (!isHost()) return;
  const aiSeats = state.seats.filter((seat) => seat.kind === "ai");
  for (const aiSeat of aiSeats) {
    const publicCount = state.messages.filter(
      (message) => message.from_seat_id === aiSeat.id && message.channel === "public" && message.round_number === state.game.round_number,
    ).length;
    if (publicCount === 0) await insertAiMessage(aiSeat, "public", null);

    const targets = shuffle(state.seats.filter((seat) => seat.kind === "human")).slice(0, 2);
    for (const target of targets) {
      const alreadySent = state.messages.some(
        (message) =>
          message.from_seat_id === aiSeat.id &&
          message.to_seat_id === target.id &&
          message.channel === "direct" &&
          message.round_number === state.game.round_number,
      );
      if (!alreadySent) await insertAiMessage(aiSeat, "direct", target.id);
    }
  }
}

async function insertAiMessage(aiSeat, channel, toSeatId) {
  const { data, error } = await supabase.functions.invoke("ai-turn", {
    body: {
      roomId: state.room.id,
      gameId: state.game.id,
      seatId: aiSeat.id,
      channel,
      toSeatId,
    },
  });

  if (!error && data?.message) {
    await refreshAll();
    return;
  }

  console.warn("Falling back to local AI mock:", error?.message || data?.error || "unknown edge function response");
  const body = await generateAiText(aiSeat);
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
}

async function generateAiText(aiSeat) {
  const targetSeatIds = state.seats
    .filter((seat) => seat.participant_id === aiSeat.mimic_participant_id)
    .map((seat) => seat.id);
  const currentSamples = state.messages.filter((message) => targetSeatIds.includes(message.from_seat_id)).map((message) => message.body);
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
      .eq("channel", "public")
      .order("created_at", { ascending: false })
      .limit(20);
    historicalMessages = data || [];
  }
  const samples = [...currentSamples, ...historicalMessages.map((row) => row.body)];
  if (samples.length) {
    const sample = samples[Math.floor(Math.random() * samples.length)];
    const words = sample.split(/\s+/).filter(Boolean).slice(0, 10).join(" ");
    const tail = FILLER[Math.floor(Math.random() * FILLER.length)];
    return `${words} - ${tail}`.slice(0, settings().charLimit);
  }
  return FILLER[Math.floor(Math.random() * FILLER.length)];
}

async function boot() {
  if (supabaseReady) {
    const code = new URLSearchParams(window.location.search).get("room");
    if (code && local.participantId) {
      await loadRoom(code.toUpperCase());
      return;
    }
  }
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

boot();
