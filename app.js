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
  if (online) {
    if (localStorage.getItem('dlm_image_blobs_enabled') === 'true') {
      $('statusText').textContent = 'Easter Egg Enabled: To Disable, use PIN 8008 in Admin Settings';
    } else {
      $('statusText').textContent = 'Connected';
    }
  } else {
    $('statusText').textContent = 'Offline';
  }
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
  artist.textContent = np.artist || np.author || 'Unknown Artist';
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
  
  const speed = parseFloat($('bbSpeedSlider') ? $('bbSpeedSlider').value : 1.0) || 1.0;
  const durationSecs = parseDurationSecs(np.duration) / speed;
  const pos = (Number(np.position) || 0) / speed;
  const pct = durationSecs > 0 ? Math.min(100, (pos / durationSecs) * 100) : 0;
  fill.style.width    = pct.toFixed(1) + '%';
  curTime.textContent = formatTime(pos);
  totTime.textContent = formatTime(durationSecs);
  const iconPlay  = $('iconPlay');
  const iconPause = $('iconPause');
  iconPlay.style.display  = np.paused ? '' : 'none';
  iconPause.style.display = np.paused ? 'none' : '';
  // Bottom Bar Updates
  $('bbTitle').textContent = np.title || 'Unknown Track';
  $('bbArtist').textContent = np.artist || np.author || 'Unknown Artist';
  if (np.thumbnail) {
    $('bbArtImg').src = np.thumbnail;
    $('bbArtImg').style.display = 'block';
    $('bbArtPlaceholder').style.display = 'none';
  } else {
    $('bbArtImg').style.display = 'none';
    $('bbArtPlaceholder').style.display = 'flex';
  }
  $('bbCurTime').textContent = formatTime(pos);
  $('bbTotTime').textContent = formatTime(durationSecs);
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
function isMp3Track(track) {
  const url = String((track && track.url) || '').toLowerCase();
  return url.endsWith('.mp3') || url.includes('.mp3?') || url.includes('dlm_upload_');
}
let recentlyPlayed = JSON.parse(localStorage.getItem('dlm_recently_played') || '[]');
// Clean up old entries on load
recentlyPlayed = recentlyPlayed.filter(t => Date.now() - t.timestamp < SEVEN_DAYS_MS && !isMp3Track(t));
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
  if (!np || !np.title || np.isLocalMp3 || isMp3Track(np)) return;
  
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
        <button class="remove-recent-btn" data-index="${i}" title="Remove from history">&times;</button>
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
    card.addEventListener('click', (e) => {
      if (e.target.closest('.remove-recent-btn')) {
        e.stopPropagation();
        const idx = parseInt(e.target.closest('.remove-recent-btn').dataset.index, 10);
        recentlyPlayed.splice(idx, 1);
        localStorage.setItem('dlm_recently_played', JSON.stringify(recentlyPlayed));
        renderRecentlyPlayed();
        return;
      }
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
// ─── Favorites (stored locally for this dashboard) ────────────────────────
let favorites = JSON.parse(localStorage.getItem('dlm_favorites') || '[]');
function isFavorite(track) {
  return !!track && favorites.some(f => f.url && f.url === track.url);
}
function renderFavorites() {
  const container = $('favoritesContainer');
  if (!container) return;
  if (!favorites.length) {
    container.innerHTML = '<div class="empty-state-small">Use the heart in the player bar to save a favorite</div>';
    return;
  }
  container.innerHTML = favorites.map((track, i) => `
    <div class="recent-card" data-index="${i}">
      <button class="remove-recent-btn fav-remove" data-index="${i}" title="Remove from favorites">&times;</button>
      <div class="recent-art">${track.thumbnail ? `<img src="${esc(track.thumbnail)}" alt="" />` : ''}<div class="recent-play-hover">▶</div></div>
      <div class="recent-info"><div class="recent-title">${esc(track.title || 'Unknown')}</div></div>
    </div>`).join('');
  container.querySelectorAll('.recent-card').forEach(card => card.addEventListener('click', (e) => {
    if (e.target.closest('.fav-remove')) {
      e.stopPropagation();
      const idx = Number(e.target.closest('.fav-remove').dataset.index);
      favorites.splice(idx, 1);
      localStorage.setItem('dlm_favorites', JSON.stringify(favorites));
      renderFavorites();
      updateFavoriteButton();
      return;
    }
    const track = favorites[Number(card.dataset.index)];
    if (track) addSong(track.url || track.title, null, null, null);
  }));
}
function toggleFavorite() {
  if (!nowPlayingData) return;
  const track = { title: nowPlayingData.title, url: nowPlayingData.url || '', thumbnail: nowPlayingData.thumbnail || '', duration: nowPlayingData.duration || '' };
  const index = favorites.findIndex(f => f.url && f.url === track.url);
  if (index >= 0) {
    favorites.splice(index, 1);
    showToast('Removed from favorites', 'info');
  } else {
    favorites.unshift(track);
    showToast('Added to favorites', 'success');
  }
  localStorage.setItem('dlm_favorites', JSON.stringify(favorites));
  renderFavorites();
  updateFavoriteButton();
}
function updateFavoriteButton() {
  const button = $('bbFavoriteBtn');
  if (!button) return;
  button.disabled = !nowPlayingData;
  button.classList.toggle('active', isFavorite(nowPlayingData));
  button.title = isFavorite(nowPlayingData) ? 'Remove current song from favorites' : 'Add current song to favorites';
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
  updateFavoriteButton();
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
        <span>Add songs using Quick Play or the Add Songs tab</span>
      </div>`;
  } else {
  list.innerHTML = queueData.map((track, i) => `
    <div class="queue-item" data-index="${i}" draggable="true">
      <span class="queue-drag-handle" title="Drag to reorder">☰</span>
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
  let dragIndex = null;
  list.querySelectorAll('.queue-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      dragIndex = Number(item.dataset.index);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      dragIndex = null;
      list.querySelectorAll('.queue-item').forEach(el => el.classList.remove('dragging', 'drag-over'));
    });
    item.addEventListener('dragover', e => { e.preventDefault(); if (Number(item.dataset.index) !== dragIndex) item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', async e => {
      e.preventDefault();
      const to = Number(item.dataset.index);
      item.classList.remove('drag-over');
      if (dragIndex === null || dragIndex === to) return;
      try {
        await apiFetch('/api/queue/move', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId, from: dragIndex, to }) });
        const moved = queueData.splice(dragIndex, 1)[0];
        queueData.splice(to, 0, moved);
        renderQueue();
      } catch (err) { showToast('Could not move track: ' + err.message, 'error'); pollQueue(); }
    });
  });
  }
  // Also render for the small quick queue list (top 5 only)
  const smallList = $('quickQueueList');
  const queueBadge = $('queueBadge');
  if (queueBadge) queueBadge.textContent = `${queueData.length} track${queueData.length !== 1 ? 's' : ''}`;
  if (smallList) {
    if (queueData.length === 0) {
      smallList.innerHTML = `<div class="empty-state-small">Nothing in the queue</div>`;
    } else {
      const top5 = queueData.slice(0, 3);
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
  
  let finalQuery = queryOrUrl.trim();
  // Force URLs through BlueSteelAI heuristic so iTunes metadata isn't lost
  if (/^https?:\/\//i.test(finalQuery) && !finalQuery.startsWith('premiumsearch:')) {
    finalQuery = 'premiumsearch:' + finalQuery;
  }

  if (btnEl)    btnEl.disabled    = true;
  if (statusEl) { statusEl.className = 'add-status loading'; statusEl.textContent = 'Adding to queue...'; }
  try {
    await apiFetch('/api/queue/add', {
      method: 'POST',
      body: JSON.stringify({ guildId: selectedGuildId, query: finalQuery }),
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
  function triggerTadcEasterEgg() {
    // We create a custom toast so we can easily inject Kinger inside it
    const container = $('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast success';
    toast.style.position = 'relative'; 
    toast.style.overflow = 'visible'; 
    toast.innerHTML = `<span class="toast-dot"></span><span style="z-index: 2; position: relative;">Watch TADC anywhere! Visit: <a href="https://wackytadc.github.io" target="_blank" style="color: var(--accent-1); text-decoration: underline; font-weight: bold;">wackytadc.github.io</a></span>`;
    
    container.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 6000);
  }

  function isUrl(str) {
  return str.startsWith('http://') || str.startsWith('https://');
}
async function doSearch(query, pure = false) {
    if (query) {
      const qLower = query.trim().toLowerCase();
      if (qLower === 'tadc' || qLower === 'the amazing digital circus') {
        triggerTadcEasterEgg();
      }
    }
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
      `/api/search?q=${encodeURIComponent(query)}&guildId=${selectedGuildId || ''}&pure=${pure}`
    );
    spinner.classList.remove('spinning');
    if (!results || results.length === 0) {
      resultsEl.style.display = 'block';
      resultsEl.innerHTML     = `<div class="search-no-results">No results found for "${esc(query)}"</div>`;
      return;
    }
    
    let finalResults = results;
    // With the new Wikipedia AI, the backend explicitly tells us if it's a song!
    const isSongSearch = results.some(r => r.isSong === true);
    
    if (isSongSearch) {
      // It's a song! Attempt an Exact Match on the Title
      let bestMatch = results.find(r => r.title.toLowerCase() === query.toLowerCase());
      if (!bestMatch) {
        // Fallback to the first track that successfully got iTunes metadata
        bestMatch = results.find(r => r.thumbnail && r.thumbnail.includes('mzstatic')) || results[0];
      }
      // Put the best match at the top, but still show up to 4 alternatives in case YouTube/Heuristics picked a mashup
      finalResults = [bestMatch, ...results.filter(r => r !== bestMatch)].slice(0, 5);
    } else {
      // Other media -> 5 media types
      finalResults = results.slice(0, 5);
    }

    resultsEl.style.display = 'block';
    
    const renderItem = (r, i) => `
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
    `;

    let html = '';
    if (isSongSearch && finalResults.length > 1) {
      html += renderItem(finalResults[0], 0);
      html += `
        <div style="margin-top: 10px; margin-bottom: 10px; text-align: center;">
          <button class="ghost-btn" id="showAltBtn" style="width: 100%;">Wrong Song? Show Alternatives</button>
        </div>
        <div id="altResultsContainer" style="display: none;">
          ${finalResults.slice(1).map((r, i) => renderItem(r, i + 1)).join('')}
        </div>
      `;
    } else {
      html += finalResults.map((r, i) => renderItem(r, i)).join('');
    }
    
    if (!pure) {
      html += `
      <div style="margin-top: 15px; text-align: center;">
        <button class="ghost-btn" id="pureSearchBtn" style="width: 100%;">Looking for other media?</button>
      </div>`;
    }
    resultsEl.innerHTML = html;
    
    if (isSongSearch && finalResults.length > 1) {
      const showAltBtn = resultsEl.querySelector('#showAltBtn');
      const altContainer = resultsEl.querySelector('#altResultsContainer');
      if (showAltBtn && altContainer) {
        showAltBtn.addEventListener('click', () => {
          altContainer.style.display = 'block';
          showAltBtn.style.display = 'none';
        });
      }
    }

    if (!pure) {
      const pureBtn = resultsEl.querySelector('#pureSearchBtn');
      if (pureBtn) {
        pureBtn.addEventListener('click', () => {
           doSearch(query, true);
        });
      }
    }

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
const PIN_CORRECT    = 'MTk3Mw==';
const PIN_MGMT       = 'MTIwMTk1';
const PIN_PUZZLE_ANS = 'QTFCMkMz';
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
  // Keep the player dashboard from showing through while Settings is locked.
  document.querySelector('.app-shell').style.visibility = 'hidden';
  
  // Injected: Force hide bottom bar
  const bb = document.querySelector('.bottom-player-bar');
  if (bb) bb.style.display = 'none';
}

function closePinOverlay() {
  $('pinOverlay').style.display = 'none';
  document.querySelector('.app-shell').style.visibility = '';
  pinBuf = ''; pinKeytimes = [];
  
  // Injected: Restore bottom bar only if in player view and not classic
  const bb = document.querySelector('.bottom-player-bar');
  const isClassic = document.body.classList.contains('classic-ui');
  const activeNav = document.querySelector('.nav-item.active');
  const currentView = activeNav ? activeNav.dataset.view : 'player';

  if (bb && currentView === 'player' && !isClassic) {
    bb.style.display = 'flex';
  }
}

function showPinState(mode) {
  pinMode = mode;
  $('pinState').style.display    = mode === 'pin'    ? 'flex' : 'none';
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
  // Robot check after 2+ presses (allow fast 8008 typing)
  if (pinKeytimes.length >= 2 && isRoboticInput() && !'8008'.startsWith(pinBuf + d)) {
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
  if (pinBuf === '8008' && localStorage.getItem('dlm_image_blobs_enabled') === 'true') {
    localStorage.removeItem('dlm_image_blobs_enabled');
    closePinOverlay();
    pinBuf = '';
    pinKeytimes = [];
    showToast('Easter Egg Deactivated. Reloading...', 'info');
    setTimeout(() => window.location.reload(), 500);
    return;
  }

  if (btoa(pinBuf) === PIN_CORRECT) {
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
}// Navigation
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
  const titles = { player: 'Player', queue: 'Queue', search: 'Add Songs', favorites: localStorage.getItem('dlm_locale') === 'american' ? 'Favorites' : 'Favourites', 'user-settings': 'User Settings', settings: 'Settings' };
  $('pageTitle').textContent = titles[name] || name;
  // Toggle Bottom Player Bar visibility (only on player view when not classic)
    const bb = document.querySelector('.bottom-player-bar');
    if (bb) {
      const isClassic = document.body.classList.contains('classic-ui');
      if (isClassic) {
        bb.style.display = 'none';
      } else {
        if (name === 'player') {
          bb.classList.remove('bb-exit-anim');
          if (bb.style.display === 'none' || !bb.classList.contains('bb-enter-anim')) {
             bb.classList.add('bb-enter-anim');
          }
          bb.style.display = 'flex';
        } else if (name === 'settings') {
          bb.classList.remove('bb-exit-anim');
          bb.classList.remove('bb-enter-anim');
          bb.style.display = 'none';
        } else {
          if (bb.style.display === 'flex' && !bb.classList.contains('bb-exit-anim')) {
            bb.classList.remove('bb-enter-anim');
            bb.classList.add('bb-exit-anim');
            setTimeout(() => {
              const active = document.querySelector('.nav-item.active');
              if (active && active.dataset.view !== 'player') {
                bb.style.display = 'none';
              }
            }, 400);
          } else if (bb.style.display !== 'flex') {
            bb.style.display = 'none';
          }
        }
      }
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

// Init
document.addEventListener('DOMContentLoaded', () => {
  // Onboarding System
  const onboardingCompleted = localStorage.getItem('dlm_onboarding_completed') === 'true';
  const onboardingModal = $('onboardingModal');
  
  // Update Log Modal v2.2
  const updateLogSeen = localStorage.getItem('v2.2_update_seen');
  const updateLogModal = $('updateLogModal');
  const closeUpdateModalBtn = $('closeUpdateModalBtn');
  const playCelebrationBtn = $('playCelebrationBtn');
  
  if (onboardingModal && !onboardingCompleted) {
    onboardingModal.style.display = 'flex';
    
    const step1 = $('onboardingStep1');
    const step2 = $('onboardingStep2');
    const step3 = $('onboardingStep3');
    
    $('obNextToAccountBtn').addEventListener('click', () => {
      step1.style.display = 'none';
      step2.style.display = 'block';
    });
    
    $('obMakeAccountBtn').addEventListener('click', () => {
      const authM = $('authModal');
      if (authM) authM.style.display = 'flex';
      step2.style.display = 'none';
      step3.style.display = 'block';
    });
    
    $('obSkipAccountBtn').addEventListener('click', () => {
      step2.style.display = 'none';
      step3.style.display = 'block';
    });
    
    $('obFinishBtn').addEventListener('click', () => {
      localStorage.setItem('dlm_onboarding_completed', 'true');
      onboardingModal.style.display = 'none';
      if (!updateLogSeen && updateLogModal) {
        updateLogModal.style.display = 'flex';
        localStorage.setItem('v2.2_update_seen', 'true');
      }
    });
  } else if (!updateLogSeen && updateLogModal) {
    updateLogModal.style.display = 'flex';
    localStorage.setItem('v2.2_update_seen', 'true');
  }

  // Auth System Logic
  const authModal = $('authModal');
  const authTabLogin = $('authTabLogin');
  const authTabRegister = $('authTabRegister');
  const authLoginForm = $('authLoginForm');
  const authRegisterForm = $('authRegisterForm');
  const authModalTitle = $('authModalTitle');

  if (authTabLogin && authTabRegister) {
    authTabLogin.addEventListener('click', () => {
      authTabLogin.className = 'gradient-btn';
      authTabRegister.className = 'ghost-btn';
      authLoginForm.style.display = 'flex';
      authRegisterForm.style.display = 'none';
      authModalTitle.textContent = 'Welcome Back';
    });

    authTabRegister.addEventListener('click', () => {
      authTabRegister.className = 'gradient-btn';
      authTabLogin.className = 'ghost-btn';
      authRegisterForm.style.display = 'flex';
      authLoginForm.style.display = 'none';
      authModalTitle.textContent = 'Create an Account';
    });
  }

  // ToS Checkbox Logic
  const tosCheckbox = $('tosCheckbox');
  const registerSubmitBtn = $('registerSubmitBtn');
  if (tosCheckbox && registerSubmitBtn) {
    tosCheckbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        registerSubmitBtn.style.opacity = '1';
        registerSubmitBtn.style.pointerEvents = 'auto';
      } else {
        registerSubmitBtn.style.opacity = '0.5';
        registerSubmitBtn.style.pointerEvents = 'none';
      }
    });
  }

  // ToS Modal Logic
  const tosModal = $('tosModal');
  const openTosBtn = $('openTosBtn');
  const closeTosModalBtn = $('closeTosModalBtn');

  if (openTosBtn && tosModal) {
    openTosBtn.addEventListener('click', (e) => {
      e.preventDefault();
      tosModal.style.display = 'flex';
    });
  }
  if (closeTosModalBtn && tosModal) {
    closeTosModalBtn.addEventListener('click', () => {
      tosModal.style.display = 'none';
    });
  }

  // Modals Submit & Close
  if ($('closeAuthModalBtn') && authModal) {
    $('closeAuthModalBtn').addEventListener('click', () => {
      authModal.style.display = 'none';
    });
  }

  // Dynamic Greeting Logic
  const dynamicGreeting = $('dynamicGreeting');
  const holidayToggleBtn = $('holidayToggleBtn');

  // Load holiday toggle preference
  const holidayEnabled = localStorage.getItem('dlm_holiday_enabled') !== 'false';
  if (holidayToggleBtn) {
    holidayToggleBtn.checked = holidayEnabled;
    holidayToggleBtn.addEventListener('change', (e) => {
      localStorage.setItem('dlm_holiday_enabled', e.target.checked);
      updateGreeting();
      if (typeof window.syncSettingsToCloud === 'function') window.syncSettingsToCloud();
    });
  }

  function updateGreeting() {
    if (!dynamicGreeting) return;
    const rawUsername = localStorage.getItem('dlm_username') || '';
    
    // Guard against literal "undefined" string or empty
    if (!rawUsername || rawUsername === 'undefined') {
      dynamicGreeting.style.display = 'none';
      return;
    }
    dynamicGreeting.style.display = 'block';

    const hour = new Date().getHours();
    let nameToUse = rawUsername;

    let templates = [];
    if (hour >= 5 && hour < 12) {
      if (rawUsername && Math.random() < 0.05) nameToUse = "Early Bird";
      templates = ["Good morning, USER!", "Mornin' USER!", "What's up, USER?"];
    } else if (hour >= 12 && hour < 17) {
      templates = ["Good afternoon, USER!", "How you doing, USER?", "Welcome, USER!"];
    } else if (hour >= 17 && hour < 22) {
      templates = ["Good evening, USER!", "How are you, USER?", "Exhausting Day, USER!"];
    } else {
      if (rawUsername && Math.random() < 0.05) nameToUse = "Night Owl";
      templates = ["Goodnight, USER!", "Ready to Sleep, USER?", "Musical Dreams, USER!"];
    }

    let rawGreeting = templates[Math.floor(Math.random() * templates.length)];
    let greeting = rawGreeting.replace(/USER/g, nameToUse);

    // Holiday & Birthday Logic
    const isHolidayEnabled = localStorage.getItem('dlm_holiday_enabled') !== 'false';
    const month = new Date().getMonth();
    const date = new Date().getDate();
    
    if (isHolidayEnabled) {
      if (month === 9 && date === 31) greeting = `Happy Halloween, ${rawUsername}!`;
      else if (month === 11 && date === 25) greeting = `Merry Christmas, ${rawUsername}!`;
      
      const birthday = localStorage.getItem('dlm_birthday');
      if (birthday) {
        let bMonth = -1, bDate = -1;
        if (birthday.includes('/')) {
          const p = birthday.split('/');
          bDate = parseInt(p[0], 10);
          bMonth = parseInt(p[1], 10) - 1;
        } else if (birthday.includes('-')) {
          const p = birthday.split('-');
          if (p.length === 3) {
            bMonth = parseInt(p[1], 10) - 1;
            bDate = parseInt(p[2], 10);
          } else if (p.length === 2) {
            bDate = parseInt(p[0], 10);
            bMonth = parseInt(p[1], 10) - 1;
          }
        }
        if (bMonth === month && bDate === date) {
          greeting = `Happy Birthday, ${rawUsername}!`;
        }
      }
    }

    dynamicGreeting.textContent = greeting;
  }
  updateGreeting();
  setInterval(updateGreeting, 60000); // Update every minute

  // Auth Submit Validation Logic & API Sync
  function syncSettingsToCloud() {
    const username = localStorage.getItem('dlm_username');
    const token = localStorage.getItem('dlm_user_token');
    if (!username || !token) return;

    const settings = {
      holidayEnabled: localStorage.getItem('dlm_holiday_enabled'),
      birthday: localStorage.getItem('dlm_birthday'),
      accentColors: localStorage.getItem('dlm_accent_colors')
    };

    fetch(API_BASE_URL.replace(/\/$/, '') + '/api/user/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, token, settings })
    }).then(res => res.json()).then(data => {
      if (data.status === 'success') {
        console.log('Settings successfully synced to cloud.');
      } else {
        console.error('Sync failed:', data.error);
      }
    }).catch(err => console.error('Sync error:', err));
  }
  window.syncSettingsToCloud = syncSettingsToCloud; // Expose globally for accent/settings to trigger

  if ($('loginSubmitBtn') && authModal) {
    $('loginSubmitBtn').addEventListener('click', async () => {
      const usernameInput = $('loginUsernameInput');
      const passwordInput = $('loginPasswordInput');
      const errorMsg = $('loginError');
      
      if (!usernameInput.value || !passwordInput.value) {
        errorMsg.textContent = 'Username and Password are required.';
        errorMsg.style.display = 'block';
        return;
      }
      
      try {
        const res = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
        });
        const data = await res.json();
        
        if (data.error === 'Banned') {
           const banOverlay = $('banOverlay');
           if (banOverlay) {
             $('banOverlayReason').textContent = `Reason: ${data.reason}`;
             banOverlay.classList.remove('hidden');
             banOverlay.classList.add('bb-enter-anim');
           }
           errorMsg.style.display = 'none';
           authModal.style.display = 'none';
           return;
        }

        if (data.token) {
          errorMsg.style.display = 'none';
          const username = data.account ? data.account.username : usernameInput.value;
          localStorage.setItem('dlm_username', username);
          localStorage.setItem('dlm_user_token', data.token);
          
          if (data.account && data.account.settings) {
            try {
              const settings = typeof data.account.settings === 'string'
                ? JSON.parse(data.account.settings) : data.account.settings;
              if (settings.holidayEnabled !== undefined) localStorage.setItem('dlm_holiday_enabled', settings.holidayEnabled);
              if (settings.birthday) localStorage.setItem('dlm_birthday', settings.birthday);
              if (settings.accentColors) {
                 localStorage.setItem('dlm_accent_colors', settings.accentColors);
                 if (typeof applyAccent === 'function') applyAccent(JSON.parse(settings.accentColors));
              }
            } catch(e) {}
          }
          
          authModal.style.display = 'none';
          if (typeof showToast === 'function') showToast('Successfully logged in and synced!', 'success');
          updateGreeting();
        } else {
          errorMsg.textContent = data.error || 'Login failed.';
          errorMsg.style.display = 'block';
        }
      } catch (err) {
        errorMsg.textContent = 'Network error. Make sure server is running.';
        errorMsg.style.display = 'block';
      }
    });
  }

  if (registerSubmitBtn && authModal) {
    registerSubmitBtn.addEventListener('click', async () => {
      const usernameInput = $('registerUsernameInput');
      const passwordInput = $('registerPasswordInput');
      const codeInput = $('registerCodeInput');
      const birthdayInput = $('registerBirthdayInput');
      const errorMsg = $('registerError');

      if (usernameInput.value.length < 3) {
        errorMsg.textContent = 'Username must be at least 3 characters.';
        errorMsg.style.display = 'block';
        return;
      }
      if (passwordInput.value.length < 6) {
        errorMsg.textContent = 'Password must be at least 6 characters.';
        errorMsg.style.display = 'block';
        return;
      }
      if (!codeInput.value) {
        errorMsg.textContent = 'Code from Bot is required.';
        errorMsg.style.display = 'block';
        return;
      }

      try {
        const payload = {
          username: usernameInput.value,
          password: passwordInput.value,
          pairingCode: codeInput.value,
          birthday: birthdayInput ? birthdayInput.value : null
        };

        const res = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.status === 'success') {
          errorMsg.style.display = 'none';
          localStorage.setItem('dlm_username', data.username);
          localStorage.setItem('dlm_user_token', data.token);
          if (payload.birthday) localStorage.setItem('dlm_birthday', payload.birthday);
          
          authModal.style.display = 'none';
          if (typeof showToast === 'function') showToast('Account created and synced!', 'success');
          updateGreeting();
          syncSettingsToCloud(); // Push initial settings
        } else {
          errorMsg.textContent = data.error || 'Registration failed.';
          errorMsg.style.display = 'block';
        }
      } catch (err) {
        errorMsg.textContent = 'Network error. Make sure server is running.';
        errorMsg.style.display = 'block';
      }
    });
  }

  // User Settings Account Management UI
  const userSettingsLoginBtn = $('userSettingsLoginBtn');

  function updateAccountUI() {
    const username = localStorage.getItem('dlm_username');
    const token = localStorage.getItem('dlm_user_token');
    const iconEl = $('accountSettingsIcon');
    const descEl = $('accountSettingsDesc');
    const greetingAvatar = $('greetingAvatar');
    const birthdayContainer = $('accountBirthdayContainer');
    const birthdayInput = $('accountBirthdayInput');

    if (username && token) {
      // Logged in — fetch avatar from server and show logout
      if (userSettingsLoginBtn) {
        userSettingsLoginBtn.textContent = 'Log Out';
        userSettingsLoginBtn.style.background = 'rgba(255,80,80,0.15)';
        userSettingsLoginBtn.style.borderColor = 'rgba(255,80,80,0.4)';
        userSettingsLoginBtn.style.color = '#ff6b6b';
      }
      if (descEl) descEl.textContent = `Logged in as ${username}. Your settings are synced.`;
      
      if (birthdayContainer) birthdayContainer.style.display = 'flex';
      if (birthdayInput) birthdayInput.value = localStorage.getItem('dlm_birthday') || '';
      
      const accountDeletionContainer = $('accountDeletionContainer');
      if (accountDeletionContainer) accountDeletionContainer.style.display = 'flex';

      // Fetch account info from server to get Discord avatar
      const savedToken = token;
      fetch(API_BASE_URL.replace(/\/$/, '') + '/api/user/data', {
        headers: { 'Authorization': 'Bearer ' + savedToken }
      }).then(r => r.json()).then(data => {
        if (data && data.error === 'Banned') {
           const banOverlay = $('banOverlay');
           if (banOverlay) {
             $('banOverlayReason').textContent = `Reason: ${data.reason || 'No reason provided'}`;
             banOverlay.classList.remove('hidden');
             banOverlay.classList.add('bb-enter-anim');
           }
           localStorage.removeItem('dlm_user_token');
           localStorage.removeItem('dlm_username');
           return;
        }

        const avatarUrl = data && data.discordAvatar ? data.discordAvatar : null;
        if (avatarUrl && iconEl) {
          iconEl.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:14px;">` ;
          iconEl.style.padding = '0';
          iconEl.style.overflow = 'hidden';
        }
        if (avatarUrl && greetingAvatar) {
          greetingAvatar.src = avatarUrl;
          greetingAvatar.style.display = 'block';
        }
      }).catch(() => {});

    } else {
      // Logged out — restore defaults
      if (userSettingsLoginBtn) {
        userSettingsLoginBtn.textContent = 'Log In / Register';
        userSettingsLoginBtn.style.background = '';
        userSettingsLoginBtn.style.borderColor = '';
        userSettingsLoginBtn.style.color = '';
      }
      if (descEl) descEl.textContent = 'Log in or register to sync your settings and favorites.';
      if (iconEl) {
        iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
        iconEl.style.padding = '';
        iconEl.style.overflow = '';
      }
      if (greetingAvatar) {
        greetingAvatar.style.display = 'none';
        greetingAvatar.src = '';
      }
      if (birthdayContainer) birthdayContainer.style.display = 'none';
    }
  }

  if (userSettingsLoginBtn) {
    userSettingsLoginBtn.addEventListener('click', () => {
      const username = localStorage.getItem('dlm_username');
      if (username) {
        // Log out
        localStorage.removeItem('dlm_username');
        localStorage.removeItem('dlm_user_token');
        updateAccountUI();
        if (typeof showToast === 'function') showToast('Logged out successfully.', 'success');
        updateGreeting();
      } else {
        // Open auth modal
        if (authModal) authModal.style.display = 'flex';
      }
    });
  }

  const deleteAccountBtn = $('deleteAccountBtn');
  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', async () => {
      const codeInput = $('accountDeletionCode');
      const code = codeInput.value.trim();
      if (!code) {
        showToast('Please enter the 6-digit code from Discord.', 'error');
        return;
      }

      if (!confirm('Are you absolutely sure you want to delete your account and all its data? This cannot be undone.')) return;

      const username = localStorage.getItem('dlm_username');
      try {
        const res = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/auth/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, code })
        });
        const data = await res.json();
        // Always clear local session and log out — backend deletes regardless
        localStorage.removeItem('dlm_user_token');
        localStorage.removeItem('dlm_username');
        localStorage.removeItem('dlm_recently_played');
        localStorage.removeItem('dlm_favorites');
        localStorage.removeItem('dlm_birthday');
        updateAccountUI();
        renderFavorites();
        renderRecentlyPlayed();
        updateGreeting();
        codeInput.value = '';
      } catch (err) {
        // Even on network error, log out locally
        localStorage.removeItem('dlm_user_token');
        localStorage.removeItem('dlm_username');
        updateAccountUI();
        updateGreeting();
      }
    });
  }

  const execBanBtn = $('execBanBtn');
  if (execBanBtn) {
    execBanBtn.addEventListener('click', async () => {
      const pin = $('execPinInput').value.trim();
      const username = $('execBanUsername').value.trim();
      const reason = $('execBanReason').value.trim();

      if (!pin || !username || !reason) {
        showToast('All fields (PIN, Username, Reason) are required to ban.', 'error');
        return;
      }

      // Validate PIN client-side using Base64 before hitting the server
      const EXEC_PIN = 'MTk3MzE5NzU=';
      if (btoa(pin) !== EXEC_PIN) {
        showToast('Invalid Executive PIN.', 'error');
        return;
      }

      try {
        const res = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/admin/ban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin: atob(EXEC_PIN), username, reason })
        });
        const data = await res.json();
        
        if (data.status === 'success') {
          showToast(`Successfully banned user ${username}.`, 'success');
          $('execBanUsername').value = '';
          $('execBanReason').value = '';
          $('execPinInput').value = '';
        } else {
          showToast(`Ban Failed: ${data.error}`, 'error');
        }
      } catch (err) {
        showToast('Network error while executing ban.', 'error');
      }
    });
  }

  const saveAccountBirthdayBtn = $('saveAccountBirthdayBtn');
  const accountBirthdayInput = $('accountBirthdayInput');
  if (saveAccountBirthdayBtn && accountBirthdayInput) {
    saveAccountBirthdayBtn.addEventListener('click', async () => {
      const newBirthday = accountBirthdayInput.value.trim();
      const token = localStorage.getItem('dlm_user_token');
      if (!token) return;

      const oldText = saveAccountBirthdayBtn.textContent;
      saveAccountBirthdayBtn.textContent = 'Saving...';
      try {
        const res = await fetch(API_BASE_URL.replace(/\/$/, '') + '/api/user/birthday', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ birthday: newBirthday })
        });
        const data = await res.json();
        if (data.status === 'success') {
          localStorage.setItem('dlm_birthday', newBirthday);
          if (typeof showToast === 'function') showToast('Birthday updated successfully!', 'success');
          updateGreeting();
        } else {
          if (typeof showToast === 'function') showToast(data.error || 'Failed to update birthday', 'error');
        }
      } catch (e) {
        if (typeof showToast === 'function') showToast('Network error updating birthday', 'error');
      }
      saveAccountBirthdayBtn.textContent = oldText;
    });
  }

  // Expose so login/register success can refresh the UI
  window.updateAccountUI = updateAccountUI;
  updateAccountUI();
  
  if (closeUpdateModalBtn) {
    closeUpdateModalBtn.addEventListener('click', () => {
      updateLogModal.style.display = 'none';
    });
  }
  
  if (playCelebrationBtn) {
    playCelebrationBtn.addEventListener('click', async () => {
      updateLogModal.style.display = 'none';
      if (!selectedGuildId) {
        showToast('Please select a server first to play the celebration song!', 'error');
        return;
      }
      try {
        await addSong('premiumsearch:Celebration LE SSERAFIM', null, null, null);
        showToast('CELEBRATION by LE SSERAFIM added to queue! ?', 'success');
      } catch (err) {
        showToast('Failed to add Celebration: ' + err.message, 'error');
      }
    });
  }

  const regenUpdateLogBtn = $('regenUpdateLogBtn');
  if (regenUpdateLogBtn) {
    regenUpdateLogBtn.addEventListener('click', () => {
      localStorage.removeItem('v2.2_update_seen');
      location.reload();
    });
  }

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
    if (btoa(val) === PIN_MGMT) {
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
  // Puzzle PIN
  $('puzzleSubmit').addEventListener('click', () => {
    const val = $('puzzleInput').value.trim().toUpperCase();
    if (btoa(val) === PIN_PUZZLE_ANS) {
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

  // Timeline Seeking
  const handleSeek = async (e) => {
    if (!selectedGuildId || !nowPlayingData) return;
    const bar = e.currentTarget;
    const clickX = e.clientX - bar.getBoundingClientRect().left;
    const pct = Math.max(0, Math.min(1, clickX / bar.offsetWidth));
    
    const durationSecs = parseDurationSecs(nowPlayingData.duration);
    if (durationSecs > 0) {
      const positionMs = Math.floor(pct * durationSecs * 1000);
      try {
        await fetch(`${API_BASE_URL.replace(/\/$/, '')}/api/queue/seek`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify({ guildId: selectedGuildId, positionMs })
        });
        nowPlayingData.position = positionMs / 1000;
        updateNowPlaying(nowPlayingData);
      } catch (err) {
        console.error('Seek failed:', err);
      }
    }
  };
  
  document.querySelectorAll('.progress-bar').forEach(bar => {
    bar.style.cursor = 'pointer';
    bar.addEventListener('click', handleSeek);
  });
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
  const bbFavorite = $('bbFavoriteBtn');
  if (bbFavorite) bbFavorite.addEventListener('click', toggleFavorite);
  const effectsBtn = $('effectsBtn');
  const effectsPanel = $('effectsPanel');
  if (effectsBtn && effectsPanel) {
    effectsBtn.addEventListener('click', e => { e.stopPropagation(); effectsPanel.classList.toggle('open'); });
    document.addEventListener('click', e => { if (!effectsPanel.contains(e.target) && e.target !== effectsBtn) effectsPanel.classList.remove('open'); });
  }
  // Local language preference: British spelling is the default.
  const localeSelect = $('localeSelect');
  function applyLocale(locale) {
    const british = locale !== 'american';
    localStorage.setItem('dlm_locale', british ? 'british' : 'american');
    document.documentElement.lang = british ? 'en-GB' : 'en-US';
    if (localeSelect) localeSelect.value = british ? 'british' : 'american';
    const label = british ? 'Favourites' : 'Favorites';
    const navLabel = document.querySelector('#nav-favorites span');
    const viewTitle = document.querySelector('#view-favorites .section-title');
    if (navLabel) navLabel.textContent = label;
    if (viewTitle) viewTitle.textContent = label;
    if (document.querySelector('#nav-favorites.active') && $('pageTitle')) $('pageTitle').textContent = label;
  }
  if (localeSelect) {
    applyLocale(localStorage.getItem('dlm_locale') || 'british');
    localeSelect.addEventListener('change', () => applyLocale(localeSelect.value));
  }
  // Background images remain entirely in the current browser's local storage.
  const backgroundBtn = $('backgroundBtn'), backgroundInput = $('backgroundInput'), scene = document.querySelector('.bg-scene');
  const gridOverlay = document.querySelector('.grid-overlay');
  const gridToggleBtn = $('gridToggleBtn');
  const gridSizeSlider = $('gridSizeSlider');
  const gridSizeValue = $('gridSizeValue');
  const gridSizeContainer = $('gridSizeContainer');
  
  // IndexedDB Helper for Backgrounds
  const DB_NAME = 'DLMPlayerDB';
  function saveBackgroundToDB(data) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = e => e.target.result.createObjectStore('bgStore');
      request.onsuccess = e => {
        const tx = e.target.result.transaction('bgStore', 'readwrite');
        tx.objectStore('bgStore').put(data, 'background');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }
  function loadBackgroundFromDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = e => e.target.result.createObjectStore('bgStore');
      request.onsuccess = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('bgStore')) { resolve(null); return; }
        const getReq = db.transaction('bgStore', 'readonly').objectStore('bgStore').get('background');
        getReq.onsuccess = () => resolve(getReq.result);
        getReq.onerror = () => resolve(null);
      };
      request.onerror = () => resolve(null);
    });
  }
  function clearBackgroundFromDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = e => e.target.result.createObjectStore('bgStore');
      request.onsuccess = e => {
        const tx = e.target.result.transaction('bgStore', 'readwrite');
        tx.objectStore('bgStore').delete('background');
        tx.oncomplete = () => resolve();
      };
      request.onerror = () => resolve();
    });
  }

  function applyLocalBackground(image) {
    if (!scene) return;
    const enableGridOnImage = localStorage.getItem('dlm_enable_image_grid') === 'true';
    const gridAmount = localStorage.getItem('dlm_image_grid_amount') || '4';
    const imageBlobs = localStorage.getItem('dlm_image_blobs_enabled') === 'true';
    
    if (gridToggleBtn) gridToggleBtn.checked = enableGridOnImage;
    if (gridSizeSlider) gridSizeSlider.value = gridAmount;
    if (gridSizeValue) gridSizeValue.textContent = gridAmount;
    if (gridSizeContainer) gridSizeContainer.style.display = enableGridOnImage ? 'flex' : 'none';
    
    const blobs = scene.querySelectorAll('.blob');

    if (imageBlobs && image) {
      scene.style.backgroundImage = '';
      if (gridOverlay) gridOverlay.style.display = 'none';
      blobs.forEach(b => {
        b.style.display = 'block';
        b.style.backgroundImage = `url("${image}")`;
        b.style.backgroundSize = 'cover';
        b.style.backgroundPosition = 'center';
        // Reset opacity so image is clear
        b.style.opacity = '0.8';
        b.style.filter = 'blur(5px)'; // little blur
      });
    } else {
      scene.style.backgroundImage = image ? `url("${image}")` : '';
      if (image) {
        if (gridOverlay) gridOverlay.style.display = 'none'; // hide the white dots grid
        blobs.forEach(b => b.style.display = 'none'); // Hide blobs
        if (enableGridOnImage) {
           scene.style.backgroundSize = `${100 / parseInt(gridAmount, 10)}vw auto`; // Scale by amount
           scene.style.backgroundRepeat = 'repeat';
           scene.style.backgroundPosition = 'top left';
        } else {
           scene.style.backgroundSize = 'cover';
           scene.style.backgroundRepeat = 'no-repeat';
           scene.style.backgroundPosition = 'center';
        }
      } else {
        if (gridOverlay) gridOverlay.style.display = 'block'; // show the white dots grid on default anim
        blobs.forEach(b => b.style.display = 'block'); // Show blobs
        scene.style.backgroundSize = '';
        scene.style.backgroundRepeat = '';
        scene.style.backgroundPosition = '';
      }
    }
  }
  
  // Try loading from DB first, fallback to localStorage if any leftover
  loadBackgroundFromDB().then(res => {
     let bg = res || localStorage.getItem('dlm_local_background') || '';
     applyLocalBackground(bg);
     window._currentBgData = bg;
  });

  if (gridToggleBtn) {
    gridToggleBtn.addEventListener('change', () => {
      localStorage.setItem('dlm_enable_image_grid', gridToggleBtn.checked);
      applyLocalBackground(window._currentBgData || '');
    });
  }

  if (gridSizeSlider) {
    gridSizeSlider.addEventListener('input', e => {
      if (gridSizeValue) gridSizeValue.textContent = e.target.value;
      localStorage.setItem('dlm_image_grid_amount', e.target.value);
      applyLocalBackground(window._currentBgData || '');
    });
  }

  // Blob Multiplier Slider
  const blobMultiplierSlider = $('blobMultiplierSlider');
  const blobMultiplierValue = $('blobMultiplierValue');
  if (blobMultiplierSlider) {
    const val = localStorage.getItem('dlm_blob_multiplier') || '1';
    blobMultiplierSlider.value = val;
    if (blobMultiplierValue) blobMultiplierValue.textContent = val + 'x';
    blobMultiplierSlider.addEventListener('input', (e) => {
      const v = e.target.value;
      if (blobMultiplierValue) blobMultiplierValue.textContent = v + 'x';
      localStorage.setItem('dlm_blob_multiplier', v);
      updateDynamicBlobs(JSON.parse(localStorage.getItem('dlm_accent_colors') || '["#0084ff","#7300ff"]'));
    });
  }

  // Blob Speed Slider
  const blobSpeedSlider = $('blobSpeedSlider');
  const blobSpeedValue = $('blobSpeedValue');
  if (blobSpeedSlider) {
    const val = localStorage.getItem('dlm_blob_speed') || '1';
    blobSpeedSlider.value = val;
    if (blobSpeedValue) blobSpeedValue.textContent = val + 'x';
    blobSpeedSlider.addEventListener('input', (e) => {
      const v = e.target.value;
      if (blobSpeedValue) blobSpeedValue.textContent = v + 'x';
      localStorage.setItem('dlm_blob_speed', v);
    });
  }

  if (backgroundBtn && backgroundInput) {
    backgroundBtn.addEventListener('click', () => backgroundInput.click());
    backgroundInput.addEventListener('change', () => {
      const file = backgroundInput.files && backgroundInput.files[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) { showToast('Choose an image smaller than 25 MB', 'error'); return; }
      const reader = new FileReader();
      reader.onload = () => { 
        window._currentBgData = reader.result;
        applyLocalBackground(reader.result); 
        saveBackgroundToDB(reader.result)
          .then(() => showToast('Background updated', 'success'))
          .catch(() => showToast('Background could not be saved', 'error'));
      };
      reader.readAsDataURL(file);
    });
  }
  const clearBackgroundBtn = $('clearBackgroundBtn');
  if (clearBackgroundBtn) {
    clearBackgroundBtn.addEventListener('click', () => {
      window._currentBgData = '';
      localStorage.removeItem('dlm_local_background');
      clearBackgroundFromDB().then(() => {
        applyLocalBackground(''); 
        showToast('Background cleared', 'info');
      });
    });
  }
  const accentPreview = $('accentPreview');
  const accentColorList = $('accentColorList');
  const addAccentColorBtn = $('addAccentColorBtn');
  const resetAccentBtn = $('resetAccentBtn');
  const bgScene = $('bgScene');

  let accentColors = JSON.parse(localStorage.getItem('dlm_accent_colors'));
  
  // Wipe cache if it's using the old default gradient so the new one applies!
  if (accentColors && ((accentColors[0] === '#6366f1' && accentColors[1] === '#8b5cf6') || (accentColors[0] === '#3b82f6' && accentColors[1] === '#7300ff') || (accentColors[0] === '#7b6cf6' && accentColors[1] === '#ff4b8b'))) {
    accentColors = null;
    localStorage.removeItem('dlm_accent_colors');
  }

  if (!accentColors || accentColors.length < 2) {
    const oldStart = localStorage.getItem('dlm_accent_start') || '#0084ff';
    const oldEnd = localStorage.getItem('dlm_accent_end') || '#7300ff';
    accentColors = [oldStart, oldEnd];
  }

  function applyAccent(colors) {
    const root = document.documentElement;
    if (colors.length >= 2) {
      root.style.setProperty('--accent-1', colors[0]);
      root.style.setProperty('--accent-2', colors[1]);
    }
    const gradStr = `linear-gradient(135deg, ${colors.join(', ')})`;
    root.style.setProperty('--accent-grad', gradStr);
    if (accentPreview) accentPreview.style.background = gradStr;
    localStorage.setItem('dlm_accent_colors', JSON.stringify(colors));
    updateDynamicBlobs(colors);
    if (typeof window.syncSettingsToCloud === 'function') window.syncSettingsToCloud();
  }

  function updateDynamicBlobs(colors) {
    if (!bgScene) return;
    const existingBlobs = bgScene.querySelectorAll('.blob');
    const multiplier = parseInt(localStorage.getItem('dlm_blob_multiplier') || '1', 10);
    const numBlobs = colors.length * 2 * multiplier;
    
    if (existingBlobs.length !== numBlobs) {
      // Re-generate blobs if length changed
      existingBlobs.forEach(el => el.remove());
      for (let i = 0; i < numBlobs; i++) {
        const blob = document.createElement('div');
        blob.className = 'blob';
        const size = 300 + Math.random() * 400; // 300px to 700px
        blob.style.width = `${size}px`;
        blob.style.height = `${size}px`;
        // Spread them out roughly
        blob.style.top = `${-20 + Math.random() * 100}%`;
        blob.style.left = `${-20 + Math.random() * 100}%`;
        blob.style.animationDelay = `-${Math.random() * 20}s`;
        blob.style.animationDuration = `${15 + Math.random() * 15}s`;
        blob._baseColorIndex = i % colors.length;
        const color = colors[blob._baseColorIndex];
        blob.style.background = `radial-gradient(circle, ${color}, transparent 70%)`;
        blob.style.animation = 'none'; // disable CSS float
        blob._vx = (Math.random() - 0.5) * 3;
        blob._vy = (Math.random() - 0.5) * 3;
        blob._tx = 0;
        blob._ty = 0;
        bgScene.appendChild(blob);
        activePhysicsBlobs.add(blob);
      }
      if (!physicsLoopActive) {
        physicsLoopActive = true;
        requestAnimationFrame(physicsLoop);
      }
    } else {
      // Just update colors dynamically
      existingBlobs.forEach(blob => {
        const color = colors[blob._baseColorIndex];
        blob.style.background = `radial-gradient(circle, ${color}, transparent 70%)`;
      });
    }
    applyLocalBackground(window._currentBgData || '');
  }

  function createCustomColorPicker(initialColor, onChange) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    
    const swatch = document.createElement('div');
    swatch.style.width = '42px';
    swatch.style.height = '28px';
    swatch.style.borderRadius = '6px';
    swatch.style.backgroundColor = initialColor;
    swatch.style.cursor = 'pointer';
    swatch.style.border = '1px solid rgba(255,255,255,0.2)';
    
    const popup = document.createElement('div');
    popup.style.position = 'absolute';
    popup.style.top = '100%';
    popup.style.left = '0';
    popup.style.marginTop = '8px';
    popup.style.padding = '12px';
    popup.style.background = 'rgba(16, 16, 28, 0.98)';
    popup.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    popup.style.borderRadius = '12px';
    popup.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.5)';
    popup.style.display = 'none';
    popup.style.zIndex = '1000';
    popup.style.width = 'max-content';

    const presets = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e', '#ffffff', '#94a3b8', '#000000'];
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(5, 1fr)';
    grid.style.gap = '8px';
    grid.style.marginBottom = '12px';

    presets.forEach(color => {
      const p = document.createElement('div');
      p.style.width = '24px';
      p.style.height = '24px';
      p.style.borderRadius = '4px';
      p.style.backgroundColor = color;
      p.style.cursor = 'pointer';
      p.style.border = '1px solid rgba(255,255,255,0.1)';
      p.addEventListener('click', (e) => {
        e.stopPropagation();
        swatch.style.backgroundColor = color;
        hexInput.value = color;
        onChange(color);
        popup.style.display = 'none';
      });
      grid.appendChild(p);
    });
    
    const hexRow = document.createElement('div');
    hexRow.style.display = 'flex';
    hexRow.style.gap = '8px';
    hexRow.style.alignItems = 'center';
    
    const hash = document.createElement('span');
    hash.textContent = '#';
    hash.style.color = 'rgba(255,255,255,0.5)';
    
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = initialColor;
    hexInput.style.flex = '1';
    hexInput.style.width = '46px';
    hexInput.style.background = 'rgba(255,255,255,0.05)';
    hexInput.style.border = '1px solid rgba(255,255,255,0.1)';
    hexInput.style.borderRadius = '6px';
    hexInput.style.color = '#fff';
    hexInput.style.padding = '4px 8px';
    hexInput.style.fontSize = '14px';
    hexInput.style.outline = 'none';
    
    hexInput.addEventListener('input', (e) => {
      let val = e.target.value;
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9A-Fa-f]{6}$/.test(val) || /^#[0-9A-Fa-f]{3}$/.test(val)) {
        swatch.style.backgroundColor = val;
        onChange(val);
      }
    });

    // Native color picker (Hue Circle) hidden
    const nativePicker = document.createElement('input');
    nativePicker.type = 'color';
    nativePicker.value = initialColor;
    nativePicker.style.position = 'absolute';
    nativePicker.style.opacity = '0';
    nativePicker.style.pointerEvents = 'none';
    nativePicker.addEventListener('input', (e) => {
      const val = e.target.value;
      swatch.style.backgroundColor = val;
      hexInput.value = val;
      onChange(val);
    });

    const hueBtn = document.createElement('button');
    hueBtn.style.width = '26px';
    hueBtn.style.height = '26px';
    hueBtn.style.borderRadius = '4px';
    hueBtn.style.border = '1px solid rgba(255,255,255,0.2)';
    hueBtn.style.cursor = 'pointer';
    hueBtn.style.background = 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)';
    hueBtn.style.flexShrink = '0';
    hueBtn.title = 'Hue Circle / Advanced Picker';
    
    hueBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      nativePicker.click();
    });

    // Eyedropper API
    const eyeBtn = document.createElement('button');
    eyeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/><path d="M16 8L8 16"/><line x1="3" y1="21" x2="6.5" y2="17.5"/></svg>';
    eyeBtn.style.width = '26px';
    eyeBtn.style.height = '26px';
    eyeBtn.style.borderRadius = '4px';
    eyeBtn.style.border = '1px solid rgba(255,255,255,0.1)';
    eyeBtn.style.cursor = 'pointer';
    eyeBtn.style.background = 'rgba(255,255,255,0.05)';
    eyeBtn.style.color = 'rgba(255,255,255,0.8)';
    eyeBtn.style.display = window.EyeDropper ? 'flex' : 'none';
    eyeBtn.style.alignItems = 'center';
    eyeBtn.style.justifyContent = 'center';
    eyeBtn.style.flexShrink = '0';
    eyeBtn.title = 'Eyedropper';
    
    eyeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!window.EyeDropper) return;
      try {
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        swatch.style.backgroundColor = result.sRGBHex;
        hexInput.value = result.sRGBHex;
        onChange(result.sRGBHex);
      } catch (err) {}
    });

    hexRow.appendChild(hash);
    hexRow.appendChild(hexInput);
    hexRow.appendChild(hueBtn);
    hexRow.appendChild(eyeBtn);
    
    popup.appendChild(grid);
    popup.appendChild(hexRow);
    
    wrapper.appendChild(swatch);
    wrapper.appendChild(popup);
    wrapper.appendChild(nativePicker);
    
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });
    
    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target)) {
        popup.style.display = 'none';
      }
    });

    return { wrapper };
  }

  function renderAccentPickers() {
    if (!accentColorList) return;
    
    accentColorList.innerHTML = '';
    accentColors.forEach((color, index) => {
      const container = document.createElement('div');
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.gap = '8px';
      
      const picker = createCustomColorPicker(color, (newColor) => {
        accentColors[index] = newColor;
        applyAccent(accentColors);
      });
      
      container.appendChild(picker.wrapper);

      if (accentColors.length > 2) {
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '×';
        removeBtn.className = 'ghost-btn danger-btn';
        removeBtn.style.padding = '4px 8px';
        removeBtn.style.minWidth = '0';
        removeBtn.style.fontSize = '14px';
        removeBtn.addEventListener('click', () => {
          accentColors.splice(index, 1);
          renderAccentPickers(); 
          applyAccent(accentColors);
        });
        container.appendChild(removeBtn);
      }
      accentColorList.appendChild(container);
    });
  }

  if (addAccentColorBtn) {
    addAccentColorBtn.addEventListener('click', () => {
      accentColors.push(accentColors[accentColors.length - 1]);
      renderAccentPickers(); // Force re-render
      applyAccent(accentColors);
    });
  }
  
  if (resetAccentBtn) {
    resetAccentBtn.addEventListener('click', () => {
      accentColors = ['#0084ff', '#7300ff'];
      renderAccentPickers(); // Force re-render
      applyAccent(accentColors);
    });
  }
  
  // Initial apply
  renderAccentPickers();
  applyAccent(accentColors);
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
  const preset = $('announcementPreset');
  if (preset) preset.addEventListener('change', () => { if (preset.value) $('announcementInput').value = preset.value; });
  const sendAnnouncementBtn = $('sendAnnouncementBtn');
  if (sendAnnouncementBtn) sendAnnouncementBtn.addEventListener('click', async () => {
    const message = $('announcementInput').value.trim();
    if (!message) { showToast('Enter an announcement first', 'error'); return; }
    sendAnnouncementBtn.disabled = true;
    try {
      const data = await apiFetch('/api/announcement/send', { method: 'POST', body: JSON.stringify({ guildId: selectedGuildId || '', message }) });
      showToast(`Announcement sent to ${data.guilds || 0} server(s)`, 'success');
    } catch (err) { showToast('Announcement failed: ' + err.message, 'error'); }
    finally { sendAnnouncementBtn.disabled = false; }
  });
  const maintenanceBtn = $('maintenanceBtn');
  const maintenanceStatus = $('maintenanceStatus');
  async function refreshMaintenanceStatus() {
    if (!maintenanceBtn || !maintenanceStatus) return;
    try {
      const data = await apiFetch('/api/maintenance');
      const active = !!data.maintenance;
      maintenanceBtn.textContent = active ? 'Disable maintenance' : 'Enable maintenance';
      maintenanceBtn.classList.toggle('danger-btn', !active);
      maintenanceStatus.textContent = active ? 'Maintenance is active — playback is disabled.' : 'Maintenance is off.';
      maintenanceStatus.className = 'test-result ' + (active ? 'error' : 'success');
    } catch (_) { maintenanceStatus.textContent = 'Unable to read maintenance status.'; }
  }
  if (maintenanceBtn) maintenanceBtn.addEventListener('click', async () => {
    const enabling = maintenanceBtn.textContent.includes('Enable');
    maintenanceBtn.disabled = true;
    try {
      await apiFetch('/api/maintenance', { method: 'POST', body: JSON.stringify({ val: enabling }) });
      showToast(enabling ? 'Maintenance enabled: playback stopped and bot disconnected.' : 'Maintenance disabled: playback is available again.', 'success');
      await refreshMaintenanceStatus();
      if (enabling) { nowPlayingData = null; queueData = []; updateNowPlaying(null); renderQueue(); }
    } catch (err) { showToast('Maintenance update failed: ' + err.message, 'error'); }
    finally { maintenanceBtn.disabled = false; }
  });
  // Executive PIN for Global URL change
  const EXEC_PIN = 'MTk3MzE5NzU=';
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
        if (execOverride && btoa(execOverride) === EXEC_PIN) {
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
      if (btoa(pin) === EXEC_PIN) {
        execPinAttempts = 0;
        const url = prompt('EXECUTIVE ACCESS GRANTED ✓\n\nEnter the new Global Bot API URL for all users:', API_BASE_URL);
        if (url && url.trim()) {
          const clean = url.trim();
          
          fetch(API_BASE_URL + '/api/update-global-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pin: atob(EXEC_PIN), url: clean })
          }).then(res => res.json()).then(data => {
              if (data.status === 'success') {
                  showToast('Global API URL permanently updated across all users!', 'success');
              } else {
                  showToast('Failed to update globally: ' + data.error, 'error');
              }
          }).catch(err => {
              console.error(err);
              showToast('Failed to reach backend for global update', 'error');
          });

          API_BASE_URL = clean;
          localStorage.setItem('dlm_api_url', clean);
          $('apiUrlInput').value = clean;
          stopPolling(); nowPlayingData = null; selectedGuildId = null;
          loadGuilds();
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
  $('sidebarToggle').addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      $('sidebar').classList.toggle('open');
    } else {
      const isHidden = $('sidebar').classList.toggle('hidden');
      document.body.classList.toggle('sidebar-hidden', isHidden);
    }
  });
  document.addEventListener('click', e => {
    const sb = $('sidebar'), tog = $('sidebarToggle');
    if (window.innerWidth <= 768 && sb.classList.contains('open')
        && !sb.contains(e.target) && !tog.contains(e.target)) sb.classList.remove('open');
  });
  // Boot
  refreshButtonStates();
  renderRecentlyPlayed();
  renderFavorites();
  setView('player');
  loadGuilds();
  refreshMaintenanceStatus();
  // Start physics collision loop always
  if (!physicsLoopActive) {
    physicsLoopActive = true;
    requestAnimationFrame(physicsLoop);
  }
});

// BlueSteelAI Modal Logic - event delegation
document.body.addEventListener('click', (e) => {
  // Open modal
  if (e.target && e.target.id === 'bluesteelAiBtn') {
    const modal = document.getElementById('aiModal');
    if (modal) modal.style.display = 'flex';
    return;
  }
  // Close modal - close button
  if (e.target && e.target.id === 'closeAiModal') {
    const modal = document.getElementById('aiModal');
    if (modal) modal.style.display = 'none';
    return;
  }
  // Close modal - click on backdrop
  if (e.target && e.target.id === 'aiModal') {
    e.target.style.display = 'none';
  }
});

// Easter Egg: Draggable Physics Blobs
let draggedBlob = null;
let blobStartX = 0, blobStartY = 0;
let lastMouseX = 0, lastMouseY = 0;
let mouseVx = 0, mouseVy = 0;
let physicsLoopActive = false;
const activePhysicsBlobs = new Set();

function physicsLoop() {
  const allStaticBlobs = document.querySelectorAll('.blob');
  if (activePhysicsBlobs.size === 0 && allStaticBlobs.length < 2) {
    physicsLoopActive = false;
    return;
  }
  
  const blobArray = Array.from(activePhysicsBlobs);
  
    blobArray.forEach(blob => {
    if (blob === draggedBlob) return; // don't move while dragged

    // maintain baseline speed
    const speed = Math.hypot(blob._vx, blob._vy);
    const baseline = 0.6;
    if (speed > baseline) {
      blob._vx *= 0.99; // slow down to baseline if thrown fast
      blob._vy *= 0.99;
    } else if (speed < baseline && speed > 0) {
      blob._vx *= 1.02; // speed up to baseline
      blob._vy *= 1.02;
    } else if (speed === 0) {
      blob._vx = (Math.random() - 0.5) * baseline;
      blob._vy = (Math.random() - 0.5) * baseline;
    }
    
    const speedMulti = parseFloat(localStorage.getItem('dlm_blob_speed') || '1');
    blob._tx += blob._vx * speedMulti;
    blob._ty += blob._vy * speedMulti;
    
    // bounding box logic against window edges
    const rect = blob.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const r = rect.width / 2;
    
    // store center for collision checks
    blob._cx = cx;
    blob._cy = cy;
    blob._r = r;
    
    // bounce off window edges
    if (cx < 0 && blob._vx < 0) { blob._vx *= -0.95; }
    if (cx > window.innerWidth && blob._vx > 0) { blob._vx *= -0.95; }
    if (cy < 0 && blob._vy < 0) { blob._vy *= -0.95; }
    if (cy > window.innerHeight && blob._vy > 0) { blob._vy *= -0.95; }
    
    blob.style.transform = `translate(${blob._tx}px, ${blob._ty}px)`;
  });

  // Blob-to-blob collision detection (all blobs, not just active ones)
  const allBlobs = Array.from(document.querySelectorAll('.blob'));
  for (let i = 0; i < allBlobs.length; i++) {
    for (let j = i + 1; j < allBlobs.length; j++) {
      const a = allBlobs[i];
      const b = allBlobs[j];
      
      // Get positions (use cached or compute from getBoundingClientRect)
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const cax = ra.left + ra.width / 2;
      const cay = ra.top + ra.height / 2;
      const cbx = rb.left + rb.width / 2;
      const cby = rb.top + rb.height / 2;
      const rA = ra.width / 2;
      const rB = rb.width / 2;
      
      const dx = cbx - cax;
      const dy = cby - cay;
      const dist = Math.hypot(dx, dy);
      const minDist = rA * 0.6 + rB * 0.6; // use 60% radius so they feel soft
      
      if (dist < minDist && dist > 0.1) {
        // Normalised collision axis
        const nx = dx / dist;
        const ny = dy / dist;
        
        // Init velocities if missing
        const initBlob = (blob) => {
          if (blob._vx === undefined) {
            blob._vx = 0; blob._vy = 0;
            blob.style.animation = 'none';
            const match = (blob.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
            blob._tx = match ? parseFloat(match[1]) : 0;
            blob._ty = match ? parseFloat(match[2]) : 0;
          }
        };
        initBlob(a);
        initBlob(b);
        
        // Relative velocity along collision normal
        const relVx = b._vx - a._vx;
        const relVy = b._vy - a._vy;
        const relVn = relVx * nx + relVy * ny;
        
        // Only resolve if they're moving toward each other
        if (relVn < 0) {
          const restitution = 0.85; // bounciness
          const impulse = -(1 + restitution) * relVn / 2;
          
          a._vx -= impulse * nx;
          a._vy -= impulse * ny;
          b._vx += impulse * nx;
          b._vy += impulse * ny;
          
          // Wake both blobs up
          activePhysicsBlobs.add(a);
          activePhysicsBlobs.add(b);
        }
        
        // Positional correction to stop overlap
        const overlap = minDist - dist;
        a._tx -= nx * overlap * 0.5;
        a._ty -= ny * overlap * 0.5;
        b._tx += nx * overlap * 0.5;
        b._ty += ny * overlap * 0.5;
        a.style.transform = `translate(${a._tx}px, ${a._ty}px)`;
        b.style.transform = `translate(${b._tx}px, ${b._ty}px)`;
      }
    }
  }
  
  requestAnimationFrame(physicsLoop);
}

document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.glass-card, .sidebar, .bottom-player-bar, .top-bar, button, input, select, .accent-picker')) return;
  const blobs = document.querySelectorAll('.blob');
  if (!blobs.length) return;
  
  let closest = null, minDistance = Infinity;
  blobs.forEach(blob => {
    const rect = blob.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(cx - e.clientX, cy - e.clientY);
    if (dist < minDistance) {
      minDistance = dist;
      closest = blob;
    }
  });
  
  if (closest && minDistance < 500) {
    draggedBlob = closest;
    draggedBlob.style.animation = 'none'; // pause float
    activePhysicsBlobs.delete(draggedBlob);
    document.body.style.userSelect = 'none';
    
    blobStartX = e.clientX;
    blobStartY = e.clientY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    mouseVx = 0;
    mouseVy = 0;
    
    const currentTransform = draggedBlob.style.transform || 'translate(0px, 0px)';
    let tx = 0, ty = 0;
    const match = currentTransform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    if (match) {
      tx = parseFloat(match[1]);
      ty = parseFloat(match[2]);
    }
    draggedBlob._tx = tx;
    draggedBlob._ty = ty;
  }
});

document.addEventListener('mousemove', (e) => {
  if (!draggedBlob) return;
  mouseVx = e.clientX - lastMouseX;
  mouseVy = e.clientY - lastMouseY;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  
  const dx = e.clientX - blobStartX;
  const dy = e.clientY - blobStartY;
  draggedBlob.style.transform = `translate(${draggedBlob._tx + dx}px, ${draggedBlob._ty + dy}px)`;
});

document.addEventListener('mouseup', () => {
  if (draggedBlob) {
    document.body.style.userSelect = '';
    draggedBlob._tx += (lastMouseX - blobStartX);
    draggedBlob._ty += (lastMouseY - blobStartY);
    draggedBlob._vx = mouseVx;
    draggedBlob._vy = mouseVy;
    
    activePhysicsBlobs.add(draggedBlob);
    draggedBlob = null;
    
    if (!physicsLoopActive) {
      physicsLoopActive = true;
      requestAnimationFrame(physicsLoop);
    }
  }
});

// "Connected" Light Easter Egg
const statusDotEl = document.getElementById('statusDot');
if (statusDotEl) {
  statusDotEl.style.cursor = 'pointer';
  statusDotEl.addEventListener('click', () => {
    localStorage.setItem('dlm_image_blobs_enabled', 'true');
    const textEl = document.getElementById('statusText');
    if (textEl) {
      textEl.textContent = 'Easter Egg Enabled: To Disable, use PIN 8008 in Admin Settings';
    }
    setTimeout(() => window.location.reload(), 2500);
  });
}


