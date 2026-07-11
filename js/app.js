/* ==============================================
   DLM BlueSteel Player — Dashboard App Logic v2.1
   ============================================== */
'use strict';
// Force update default API URL to the new one
if (localStorage.getItem('dlm_api_url_migrated_v4') !== 'true') {
  localStorage.setItem('dlm_api_url', 'https://specially-mark-hire-allan.trycloudflare.com');
  localStorage.setItem('dlm_api_url_migrated_v4', 'true');
}
let API_BASE_URL    = localStorage.getItem('dlm_api_url') || 'https://specially-mark-hire-allan.trycloudflare.com';
let selectedGuildId = null;
let nowPlayingData  = null;
let queueData       = [];
let isOnline        = false;
let npTimer         = null;
let queueTimer      = null;
let searchDebounce  = null;
let selectedSearchResult = null; // { url, title }
// ─── Volume and Mute State ──────────────────────
let currentVolume   = 100;
let isMuted         = false;
let preMuteVolume   = 100;
let volSliderActive = false;
function updateVolumeUI() {
  const slider = $('bbVolumeSlider');
  const valText = $('bbVolumeVal');
  if (slider) slider.value = isMuted ? 0 : currentVolume;
  if (valText) valText.textContent = (isMuted ? 0 : currentVolume) + '%';
  updateVolumeButtons();
}
function updateVolumeButtons() {
  const volIconFull = $('volIconFull');
  const volIconMute = $('volIconMute');
  const volBtn = $('bbVolBtn');
  
  if (isMuted) {
    if (volIconFull) volIconFull.style.display = 'none';
    if (volIconMute) volIconMute.style.display = 'block';
    if (volBtn) volBtn.classList.add('muted');
  } else {
    if (volIconFull) volIconFull.style.display = 'block';
    if (volIconMute) volIconMute.style.display = 'none';
    if (volBtn) volBtn.classList.remove('muted');
  }
}
async function sendVolumeChange(vol) {
  if (!selectedGuildId) return;
  try {
    await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/volume?guildId=${selectedGuildId}&val=${vol}`, { headers: { 'ngrok-skip-browser-warning': 'true' }});
  } catch (err) { console.error(err); }
}
// ─── DOM ────────────────────────────────────────
const $ = id => document.getElementById(id);
// ─── Fetch ──────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const url = API_BASE_URL.replace(/\/$/, '') + path;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); if (j.error) msg = j.error; } catch (_) {}
    throw new Error(msg);
  }
  return text ? JSON.parse(text) : null;
}
// ─── Connection Status ──────────────────────────
function setOnline(online) {
  if (isOnline === online) return;
  isOnline = online;
  $('statusDot').className  = online ? 'status-dot online'  : 'status-dot offline';
  $('statusText').textContent = online ? 'Connected' : 'Offline';
  refreshButtonStates();
}
// ─── Polling ────────────────────────────────────
function startPolling() {
  stopPolling();
  pollNowPlaying();
  pollQueue();
  npTimer    = setInterval(pollNowPlaying, 3000);
  queueTimer = setInterval(pollQueue,      5000);
}
function stopPolling() {
  clearInterval(npTimer);
  clearInterval(queueTimer);
}
async function pollNowPlaying() {
  if (!selectedGuildId) return;
  try {
    const data = await apiFetch(`/api/now-playing?guildId=${selectedGuildId}`);
    setOnline(true);
    updateNowPlaying(data);
  } catch {
    setOnline(false);
    updateNowPlaying(null);
  }
}
async function pollQueue() {
  if (!selectedGuildId) return;
  try {
    const data = await apiFetch(`/api/queue?guildId=${selectedGuildId}`);
    setOnline(true);
    queueData = Array.isArray(data) ? data : [];
    renderQueue();
  } catch {
    setOnline(false);
  }
}
// ─── Guilds ─────────────────────────────────────
async function loadGuilds() {
  const sel = $('guildSelect');
  sel.innerHTML = '<option value="">Loading...</option>';
  try {
    const guilds = await apiFetch('/guilds');
    setOnline(true);
    if (!guilds || guilds.length === 0) {
      sel.innerHTML = '<option value="">No servers found</option>';
      return;
    }
    sel.innerHTML = '';
    guilds.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id; opt.textContent = g.name;
      sel.appendChild(opt);
    });
    const saved = localStorage.getItem('dlm_guild_id');
    if (saved && guilds.find(g => g.id === saved)) sel.value = saved;
    selectedGuildId = sel.value || null;
    if (selectedGuildId) startPolling();
  } catch (err) {
    setOnline(false);
    sel.innerHTML = '<option value="">Cannot reach bot</option>';
    showToast('Cannot connect to bot — check the API URL in Settings', 'error');
  }
}
// ─── Now Playing ────────────────────────────────
function updateNowPlaying(np) {
  nowPlayingData = np;
  const title       = $('npTitle');
  const artist      = $('npArtist');
  const artImg      = $('npArtworkImg');
  const artWrap     = $('npArtwork');
  const placeholder = artWrap.querySelector('.np-artwork-placeholder');
  const bgArt       = $('npBgArt');
  const fill        = $('progressFill');
  const curTime     = $('currentTime');
  const totTime     = $('totalTime');
  const viz         = $('visualizer');
  if (!np) {
    title.textContent       = 'Nothing Playing';
    artist.textContent      = 'Queue is empty';
    artImg.style.display    = 'none';
    placeholder.style.display = 'flex';
    artWrap.classList.remove('playing');
    bgArt.classList.remove('visible');
    bgArt.style.backgroundImage = '';
    fill.style.width        = '0%';
    curTime.textContent     = '0:00';
    totTime.textContent     = '0:00';
    viz.classList.remove('active');
    // Bottom bar
    $('bbTitle').textContent = 'Nothing Playing';
    $('bbArtist').textContent = 'Queue is empty';
    $('bbArtImg').style.display = 'none';
    $('bbArtPlaceholder').style.display = 'flex';
    $('bbCurTime').textContent = '0:00';
    $('bbTotTime').textContent = '0:00';
    $('bbProgressFill').style.width = '0%';
    refreshButtonStates();
    return;
  }
  // Update Recently Played History
  updateRecentlyPlayed(np);
  title.textContent  = np.title || 'Unknown Track';
  artist.textContent = 'DLM BlueSteel Player';
  if (np.thumbnail) {
    artImg.src                  = np.thumbnail;
    artImg.style.display        = 'block';
    placeholder.style.display   = 'none';
    bgArt.style.backgroundImage = `url('${np.thumbnail}')`;
    bgArt.classList.add('visible');
  } else {
    artImg.style.display      = 'none';
    placeholder.style.display = 'flex';
    bgArt.classList.remove('visible');
  }
  artWrap.classList.toggle('playing', !np.paused);
  viz.classList.toggle('active', !np.paused);
  const durationSecs = parseDurationSecs(np.duration);
  const pos = Number(np.position) || 0;
  const pct = durationSecs > 0 ? Math.min(100, (pos / durationSecs) * 100) : 0;
  fill.style.width    = pct.toFixed(1) + '%';
  curTime.textContent = formatTime(pos);
  totTime.textContent = np.duration || '0:00';
  const iconPlay  = $('iconPlay');
  const iconPause = $('iconPause');
  iconPlay.style.display  = np.paused ? '' : 'none';
  iconPause.style.display = np.paused ? 'none' : '';
  // Bottom Bar Updates
  $('bbTitle').textContent = np.title || 'Unknown Track';
  $('bbArtist').textContent = 'DLM BlueSteel Player';
  if (np.thumbnail) {
    $('bbArtImg').src = np.thumbnail;
    $('bbArtImg').style.display = 'block';
    $('bbArtPlaceholder').style.display = 'none';
  } else {
    $('bbArtImg').style.display = 'none';
    $('bbArtPlaceholder').style.display = 'flex';
  }
  $('bbCurTime').textContent = formatTime(pos);
  $('bbTotTime').textContent = np.duration || '0:00';
  $('bbProgressFill').style.width = pct.toFixed(1) + '%';
  $('bbIconPlay').style.display = np.paused ? '' : 'none';
  $('bbIconPause').style.display = np.paused ? 'none' : '';
  // Sync volume from server if not being adjusted locally
  if (typeof np.volume === 'number' && !volSliderActive) {
    currentVolume = np.volume;
    if (currentVolume > 0) isMuted = false;
    else isMuted = true;
    updateVolumeUI();
  }
  refreshButtonStates();
}
// ─── Recently Played ─────────────────────────────
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
let recentlyPlayed = JSON.parse(localStorage.getItem('dlm_recently_played') || '[]');
// Clean up old entries on load
recentlyPlayed = recentlyPlayed.filter(t => Date.now() - t.timestamp < SEVEN_DAYS_MS);
localStorage.setItem('dlm_recently_played', JSON.stringify(recentlyPlayed));
function timeAgo(ms) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
function updateRecentlyPlayed(np) {
  if (!np || !np.title) return;
  
  // Filter out any existing entries with the same title to prevent duplicates
  recentlyPlayed = recentlyPlayed.filter(t => t.title !== np.title);
  
  const track = {
    title: np.title,
    url: np.url || '',
    thumbnail: np.thumbnail,
    duration: np.duration,
    timestamp: Date.now()
  };
  recentlyPlayed.unshift(track);
  // Remove entries older than 7 days and cap at 50
  recentlyPlayed = recentlyPlayed.filter(t => Date.now() - t.timestamp < SEVEN_DAYS_MS).slice(0, 50);
  localStorage.setItem('dlm_recently_played', JSON.stringify(recentlyPlayed));
  renderRecentlyPlayed();
}
function renderRecentlyPlayed() {
  const container = $('recentlyPlayedContainer');
  if (!container) return;
  if (recentlyPlayed.length === 0) {
    container.innerHTML = `<div class="empty-state-small">No recent history — songs appear here for 7 days</div>`;
    return;
  }
  container.innerHTML = recentlyPlayed.map((track, i) => {
    const art = track.thumbnail 
      ? `<img src="${esc(track.thumbnail)}" alt="" />`
      : `<div class="placeholder-art"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;
    return `
      <div class="recent-card" data-index="${i}">
        <div class="recent-art">
          ${art}
          <div class="recent-play-hover">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <span class="recent-time-badge">${timeAgo(track.timestamp)}</span>
        <div class="recent-info">
          <div class="recent-title">${esc(track.title)}</div>
        </div>
      </div>
    `;
  }).join('');
  // Wire click to add song to queue
  container.querySelectorAll('.recent-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index, 10);
      const track = recentlyPlayed[idx];
      if (track) {
        const query = track.url || track.title;
        showToast(`Queueing recent: ${track.title}`, 'info');
        addSong(query, null, null, null);
      }
    });
  });
}
function refreshButtonStates() {
  const hasGuild  = !!selectedGuildId;
  const isPlaying = !!nowPlayingData;
  $('btnPlayPause').disabled = !hasGuild || !isPlaying;
  $('btnSkip').disabled      = !hasGuild || !isPlaying;
  $('btnStop').disabled      = !hasGuild || !isPlaying;
  
  const bbBtnPlayPause = $('bbBtnPlayPause');
  const bbBtnSkip = $('bbBtnSkip');
  const bbBtnStop = $('bbBtnStop');
  if (bbBtnPlayPause) bbBtnPlayPause.disabled = !hasGuild || !isPlaying;
  if (bbBtnSkip) bbBtnSkip.disabled = !hasGuild || !isPlaying;
  if (bbBtnStop) bbBtnStop.disabled = !hasGuild || !isPlaying;
  $('clearQueueBtn').disabled = !hasGuild;
  $('quickAddBtn').disabled  = !hasGuild;
}
// ─── Queue Render ────────────────────────────────
function renderQueue() {
  const list  = $('queueList');
  const count = $('queueCount');
  count.textContent = `${queueData.length} track${queueData.length !== 1 ? 's' : ''} in queue`;
  if (queueData.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        <p>Queue is empty</p>
        <span>add songs using Quick Play or the add songs tab</span>
      </div>`;
    return;
  }
  list.innerHTML = queueData.map((track, i) => `
    <div class="queue-item" data-index="${i}">
      <span class="queue-index">${i + 1}</span>
      <div class="queue-thumb">
        ${track.thumbnail
          ? `<img src="${esc(track.thumbnail)}" alt="" loading="lazy" />`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}
      </div>
      <div class="queue-info">
        <div class="queue-title">${esc(track.title || 'Unknown')}</div>
        <div class="queue-duration">${esc(track.duration || '')}</div>
      </div>
      <button class="queue-item-remove" data-index="${i}" title="Remove from queue">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
  // Wire up remove buttons
  list.querySelectorAll('.queue-item-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeFromQueue(parseInt(btn.dataset.index));
    });
  });
  // Also render for the small quick queue list (top 5 only)
  const smallList = $('quickQueueList');
  const queueBadge = $('queueBadge');
  if (queueBadge) queueBadge.textContent = `${queueData.length} track${queueData.length !== 1 ? 's' : ''}`;
  if (smallList) {
    if (queueData.length === 0) {
      smallList.innerHTML = `<div class="empty-state-small">Nothing in the queue</div>`;
    } else {
      const top5 = queueData.slice(0, 5);
      smallList.innerHTML = top5.map((track, i) => `
        <div class="queue-item-small" data-index="${i}">
          <div class="queue-thumb-small">
            ${track.thumbnail
              ? `<img src="${esc(track.thumbnail)}" alt="" loading="lazy" />`
              : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}
          </div>
          <div class="queue-info-small">
            <div class="queue-title-small">${esc(track.title || 'Unknown')}</div>
            <div class="queue-duration-small">${esc(track.duration || '')}</div>
          </div>
          <button class="queue-remove-small" data-index="${i}" title="Remove">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      `).join('');
      // Wire remove buttons in quick queue
      smallList.querySelectorAll('.queue-remove-small').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          removeFromQueue(parseInt(btn.dataset.index));
        });
      });
    }
    // Show/hide "View full queue" link
    const viewAll = $('quickQueueViewAll');
    if (viewAll) viewAll.style.display = queueData.length > 5 ? 'block' : 'none';
  }
}
// ─── Controls ───────────────────────────────────
async function handlePlayPause() {
  if (!selectedGuildId || !nowPlayingData) return;
  $('btnPlayPause').disabled = true;
  try {
    const endpoint = nowPlayingData.paused ? '/api/queue/resume' : '/api/queue/pause';
    await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId }) });
    // Optimistic update
    nowPlayingData.paused = !nowPlayingData.paused;
    const viz    = $('visualizer');
    const art    = $('npArtwork');
    const iPlay  = $('iconPlay');
    const iPause = $('iconPause');
    if (nowPlayingData.paused) {
      iPlay.style.display = ''; iPause.style.display = 'none';
      viz.classList.remove('active'); art.classList.remove('playing');
      showToast('Paused ⏸', 'info');
    } else {
      iPlay.style.display = 'none'; iPause.style.display = '';
      viz.classList.add('active'); art.classList.add('playing');
      showToast('Playing ▶', 'info');
    }
    
    // Optimistic update for bottom bar
    const bbPlay = $('bbIconPlay');
    const bbPause = $('bbIconPause');
    if (bbPlay && bbPause) {
      if (nowPlayingData.paused) {
        bbPlay.style.display = ''; bbPause.style.display = 'none';
      } else {
        bbPlay.style.display = 'none'; bbPause.style.display = '';
      }
    }
    
  } catch (err) {
    showToast(`Action failed: ${err.message}`, 'error');
  } finally {
    $('btnPlayPause').disabled = false;
  }
  setTimeout(pollNowPlaying, 700);
}
async function handleSkip() {
  if (!selectedGuildId) return;
  $('btnSkip').disabled = true;
  try {
    await apiFetch('/api/queue/skip', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId }) });
    showToast('Skipped ⏭', 'success');
    setTimeout(() => { pollNowPlaying(); pollQueue(); }, 500);
  } catch (err) {
    showToast('Skip failed: ' + err.message, 'error');
  } finally {
    setTimeout(() => { $('btnSkip').disabled = !nowPlayingData || !selectedGuildId; }, 800);
  }
}
async function handleStop() {
  if (!selectedGuildId) return;
  $('btnStop').disabled = true;
  try {
    await apiFetch('/api/queue/stop', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId }) });
    showToast('Stopped ⏹', 'info');
    nowPlayingData = null;
    queueData = [];
    updateNowPlaying(null);
    renderQueue();
  } catch (err) {
    showToast('Stop failed: ' + err.message, 'error');
  } finally {
    $('btnStop').disabled = true; // stays disabled until something plays
  }
}
async function handleClearQueue() {
  if (!selectedGuildId) return;
  $('clearQueueBtn').disabled = true;
  try {
    await apiFetch('/api/queue/clear', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId }) });
    showToast('Queue cleared 🗑️', 'info');
    queueData = [];
    renderQueue();
  } catch (err) {
    showToast('Clear failed: ' + err.message, 'error');
  } finally {
    $('clearQueueBtn').disabled = false;
  }
}
async function handleShuffle() {
  if (!selectedGuildId) return;
  try {
    const data = await apiFetch(`/api/queue/shuffle?guildId=${selectedGuildId}`, { method: 'POST' });
    showToast(`Shuffled ${data.count || 0} songs 🔀`, 'success');
    setTimeout(() => { pollNowPlaying(); pollQueue(); }, 500);
  } catch (err) {
    showToast('Shuffle failed: ' + err.message, 'error');
  }
}
async function removeFromQueue(index) {
  if (!selectedGuildId) return;
  try {
    await apiFetch('/api/queue/remove', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId, index }) });
    queueData.splice(index, 1);
    renderQueue();
    showToast('Removed from queue', 'info');
  } catch (err) {
    showToast('Remove failed: ' + err.message, 'error');
    setTimeout(pollQueue, 500);
  }
}
async function addSong(queryOrUrl, statusEl, inputEl, btnEl) {
  if (!selectedGuildId) { showToast('No server selected', 'error'); return false; }
  if (!queryOrUrl || !queryOrUrl.trim()) return false;
  if (btnEl)    btnEl.disabled    = true;
  if (statusEl) { statusEl.className = 'add-status loading'; statusEl.textContent = 'Adding to queue...'; }
  try {
    await apiFetch('/api/queue/add', {
      method: 'POST',
      body: JSON.stringify({ guildId: selectedGuildId, query: queryOrUrl.trim() }),
    });
    if (inputEl)  inputEl.value = '';
    if (statusEl) {
      statusEl.className   = 'add-status success';
      statusEl.textContent = '✓ Added to queue!';
      setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'add-status'; }, 3000);
    }
    showToast('Added to queue 🎵', 'success');
    setTimeout(pollQueue, 800);
    return true;
  } catch (err) {
    if (statusEl) { statusEl.className = 'add-status error'; statusEl.textContent = '✗ ' + err.message; }
    showToast('Add failed: ' + err.message, 'error');
    return false;
  } finally {
    if (btnEl) btnEl.disabled = !selectedGuildId;
  }
}
// ─── YouTube Search ──────────────────────────────
function isUrl(str) {
  return str.startsWith('http://') || str.startsWith('https://');
}
async function doSearch(query) {
  const resultsEl   = $('searchResults');
  const spinner     = $('searchSpinner');
  const directRow   = $('directAddRow');
  const status      = $('addStatus');
  // URL — show direct add button instead
  if (isUrl(query)) {
    resultsEl.style.display  = 'none';
    directRow.style.display  = 'block';
    spinner.classList.remove('spinning');
    status.textContent       = '';
    return;
  }
  directRow.style.display  = 'none';
  resultsEl.style.display  = 'none';
  spinner.classList.add('spinning');
  status.textContent        = '';
  selectedSearchResult      = null;
  try {
    const results = await apiFetch(
      `/api/search?q=${encodeURIComponent(query)}&guildId=${selectedGuildId || ''}`
    );
    spinner.classList.remove('spinning');
    if (!results || results.length === 0) {
      resultsEl.style.display = 'block';
      resultsEl.innerHTML     = `<div class="search-no-results">No results found for "${esc(query)}"</div>`;
      return;
    }
    resultsEl.style.display = 'block';
    resultsEl.innerHTML     = results.map((r, i) => `
      <div class="search-result-item" data-index="${i}" data-url="${esc(r.url)}" data-title="${esc(r.title)}">
        <div class="sr-thumb">
          ${r.thumbnail
            ? `<img src="${esc(r.thumbnail)}" alt="" loading="lazy" />`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}
        </div>
        <div class="sr-info">
          <div class="sr-title">${esc(r.title)}</div>
          <div class="sr-duration">${esc(r.duration)}</div>
        </div>
        <button class="sr-add-btn" title="Add to queue">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
    `).join('');
    // Wire up result items
    resultsEl.querySelectorAll('.search-result-item').forEach(item => {
      // Click row → select it
      item.addEventListener('click', e => {
        if (e.target.closest('.sr-add-btn')) return; // handled below
        resultsEl.querySelectorAll('.search-result-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        selectedSearchResult = { url: item.dataset.url, title: item.dataset.title };
      });
      // Click + button → add directly
      item.querySelector('.sr-add-btn').addEventListener('click', async e => {
        e.stopPropagation();
        const btn = e.currentTarget;
        btn.style.opacity = '0.5';
        btn.disabled = true;
        await addSong(item.dataset.url, $('addStatus'), null, null);
        btn.style.opacity = '';
        btn.disabled = false;
      });
    });
    // Auto-select first
    const first = resultsEl.querySelector('.search-result-item');
    if (first) {
      first.classList.add('selected');
      selectedSearchResult = { url: first.dataset.url, title: first.dataset.title };
    }
  } catch (err) {
    spinner.classList.remove('spinning');
    resultsEl.style.display = 'block';
    resultsEl.innerHTML     = `<div class="search-no-results">Search failed: ${esc(err.message)}</div>`;
  }
}
// ─── PIN Lock ───────────────────────────────────
const PIN_CORRECT    = '1973';
const PIN_MGMT       = '120195';
const PIN_PUZZLE_ANS = 'A1B2C3';
const ROBOT_MS       = 80;   // keystroke gap below this = suspicious
let pinUnlocked     = false;   // stays true until page reload
let pinBuf          = '';      // current digits entered
let pinAttempts     = 0;       // wrong attempts
let pinKeytimes     = [];      // timestamps for robot detection
let pinMode         = 'pin';   // 'pin' | 'mgmt' | 'puzzle'
function openPinOverlay() {
  pinBuf = ''; pinKeytimes = [];
  pinMode = 'mgmt' === pinMode ? 'mgmt' : 'pin'; // preserve if already mgmt
  pinMode = 'pin';
  showPinState('pin');
  updateDots();
  $('pinAttempts').textContent = '';
  $('pinOverlay').style.display = 'flex';
}
function closePinOverlay() {
  $('pinOverlay').style.display = 'none';
  pinBuf = ''; pinKeytimes = [];
}
function showPinState(mode) {
  pinMode = mode;
  $('pinState').style.display   = mode === 'pin'    ? 'flex' : 'none';
  $('mgmtState').style.display  = mode === 'mgmt'   ? 'flex' : 'none';
  $('puzzleState').style.display= mode === 'puzzle' ? 'flex' : 'none';
  if (mode === 'mgmt')   { $('mgmtInput').value = '';   $('mgmtError').textContent = '';   setTimeout(() => $('mgmtInput').focus(),   80); }
  if (mode === 'puzzle') { $('puzzleInput').value = ''; $('puzzleError').textContent = ''; setTimeout(() => $('puzzleInput').focus(), 80); }
}
function shakePinBox() {
  const box = $('pinBox');
  box.classList.remove('shake');
  void box.offsetWidth; // reflow
  box.classList.add('shake');
  setTimeout(() => box.classList.remove('shake'), 500);
}
function updateDots() {
  for (let i = 0; i < 4; i++) {
    const dot = $(`d${i}`);
    if (dot) {
      dot.classList.toggle('filled', i < pinBuf.length);
      dot.classList.remove('error');
    }
  }
}
function flashErrorDots() {
  for (let i = 0; i < 4; i++) {
    const dot = $(`d${i}`);
    if (dot) {
      dot.classList.add('error');
      dot.classList.remove('filled');
    }
  }
  setTimeout(updateDots, 700);
}
function isRoboticInput() {
  if (pinKeytimes.length < 2) return false;
  for (let i = 1; i < pinKeytimes.length; i++) {
    if (pinKeytimes[i] - pinKeytimes[i-1] < ROBOT_MS) return true;
  }
  return false;
}
function pressDigit(d) {
  if (pinBuf.length >= 4) return;
  const now = Date.now();
  pinKeytimes.push(now);
  // Robot check after 2+ presses
  if (pinKeytimes.length >= 2 && isRoboticInput()) {
    pinBuf = '';
    showPinState('mgmt');
    return;
  }
  pinBuf += d;
  updateDots();
  if (pinBuf.length === 4) {
    setTimeout(checkPin, 120);
  }
}
function checkPin() {
  if (pinBuf === PIN_CORRECT) {
    // Correct!
    pinUnlocked = true;
    closePinOverlay();
    pinAttempts = 0;
    setView('settings');
    showToast('Settings unlocked ✓', 'success');
  } else {
    // Wrong
    pinAttempts++;
    flashErrorDots();
    shakePinBox();
    pinBuf = '';
    pinKeytimes = [];
    if (pinAttempts >= 3) {
      const banTime = Date.now() + 60 * 60 * 1000; // 1 hour
      localStorage.setItem('dlm_exec_ban_until', banTime.toString());
      pinAttempts = 0;
      showToast('3 wrong PINs! Settings BANNED for 1 hour.', 'error');
      pinUnlocked = false;
      closePinOverlay();
      setView('player');
      alert('You have entered the wrong PIN 3 times.\nSettings access is now BANNED for 1 hour.\nOnly the Executive PIN can unlock it early.');
    } else {
      const rem = 3 - pinAttempts;
      $('pinAttempts').textContent = `Incorrect PIN — ${rem} attempt${rem !== 1 ? 's' : ''} remaining`;
      setTimeout(updateDots, 700);
    }
  }
}
// Navigation
function setView(name) {
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.style.display = '';
  });
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const view   = $(`view-${name}`);
  const navBtn = $(`nav-${name}`);
  if (view) {
    view.style.display = 'block';
    requestAnimationFrame(() => requestAnimationFrame(() => view.classList.add('active')));
  }
  if (navBtn) navBtn.classList.add('active');
  const titles = { player: 'Player', queue: 'Queue', search: 'Add Songs', settings: 'Settings' };
  $('pageTitle').textContent = titles[name] || name;
  // Toggle Bottom Player Bar visibility (only on player view when not classic)
  const bb = document.querySelector('.bottom-player-bar');
  if (bb) {
    const isClassic = document.body.classList.contains('classic-ui');
    bb.style.display = (name === 'player' && !isClassic) ? 'flex' : 'none';
  }
}
// ─── Toast ──────────────────────────────────────
function showToast(message, type = 'info') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-dot"></span><span>${esc(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, 3500);
}
// ─── Utils ──────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTime(secs) {
  secs = Math.floor(Number(secs) || 0);
  return `${Math.floor(secs/60)}:${(secs%60).toString().padStart(2,'0')}`;
}
function parseDurationSecs(str) {
  if (!str) return 0;
  const parts = String(str).split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return 0;
}
// ─── Init ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('apiUrlInput').value = API_BASE_URL;
  // Navigation — intercept Settings with PIN lock
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === 'settings' && !pinUnlocked) {
        // Check if banned
        const banUntil = parseInt(localStorage.getItem('dlm_exec_ban_until') || '0', 10);
        const now = Date.now();
        if (banUntil > now) {
          const mins = Math.ceil((banUntil - now) / 60000);
          showToast(`Settings locked for ${mins} more minutes.`, 'error');
          const execOverride = prompt(`Settings are BANNED for ${mins} more minute(s).\n\nEnter Executive PIN to unlock immediately:`);
          if (execOverride === '19731975') {
            localStorage.removeItem('dlm_exec_ban_until');
            pinUnlocked = true;
            setView('settings');
            showToast('Executive override — Settings unlocked!', 'success');
          } else if (execOverride !== null) {
            showToast('Wrong Executive PIN.', 'error');
          }
          return;
        }
        openPinOverlay();
        return;
      }
      // Re-lock settings when leaving it
      if (view !== 'settings') pinUnlocked = false;
      setView(view);
      if (window.innerWidth <= 768) $('sidebar').classList.remove('open');
    });
  });
  // PIN Keypad
  document.querySelectorAll('.pin-key[data-digit]').forEach(btn => {
    btn.addEventListener('click', () => pressDigit(btn.dataset.digit));
  });
  $('pinClear').addEventListener('click', () => { pinBuf = ''; pinKeytimes = []; updateDots(); $('pinAttempts').textContent = ''; });
  $('pinDel').addEventListener('click', () => { if (pinBuf.length) { pinBuf = pinBuf.slice(0, -1); pinKeytimes.pop(); updateDots(); } });
  $('pinCancel').addEventListener('click', closePinOverlay);
  // Physical keyboard support for PIN (digits only, no speed bypassing)
  document.addEventListener('keydown', e => {
    if ($('pinOverlay').style.display === 'none') return;
    if (pinMode !== 'pin') return;
    if (e.key >= '0' && e.key <= '9') pressDigit(e.key);
    if (e.key === 'Backspace') { if (pinBuf.length) { pinBuf = pinBuf.slice(0,-1); pinKeytimes.pop(); updateDots(); } }
    if (e.key === 'Escape') closePinOverlay();
  });
  // Management PIN
  $('mgmtSubmit').addEventListener('click', () => {
    const val = $('mgmtInput').value.trim();
    if (val === PIN_MGMT) {
      pinAttempts = 0; pinBuf = ''; pinKeytimes = [];
      showPinState('pin');
      updateDots();
      showToast('Management access granted', 'info');
    } else {
      $('mgmtError').textContent = 'Incorrect management PIN';
      $('mgmtInput').value = '';
      shakePinBox();
    }
  });
  $('mgmtInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('mgmtSubmit').click(); });
  // Puzzle verify
  $('puzzleSubmit').addEventListener('click', () => {
    const val = $('puzzleInput').value.trim();
    if (val === PIN_PUZZLE_ANS) {
      pinAttempts = 0; pinBuf = ''; pinKeytimes = [];
      showPinState('pin');
      updateDots();
      showToast('Puzzle solved — try your PIN again', 'info');
    } else {
      $('puzzleError').textContent = 'Incorrect — type exactly: A1B2C3';
      $('puzzleInput').value = '';
      shakePinBox();
    }
  });
  $('puzzleInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('puzzleSubmit').click(); });
  // Guild select
  $('guildSelect').addEventListener('change', e => {
    selectedGuildId = e.target.value || null;
    if (selectedGuildId) localStorage.setItem('dlm_guild_id', selectedGuildId);
    stopPolling(); nowPlayingData = null; queueData = [];
    updateNowPlaying(null); renderQueue(); refreshButtonStates();
    if (selectedGuildId) startPolling();
  });
  // Playback controls
  $('btnPlayPause').addEventListener('click', handlePlayPause);
  $('btnSkip').addEventListener('click', handleSkip);
  $('btnStop').addEventListener('click', handleStop);
  $('clearQueueBtn').addEventListener('click', handleClearQueue);
  $('shuffleQueueBtn').addEventListener('click', handleShuffle);
  // Quick Play (Player tab)
  $('quickPlayForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('quickSearchInput');
    await addSong(input.value, null, input, $('quickAddBtn'));
  });
  const qpfNew = $('quickPlayFormNew');
  if (qpfNew) {
    qpfNew.addEventListener('submit', async e => {
      e.preventDefault();
      const input = $('quickSearchInputNew');
      const added = await addSong(input.value, null, input, $('quickAddBtnNew'));
      if (added) qpfNew.style.display = 'none'; // hide after add
    });
  }
  // "Add song" toggle button in Quick Queue header
  const quickAddOpenBtn = $('quickAddOpenBtn');
  if (quickAddOpenBtn && qpfNew) {
    quickAddOpenBtn.addEventListener('click', () => {
      const visible = qpfNew.style.display !== 'none';
      qpfNew.style.display = visible ? 'none' : 'flex';
      if (!visible) $('quickSearchInputNew').focus();
    });
  }
  // "View full queue" link navigates to Queue tab
  const viewAllBtn = $('quickQueueViewAll');
  if (viewAllBtn) {
    viewAllBtn.addEventListener('click', () => setView('queue'));
  }
  // Bottom Bar Controls
  const bbPlayPause = $('bbBtnPlayPause');
  if (bbPlayPause) bbPlayPause.addEventListener('click', handlePlayPause);
  const bbSkip = $('bbBtnSkip');
  if (bbSkip) bbSkip.addEventListener('click', handleSkip);
  const bbStop = $('bbBtnStop');
  if (bbStop) bbStop.addEventListener('click', handleStop);
  // Speed and Pitch: input for instant UI, change for API call to avoid spam
  const speedSlider = $('bbSpeedSlider');
  const speedVal = $('bbSpeedVal');
  if (speedSlider) {
    speedSlider.addEventListener('input', e => {
      speedVal.textContent = parseFloat(e.target.value).toFixed(2) + 'x';
    });
    speedSlider.addEventListener('change', async e => {
      const val = e.target.value;
      if (!selectedGuildId) return;
      try {
        await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/speed?guildId=${selectedGuildId}&val=${val}`, { headers: { 'ngrok-skip-browser-warning': 'true' }});
      } catch (err) { console.error(err); }
    });
  }
  
  const pitchSlider = $('bbPitchSlider');
  const pitchVal = $('bbPitchVal');
  if (pitchSlider) {
    pitchSlider.addEventListener('input', e => {
      pitchVal.textContent = parseFloat(e.target.value).toFixed(2) + 'x';
    });
    pitchSlider.addEventListener('change', async e => {
      const val = e.target.value;
      if (!selectedGuildId) return;
      try {
        await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/pitch?guildId=${selectedGuildId}&val=${val}`, { headers: { 'ngrok-skip-browser-warning': 'true' }});
      } catch (err) { console.error(err); }
    });
  }
  // Volume slider and mute toggle
  const volBtn = $('bbVolBtn');
  const volSlider = $('bbVolumeSlider');
  if (volSlider) {
    volSlider.addEventListener('mousedown', () => { volSliderActive = true; });
    volSlider.addEventListener('mouseup', () => { volSliderActive = false; });
    volSlider.addEventListener('touchstart', () => { volSliderActive = true; });
    volSlider.addEventListener('touchend', () => { volSliderActive = false; });
    volSlider.addEventListener('input', e => {
      const val = parseInt(e.target.value, 10);
      $('bbVolumeVal').textContent = val + '%';
      if (val > 0) {
        isMuted = false;
        currentVolume = val;
      } else {
        isMuted = true;
      }
      updateVolumeButtons();
    });
    volSlider.addEventListener('change', e => {
      const val = parseInt(e.target.value, 10);
      sendVolumeChange(val);
    });
  }
  if (volBtn) {
    volBtn.addEventListener('click', () => {
      if (isMuted) {
        isMuted = false;
        currentVolume = preMuteVolume > 0 ? preMuteVolume : 100;
        sendVolumeChange(currentVolume);
      } else {
        preMuteVolume = currentVolume;
        isMuted = true;
        currentVolume = 0;
        sendVolumeChange(0);
      }
      updateVolumeUI();
    });
  }
  // Return to Old Player UI Toggle
  const toggleUiBtn = $('toggleUiBtn');
  if (toggleUiBtn) {
    let isClassicUi = localStorage.getItem('dlm_classic_ui') === 'true';
    if (isClassicUi) document.body.classList.add('classic-ui');
    
    toggleUiBtn.addEventListener('click', () => {
      isClassicUi = !document.body.classList.contains('classic-ui');
      if (isClassicUi) {
        document.body.classList.add('classic-ui');
        toggleUiBtn.textContent = 'Switch to New UI';
        localStorage.setItem('dlm_classic_ui', 'true');
        const bb = document.querySelector('.bottom-player-bar');
        if (bb) bb.style.display = 'none';
      } else {
        document.body.classList.remove('classic-ui');
        toggleUiBtn.textContent = 'Switch to Old UI';
        localStorage.setItem('dlm_classic_ui', 'false');
        const bb = document.querySelector('.bottom-player-bar');
        const activeNav = document.querySelector('.nav-item.active');
        const currentView = activeNav ? activeNav.dataset.view : 'player';
        if (bb && currentView === 'player') bb.style.display = 'flex';
      }
    });
    // Init button text
    if (isClassicUi) toggleUiBtn.textContent = 'Switch to New UI';
    else toggleUiBtn.textContent = 'Switch to Old UI';
  }
  // Top Nav search bar wiring
  const topNavSearch = $('topNavSearch');
  if (topNavSearch) {
    topNavSearch.addEventListener('input', e => {
      const q = e.target.value.trim();
      if (!q) return;
      setView('search');
      const songInput = $('songInput');
      if (songInput) {
        songInput.value = q;
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => doSearch(q), 600);
      }
    });
  }
  // Add Songs — search input with debounce
  $('songInput').addEventListener('input', e => {
    const q = e.target.value.trim();
    clearTimeout(searchDebounce);
    if (!q) {
      $('searchResults').style.display = 'none';
      $('directAddRow').style.display  = 'none';
      $('searchSpinner').classList.remove('spinning');
      return;
    }
    searchDebounce = setTimeout(() => doSearch(q), 600);
  });
  // MP3 file upload
  const mp3Input = $('mp3FileInput');
  if (mp3Input) {
    mp3Input.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!selectedGuildId) { showToast('Select a server first!', 'error'); mp3Input.value = ''; return; }
      const statusEl = $('mp3UploadStatus');
      statusEl.textContent = `⏳ Uploading ${file.name}...`;
      statusEl.className = 'mp3-upload-status info';
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('guildId', selectedGuildId);
        const url = API_BASE_URL.replace(/\/$/, '') + '/api/upload-mp3';
        const res = await fetch(url, { method: 'POST', body: formData, headers: { 'ngrok-skip-browser-warning': 'true' } });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}`);
        }
        statusEl.textContent = `✓ ${file.name} added to queue!`;
        statusEl.className = 'mp3-upload-status success';
        setTimeout(() => { statusEl.textContent = ''; }, 4000);
        setTimeout(pollQueue, 800);
      } catch (err) {
        statusEl.textContent = `✗ Upload failed: ${err.message}`;
        statusEl.className = 'mp3-upload-status error';
      }
      mp3Input.value = '';
    });
  }
  // Direct URL add button
  $('addSongBtn').addEventListener('click', async () => {
    const q = $('songInput').value.trim();
    if (!q) return;
    await addSong(q, $('addStatus'), $('songInput'), $('addSongBtn'));
    $('searchResults').style.display = 'none';
    $('directAddRow').style.display  = 'none';
    selectedSearchResult = null;
  });
  // Settings
  $('saveApiBtn').addEventListener('click', () => {
    const url = $('apiUrlInput').value.trim();
    if (!url) { showToast('Enter a URL first', 'error'); return; }
    API_BASE_URL = url;
    localStorage.setItem('dlm_api_url', url);
    showToast('Saved ✓', 'success');
    stopPolling(); nowPlayingData = null; selectedGuildId = null;
    loadGuilds();
  });
  // Executive PIN for Global URL change
  const EXEC_PIN = '19731975';
  const EXEC_BAN_KEY = 'dlm_exec_ban_until';
  let execPinAttempts = 0;
  const execApiBtn = $('execApiBtn');
  if (execApiBtn) {
    execApiBtn.addEventListener('click', () => {
      // Check if banned
      const banUntil = parseInt(localStorage.getItem(EXEC_BAN_KEY) || '0', 10);
      const now = Date.now();
      if (banUntil > now) {
        const mins = Math.ceil((banUntil - now) / 60000);
        showToast(`Settings locked for ${mins} more minutes.`, 'error');
        // Offer executive override (Do NOT show the code in the prompt)
        const execOverride = prompt(`Settings are BANNED for ${mins} more minute(s).\n\nEnter Executive PIN to unlock immediately:`);
        if (execOverride === EXEC_PIN) {
          localStorage.removeItem(EXEC_BAN_KEY);
          execPinAttempts = 0;
          showToast('Executive override — Settings unlocked!', 'success');
        } else if (execOverride) {
          showToast('Wrong Executive PIN.', 'error');
        }
        return;
      }
      // Ask for Executive PIN (Do NOT show the code in the prompt)
      const pin = prompt('Enter Executive PIN to change the Global API URL:');
      if (pin === null) return; // cancelled
      if (pin === EXEC_PIN) {
        execPinAttempts = 0;
        const url = prompt('EXECUTIVE ACCESS GRANTED ✓\n\nEnter the new Global Bot API URL for all users:', API_BASE_URL);
        if (url && url.trim()) {
          const clean = url.trim();
          API_BASE_URL = clean;
          localStorage.setItem('dlm_api_url', clean);
          $('apiUrlInput').value = clean;
          stopPolling(); nowPlayingData = null; selectedGuildId = null;
          loadGuilds();
          showToast('Global API URL updated! Remember to also update app.js on GitHub to make it permanent.', 'success');
          setTimeout(() => alert('To make this permanent for ALL users:\n\nEdit app.js on GitHub and change line 7 to:\n\nlet API_BASE_URL = localStorage.getItem(\'dlm_api_url\') || \'' + clean + '\';'), 500);
        }
      } else {
        execPinAttempts++;
        if (execPinAttempts >= 3) {
          const banTime = Date.now() + 60 * 60 * 1000; // 1 hour
          localStorage.setItem(EXEC_BAN_KEY, banTime.toString());
          execPinAttempts = 0;
          showToast('3 wrong PINs! Settings BANNED for 1 hour.', 'error');
          // Force them out of settings
          pinUnlocked = false;
          setView('player');
          alert('You have entered the wrong Executive PIN 3 times.\nSettings access is now BANNED for 1 hour.\nOnly the Executive PIN can unlock it early.');
        } else {
          const remaining = 3 - execPinAttempts;
          showToast(`Wrong Executive PIN — ${remaining} attempt${remaining !== 1 ? 's' : ''} left before 1hr ban!`, 'error');
        }
      }
    });
  }
  $('testApiBtn').addEventListener('click', async () => {
    const url    = $('apiUrlInput').value.trim() || API_BASE_URL;
    const result = $('apiTestResult');
    result.className = 'test-result'; result.textContent = 'Testing...';
    try {
      const res = await fetch(url.replace(/\/$/, '') + '/api/health', { headers: { 'ngrok-skip-browser-warning': 'true' } });
      if (res.ok) { result.className = 'test-result success'; result.textContent = '✓ Connection successful!'; }
      else throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      result.className = 'test-result error'; result.textContent = `✗ Failed — ${err.message}`;
    }
  });
  // Clear Recently Played History button (Inside Settings, not PIN-protected)
  const clearRecentBtn = $('clearRecentBtn');
  if (clearRecentBtn) {
    clearRecentBtn.addEventListener('click', () => {
      recentlyPlayed = [];
      localStorage.setItem('dlm_recently_played', JSON.stringify([]));
      renderRecentlyPlayed();
      showToast('Recently Played history cleared 🗑️', 'info');
    });
  }
  // Sidebar toggle
  $('sidebarToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  document.addEventListener('click', e => {
    const sb = $('sidebar'), tog = $('sidebarToggle');
    if (window.innerWidth <= 768 && sb.classList.contains('open')
        && !sb.contains(e.target) && !tog.contains(e.target)) sb.classList.remove('open');
  });
  // Boot
  refreshButtonStates();
  renderRecentlyPlayed();
  setView('player');
  loadGuilds();
});