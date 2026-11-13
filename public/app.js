'use strict';
/* Picante frontend — vanilla JS SPA.
   Talks only to the same-origin API contract:
   /api/signup, /api/login, /api/logout, /api/session, /api/feed,
   /api/profile/:username, /api/profile, /api/upload,
   /api/videos/:id/{delete,like,save,comments,share,report},
   /api/users/:username/{follow,block,unblock}, /api/blocked,
   /api/legal/{terms,privacy}. Errors are {error:"message"}. */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const state = {
  user: null,            // {id, username, displayName, bio} | null
  mood: 'all',
  feedVideos: [],
  currentVideoId: null, // video id of the open comment/more/report sheet
  currentVideoUser: null,
  currentVideoEl: null,
  muted: true,           // autoplay muted by default
  profileUsername: null, // username shown in the profile view
  legalReturn: 'auth',   // view to return to from the legal view
  observer: null,
};

const VIEWS = ['auth', 'feed', 'upload', 'profile', 'legal'];
const SHEETS = ['sheet-comments', 'sheet-more', 'sheet-report', 'confirm-modal'];

/* ---------------- API helper ---------------- */
async function api(path, options) {
  const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}));
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) {
    const msg = (data && data.error) || ('Request failed (' + res.status + ')');
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}
async function apiJson(path, method, body) {
  return api(path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/* ---------------- View switching ---------------- */
function showView(name) {
  VIEWS.forEach((v) => { $('#view-' + v).hidden = (v !== name); });
  if (name !== 'feed') pauseAllVideos();
  window.scrollTo(0, 0);
}
function showError(el, message) {
  if (!el) return;
  el.textContent = message || 'Something went wrong.';
  el.hidden = false;
}
function hideError(el) { if (el) el.hidden = true; }

let toastTimer = null;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------------- Sheets / modal ---------------- */
function openSheet(id) {
  SHEETS.forEach((s) => { if (s !== id) $('#' + s).hidden = true; });
  $('#' + id).hidden = false;
  $('#sheet-backdrop').hidden = false;
}
function closeSheets() {
  SHEETS.forEach((s) => { $('#' + s).hidden = true; });
  $('#sheet-backdrop').hidden = true;
}
$('#sheet-backdrop').addEventListener('click', closeSheets);
$$('[data-close-sheet]').forEach((b) => b.addEventListener('click', closeSheets));

let confirmCallback = null;
function askConfirm(title, text, yesLabel, cb) {
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#btn-confirm-yes').textContent = yesLabel || 'Yes, do it';
  confirmCallback = cb;
  openSheet('confirm-modal');
}
$('#btn-confirm-yes').addEventListener('click', () => {
  const cb = confirmCallback;
  confirmCallback = null;
  closeSheets();
  if (cb) cb();
});

/* ---------------- Auth ---------------- */
function setAuthTab(mode) {
  const signup = mode === 'signup';
  $('#tab-signup').classList.toggle('active', signup);
  $('#tab-login').classList.toggle('active', !signup);
  $('#form-signup').hidden = !signup;
  $('#form-login').hidden = signup;
  hideError($('#signup-error'));
  hideError($('#login-error'));
}
$('#tab-signup').addEventListener('click', () => setAuthTab('signup'));
$('#tab-login').addEventListener('click', () => setAuthTab('login'));

$('#form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $('button[type="submit"]', f);
  hideError($('#signup-error'));
  const dob = f.dob.value;
  if (dob) {
    const age = ageOn(dob, new Date());
    if (age < 13) { showError($('#signup-error'), 'You must be 13 or older to join.'); return; }
  }
  btn.disabled = true;
  try {
    const data = await apiJson('/api/signup', 'POST', {
      username: f.username.value.trim(),
      password: f.password.value,
      displayName: f.displayName.value.trim(),
      dob: dob,
    });
    state.user = data.user;
    await enterApp();
  } catch (err) {
    showError($('#signup-error'), err.message);
  } finally { btn.disabled = false; }
});

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $('button[type="submit"]', f);
  hideError($('#login-error'));
  btn.disabled = true;
  try {
    const data = await apiJson('/api/login', 'POST', {
      username: f.username.value.trim(),
      password: f.password.value,
    });
    state.user = data.user;
    await enterApp();
  } catch (err) {
    showError($('#login-error'), err.message);
  } finally { btn.disabled = false; }
});

function ageOn(dobStr, now) {
  const dob = new Date(dobStr + 'T00:00:00');
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

async function enterApp() {
  showView('feed');
  await loadFeed();
}

/* ---------------- Legal ---------------- */
async function openLegal(kind) {
  state.legalReturn = $('#view-auth').hidden ? currentViewName() : 'auth';
  showView('legal');
  $('#legal-title').textContent = kind === 'terms' ? 'Terms of Service' : 'Privacy Policy';
  $('#legal-body').textContent = 'Loading…';
  try {
    const data = await api('/api/legal/' + kind);
    $('#legal-title').textContent = data.title || $('#legal-title').textContent;
    $('#legal-body').textContent = data.body || '';
  } catch (err) {
    $('#legal-body').textContent = 'Could not load this document: ' + err.message;
  }
}
function currentViewName() {
  for (const v of VIEWS) { if (!$('#view-' + v).hidden) return v; }
  return 'auth';
}
$$('[data-legal]').forEach((b) => b.addEventListener('click', () => openLegal(b.dataset.legal)));
$('#btn-legal-back').addEventListener('click', () => {
  const back = state.legalReturn || 'auth';
  if (back === 'feed') { showView('feed'); }
  else if (back === 'profile') { showView('profile'); }
  else if (back === 'upload') { showView('upload'); }
  else { showView(state.user ? 'feed' : 'auth'); }
});

/* ---------------- Feed ---------------- */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtCount(n) {
  n = Number(n) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function videoSlideHTML(v) {
  const heat = (v.likeCount || 0) >= 10
    ? '<span class="heat-badge">🔥 Caliente</span>' : '';
  const thumb = v.thumbnailUrl ? ' poster="' + escapeHtml(v.thumbnailUrl) + '"' : '';
  return '' +
    '<article class="video-slide" data-video-id="' + escapeHtml(v.id) + '" data-username="' + escapeHtml(v.user.username) + '">' +
      '<video class="tappable" src="' + escapeHtml(v.url) + '"' + thumb +
        ' loop playsinline preload="metadata"' + (state.muted ? ' muted' : '') + '></video>' +
      '<span class="flame-burst" aria-hidden="true">🔥</span>' +
      '<button type="button" class="icon-btn mute-btn" aria-label="Mute / unmute" title="Mute / unmute">' + (state.muted ? '🔇' : '🔊') + '</button>' +
      '<div class="video-overlay">' +
        '<div class="video-user">' +
          '<button type="button" class="user-link" data-open-profile="' + escapeHtml(v.user.username) + '">@' + escapeHtml(v.user.username) + '</button>' +
          '<span class="display-name">' + escapeHtml(v.user.displayName || '') + '</span>' +
          heat +
        '</div>' +
        (v.caption ? '<p class="video-caption">' + escapeHtml(v.caption) + '</p>' : '') +
        '<div class="action-strip">' +
          '<button type="button" class="action-btn action-like' + (v.liked ? ' active' : '') + '" data-action="like" aria-label="Like">' +
            '<span class="action-icon">' + (v.liked ? '🔥' : '🤍') + '</span><span class="count">' + fmtCount(v.likeCount) + '</span></button>' +
          '<button type="button" class="action-btn action-comment" data-action="comment" aria-label="Comments">' +
            '<span class="action-icon">💬</span><span class="count">' + fmtCount(v.commentCount) + '</span></button>' +
          '<button type="button" class="action-btn action-save' + (v.saved ? ' active' : '') + '" data-action="save" aria-label="Save">' +
            '<span class="action-icon">' + (v.saved ? '🔖' : '📑') + '</span><span class="count">' + fmtCount(v.saveCount) + '</span></button>' +
          '<button type="button" class="action-btn action-share" data-action="share" aria-label="Share">' +
            '<span class="action-icon">↗️</span><span class="count">' + fmtCount(v.shareCount) + '</span></button>' +
          '<button type="button" class="action-btn action-more" data-action="more" aria-label="More options">⋯ More</button>' +
        '</div>' +
      '</div>' +
    '</article>';
}

async function loadFeed() {
  const scroll = $('#feed-scroll');
  $$('.video-slide', scroll).forEach((el) => el.remove());
  $('#feed-empty').hidden = true;
  const loading = document.createElement('div');
  loading.className = 'feed-loading';
  loading.textContent = 'Loading videos…';
  scroll.appendChild(loading);
  try {
    const data = await api('/api/feed?mood=' + encodeURIComponent(state.mood));
    loading.remove();
    state.feedVideos = data.videos || [];
    if (!state.feedVideos.length) {
      $('#feed-empty').hidden = false;
      return;
    }
    state.feedVideos.forEach((v) => {
      const tmp = document.createElement('div');
      tmp.innerHTML = videoSlideHTML(v);
      scroll.appendChild(tmp.firstElementChild);
    });
    observeSlides();
    scroll.scrollTop = 0;
  } catch (err) {
    loading.textContent = 'Could not load the feed: ' + err.message;
  }
}

function observeSlides() {
  if (state.observer) state.observer.disconnect();
  state.observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const video = $('video', entry.target);
      if (!video) return;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        state.currentVideoEl = video;
        video.muted = state.muted;
        const p = video.play();
        if (p && p.catch) p.catch(() => {});
      } else {
        video.pause();
      }
    });
  }, { root: $('#feed-scroll'), threshold: [0.5] });
  $$('.video-slide').forEach((el) => state.observer.observe(el));
}

function pauseAllVideos() {
  $$('#feed-scroll video').forEach((v) => v.pause());
}

/* Feed event delegation: taps, double-tap like, actions, mute, profile links */
$('#feed-scroll').addEventListener('click', (e) => {
  const slide = e.target.closest('.video-slide');
  if (!slide) return;
  const videoId = slide.dataset.videoId;
  const username = slide.dataset.username;

  const profileBtn = e.target.closest('[data-open-profile]');
  if (profileBtn) { openProfile(profileBtn.dataset.openProfile); return; }

  const muteBtn = e.target.closest('.mute-btn');
  if (muteBtn) { toggleMute(); return; }

  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    handleAction(actionBtn.dataset.action, videoId, username, slide, actionBtn);
    return;
  }

  // Tap on the video itself: single tap toggles play/pause, double tap likes.
  const video = e.target.closest('video');
  if (video) {
    const now = Date.now();
    const last = Number(video.dataset.lastTap || 0);
    video.dataset.lastTap = String(now);
    if (now - last < 300) {
      likeVideo(videoId, slide, true);
    } else {
      setTimeout(() => {
        if (Number(video.dataset.lastTap) === now) {
          if (video.paused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
          else video.pause();
        }
      }, 300);
    }
  }
});

function toggleMute() {
  state.muted = !state.muted;
  $$('#feed-scroll video').forEach((v) => { v.muted = state.muted; });
  $$('#feed-scroll .mute-btn').forEach((b) => { b.textContent = state.muted ? '🔇' : '🔊'; });
  const top = $('#btn-mute');
  top.textContent = state.muted ? '🔇' : '🔊';
  top.setAttribute('aria-label', state.muted ? 'Unmute' : 'Mute');
}
$('#btn-mute').addEventListener('click', toggleMute);

function handleAction(action, videoId, username, slide, btn) {
  if (action === 'like') likeVideo(videoId, slide, false);
  else if (action === 'comment') openComments(videoId);
  else if (action === 'save') saveVideo(videoId, slide);
  else if (action === 'share') shareVideo(videoId, slide);
  else if (action === 'more') openMore(videoId, username, slide);
}

async function likeVideo(videoId, slide, fromDoubleTap) {
  const btn = slide ? $('.action-like', slide) : null;
  try {
    const data = await apiJson('/api/videos/' + encodeURIComponent(videoId) + '/like', 'POST', {});
    if (btn) {
      btn.classList.toggle('active', !!data.liked);
      $('.action-icon', btn).textContent = data.liked ? '🔥' : '🤍';
      $('.count', btn).textContent = fmtCount(data.likeCount);
    }
    if (fromDoubleTap && data.liked && slide) {
      const burst = $('.flame-burst', slide);
      burst.classList.remove('animate');
      void burst.offsetWidth; // restart animation
      burst.classList.add('animate');
    }
  } catch (err) { toast(err.message); }
}

async function saveVideo(videoId, slide) {
  const btn = slide ? $('.action-save', slide) : null;
  try {
    const data = await apiJson('/api/videos/' + encodeURIComponent(videoId) + '/save', 'POST', {});
    if (btn) {
      btn.classList.toggle('active', !!data.saved);
      $('.action-icon', btn).textContent = data.saved ? '🔖' : '📑';
      $('.count', btn).textContent = fmtCount(data.saveCount);
    }
    toast(data.saved ? 'Saved.' : 'Removed from saved.');
  } catch (err) { toast(err.message); }
}

async function shareVideo(videoId, slide) {
  const btn = slide ? $('.action-share', slide) : null;
  try {
    const data = await apiJson('/api/videos/' + encodeURIComponent(videoId) + '/share', 'POST', {});
    if (btn) $('.count', btn).textContent = fmtCount(data.shareCount);
    const video = state.feedVideos.find((v) => String(v.id) === String(videoId));
    const url = video && video.url ? new URL(video.url, window.location.href).href : window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: 'Picante', text: (video && video.caption) || 'Check out this video on Picante', url: url }); } catch (e) { /* user cancelled */ }
    } else if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(url); toast('Link copied to clipboard.'); } catch (e) { toast('Shared!'); }
    } else { toast('Shared!'); }
  } catch (err) { toast(err.message); }
}

/* Mood chips */
$$('.mood-chips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    if (state.mood === chip.dataset.mood) return;
    state.mood = chip.dataset.mood;
    $$('.mood-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    loadFeed();
  });
});

/* Feed nav buttons */
$('#btn-upload-fab').addEventListener('click', () => showView('upload'));
$('#btn-empty-upload').addEventListener('click', () => showView('upload'));
$('#btn-go-profile').addEventListener('click', () => { if (state.user) openProfile(state.user.username); });
$$('[data-nav="feed"]').forEach((b) => b.addEventListener('click', () => showView('feed')));

/* ---------------- Comments sheet ---------------- */
async function openComments(videoId) {
  state.currentVideoId = videoId;
  $('#comments-list').innerHTML = '<p class="empty-note">Loading comments…</p>';
  openSheet('sheet-comments');
  try {
    const data = await api('/api/videos/' + encodeURIComponent(videoId) + '/comments');
    renderComments(data.comments || []);
  } catch (err) {
    $('#comments-list').innerHTML = '<p class="form-error">' + escapeHtml(err.message) + '</p>';
  }
}
function renderComments(comments) {
  const list = $('#comments-list');
  if (!comments.length) { list.innerHTML = '<p class="empty-note">No comments yet — say something!</p>'; return; }
  list.innerHTML = comments.map((c) =>
    '<div class="comment-item">' +
      '<span class="comment-avatar">' + escapeHtml((c.user.displayName || c.user.username || '?').charAt(0).toUpperCase()) + '</span>' +
      '<div><div class="comment-user">@' + escapeHtml(c.user.username) + '</div>' +
      '<p class="comment-text">' + escapeHtml(c.text) + '</p></div>' +
    '</div>').join('');
}
$('#form-comment').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#comment-input');
  const text = input.value.trim();
  if (!text || !state.currentVideoId) return;
  const btn = $('button[type="submit"]', e.target);
  btn.disabled = true;
  try {
    const data = await apiJson('/api/videos/' + encodeURIComponent(state.currentVideoId) + '/comments', 'POST', { text: text });
    input.value = '';
    // Re-fetch so the list (and count) is authoritative.
    const list = await api('/api/videos/' + encodeURIComponent(state.currentVideoId) + '/comments');
    renderComments(list.comments || []);
    const slide = $('.video-slide[data-video-id="' + CSS.escape(String(state.currentVideoId)) + '"]');
    if (slide) {
      const cBtn = $('.action-comment', slide);
      if (cBtn) $('.count', cBtn).textContent = fmtCount((list.comments || []).length);
    }
    if (data && data.comment) { /* comment rendered via re-fetch above */ }
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
});

/* ---------------- More / Report / Block ---------------- */
function openMore(videoId, username, slide) {
  state.currentVideoId = videoId;
  state.currentVideoUser = username;
  state.currentVideoSlide = slide;
  $('#more-title').textContent = 'More';
  $('#more-block-user').textContent = '@' + username;
  openSheet('sheet-more');
}
$('#btn-more-report').addEventListener('click', () => {
  hideError($('#report-error'));
  openSheet('sheet-report');
});
$('#btn-more-block').addEventListener('click', () => {
  const username = state.currentVideoUser;
  if (!username) return;
  askConfirm('Block @' + username + '?',
    'You will no longer see videos from @' + username + '.',
    'Block', async () => {
      try {
        await apiJson('/api/users/' + encodeURIComponent(username) + '/block', 'POST', {});
        toast('Blocked @' + username + '.');
        removeVideoFromFeed(state.currentVideoId);
      } catch (err) { toast(err.message); }
    });
});
function removeVideoFromFeed(videoId) {
  const slide = $('.video-slide[data-video-id="' + CSS.escape(String(videoId)) + '"]');
  if (slide) {
    const wasVisible = slide.getBoundingClientRect().top < window.innerHeight;
    slide.remove();
    state.feedVideos = state.feedVideos.filter((v) => String(v.id) !== String(videoId));
    if (!state.feedVideos.length) $('#feed-empty').hidden = false;
    else if (wasVisible) { const next = $('.video-slide'); if (next) next.scrollIntoView(); }
  }
}
$('#form-report').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $('button[type="submit"]', f);
  hideError($('#report-error'));
  btn.disabled = true;
  try {
    await apiJson('/api/videos/' + encodeURIComponent(state.currentVideoId) + '/report', 'POST', {
      reason: f.reason.value,
      details: f.details.value.trim() || undefined,
    });
    closeSheets();
    toast('Thanks — your report was sent.');
    f.reset();
  } catch (err) { showError($('#report-error'), err.message); }
  finally { btn.disabled = false; }
});

/* ---------------- Upload ---------------- */
$('#upload-file').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  const label = $('#file-label');
  const preview = $('#upload-preview');
  if (!file) { label.textContent = 'Choose a video (MP4, MOV, or WebM)'; preview.hidden = true; preview.removeAttribute('src'); return; }
  label.textContent = 'Selected: ' + file.name;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
});
$('#form-upload').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const file = $('#upload-file').files[0];
  const btn = $('#btn-upload-submit');
  hideError($('#upload-error'));
  if (!file) { showError($('#upload-error'), 'Please choose a video file first.'); return; }
  const form = new FormData();
  form.append('video', file);
  form.append('caption', f.caption.value.trim());
  form.append('mood', (f.querySelector('input[name="mood"]:checked') || {}).value || 'caliente');
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const res = await fetch('/api/upload', { method: 'POST', credentials: 'same-origin', body: form });
    let data = null;
    try { data = await res.json(); } catch (err) { data = null; }
    if (!res.ok) throw new Error((data && data.error) || ('Upload failed (' + res.status + ')'));
    toast('Video posted!');
    f.reset();
    $('#file-label').textContent = 'Choose a video (MP4, MOV, or WebM)';
    const preview = $('#upload-preview');
    preview.hidden = true; preview.removeAttribute('src');
    state.mood = 'all';
    $$('.mood-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.mood === 'all'));
    showView('feed');
    await loadFeed();
  } catch (err) {
    showError($('#upload-error'), err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Post video';
  }
});

/* ---------------- Profile ---------------- */
async function openProfile(username) {
  state.profileUsername = username;
  showView('profile');
  const content = $('#profile-content');
  content.innerHTML = '<p class="empty-note">Loading profile…</p>';
  try {
    const data = await api('/api/profile/' + encodeURIComponent(username));
    renderProfile(data.profile, data.videos || []);
  } catch (err) {
    content.innerHTML = '<p class="form-error">' + escapeHtml(err.message) + '</p>';
  }
}

function renderProfile(p, videos) {
  const isOwn = !!p.isOwn;
  const initial = (p.displayName || p.username || '?').charAt(0).toUpperCase();
  let html = '' +
    '<div class="profile-head">' +
      '<div class="avatar" aria-hidden="true">' + escapeHtml(initial) + '</div>' +
      '<h2>' + escapeHtml(p.displayName || p.username) + '</h2>' +
      '<p class="handle">@' + escapeHtml(p.username) + '</p>' +
      (p.bio ? '<p class="bio">' + escapeHtml(p.bio) + '</p>' : '') +
      '<div class="profile-counts">' +
        '<div class="count"><b>' + fmtCount(p.postCount) + '</b><span>Posts</span></div>' +
        '<div class="count"><b>' + fmtCount(p.followingCount) + '</b><span>Following</span></div>' +
        '<div class="count"><b id="profile-follower-count">' + fmtCount(p.followerCount) + '</b><span>Followers</span></div>' +
      '</div>' +
      '<div class="profile-actions">';
  if (isOwn) {
    html += '<button type="button" class="btn" id="btn-edit-profile">Edit profile</button>' +
            '<button type="button" class="btn" id="btn-logout">Log out</button>';
  } else {
    html += '<button type="button" class="btn btn-primary" id="btn-follow">' + (p.isFollowing ? 'Unfollow' : 'Follow') + '</button>' +
            '<button type="button" class="btn" id="btn-block-user">Block</button>';
  }
  html += '</div></div>';

  if (isOwn) {
    html += '<form id="form-edit-profile" hidden>' +
      '<label>Display name<input type="text" name="displayName" value="' + escapeHtml(p.displayName || '') + '" required></label>' +
      '<label>Bio<textarea name="bio" rows="3" maxlength="200">' + escapeHtml(p.bio || '') + '</textarea></label>' +
      '<p class="form-error" id="edit-profile-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn-primary btn-block">Save profile</button>' +
    '</form>';
  }

  html += '<div class="profile-section"><h3>Videos</h3>';
  if (!videos.length) {
    html += '<p class="empty-note">' + (isOwn ? 'You have not posted any videos yet.' : '@' + escapeHtml(p.username) + ' has not posted any videos yet.') + '</p>';
  } else {
    html += '<div class="profile-videos">' + videos.map((v) => {
      const media = v.thumbnailUrl
        ? '<img src="' + escapeHtml(v.thumbnailUrl) + '" alt="" loading="lazy">'
        : '<video src="' + escapeHtml(v.url) + '" preload="metadata" muted playsinline></video>';
      return '<div class="profile-video" data-video-id="' + escapeHtml(v.id) + '">' +
        '<button type="button" class="profile-video" data-watch="' + escapeHtml(v.id) + '" aria-label="Watch video" style="position:absolute;inset:0;width:100%;height:100%;">' + media +
        '<span class="pv-meta">🔥 ' + fmtCount(v.likeCount) + ' · 💬 ' + fmtCount(v.commentCount) + '</span></button>' +
        (isOwn ? '<button type="button" class="pv-delete" data-delete="' + escapeHtml(v.id) + '">Delete</button>' : '') +
      '</div>';
    }).join('') + '</div>';
  }
  html += '</div>';

  if (isOwn) {
    html += '<div class="profile-section"><h3>Blocked creators</h3><div id="blocked-list-wrap"><p class="empty-note">Loading…</p></div></div>';
  }

  html += '<p class="profile-legal">' +
    '<button type="button" class="linklike" data-legal="terms">Terms of Service</button> · ' +
    '<button type="button" class="linklike" data-legal="privacy">Privacy Policy</button></p>';

  $('#profile-content').innerHTML = html;

  // Wire up the freshly rendered controls.
  $$('#profile-content [data-legal]').forEach((b) => b.addEventListener('click', () => openLegal(b.dataset.legal)));
  if (isOwn) {
    $('#btn-edit-profile').addEventListener('click', () => {
      const form = $('#form-edit-profile');
      form.hidden = !form.hidden;
    });
    $('#form-edit-profile').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      hideError($('#edit-profile-error'));
      try {
        const data = await apiJson('/api/profile', 'POST', {
          displayName: f.displayName.value.trim(),
          bio: f.bio.value.trim(),
        });
        toast('Profile saved.');
        await openProfile(state.profileUsername);
        void data;
      } catch (err) { showError($('#edit-profile-error'), err.message); }
    });
    $('#btn-logout').addEventListener('click', async () => {
      try { await apiJson('/api/logout', 'POST', {}); } catch (err) { /* still log out locally */ }
      state.user = null;
      state.feedVideos = [];
      showView('auth');
      setAuthTab('login');
    });
    loadBlockedList();
  } else {
    $('#btn-follow').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      try {
        const data = await apiJson('/api/users/' + encodeURIComponent(p.username) + '/follow', 'POST', {});
        btn.textContent = data.following ? 'Unfollow' : 'Follow';
        const fc = $('#profile-follower-count');
        if (fc) fc.textContent = fmtCount(data.followerCount);
      } catch (err) { toast(err.message); }
      finally { btn.disabled = false; }
    });
    $('#btn-block-user').addEventListener('click', () => {
      askConfirm('Block @' + p.username + '?',
        'You will no longer see videos from @' + p.username + '.',
        'Block', async () => {
          try {
            await apiJson('/api/users/' + encodeURIComponent(p.username) + '/block', 'POST', {});
            toast('Blocked @' + p.username + '.');
            showView('feed');
            await loadFeed();
          } catch (err) { toast(err.message); }
        });
    });
  }

  // Watch / delete on profile videos.
  $$('#profile-content [data-watch]').forEach((b) => b.addEventListener('click', () => watchVideoInFeed(b.dataset.watch)));
  $$('#profile-content [data-delete]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const videoId = b.dataset.delete;
    askConfirm('Delete this video?', 'This cannot be undone.', 'Delete', async () => {
      try {
        await apiJson('/api/videos/' + encodeURIComponent(videoId) + '/delete', 'POST', {});
        toast('Video deleted.');
        await openProfile(state.profileUsername);
      } catch (err) { toast(err.message); }
    });
  }));
}

async function loadBlockedList() {
  const wrap = $('#blocked-list-wrap');
  if (!wrap) return;
  try {
    const data = await api('/api/blocked');
    const list = data.blocked || [];
    if (!list.length) { wrap.innerHTML = '<p class="empty-note">No blocked creators.</p>'; return; }
    wrap.innerHTML = '<ul class="blocked-list">' + list.map((u) =>
      '<li><span class="blocked-name">' + escapeHtml(u.displayName || u.username) +
      '<small>@' + escapeHtml(u.username) + '</small></span>' +
      '<button type="button" class="btn" data-unblock="' + escapeHtml(u.username) + '">Unblock</button></li>').join('') + '</ul>';
    $$('[data-unblock]', wrap).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await apiJson('/api/users/' + encodeURIComponent(b.dataset.unblock) + '/unblock', 'POST', {});
        toast('Unblocked @' + b.dataset.unblock + '.');
        await loadBlockedList();
      } catch (err) { toast(err.message); b.disabled = false; }
    }));
  } catch (err) {
    wrap.innerHTML = '<p class="form-error">' + escapeHtml(err.message) + '</p>';
  }
}

/* Tap a profile video -> watch it in the feed (scroll to it, or reload feed and find it). */
async function watchVideoInFeed(videoId) {
  showView('feed');
  let slide = $('.video-slide[data-video-id="' + CSS.escape(String(videoId)) + '"]');
  if (!slide) {
    // Not in the current (mood-filtered) feed — reset to All and reload.
    state.mood = 'all';
    $$('.mood-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.mood === 'all'));
    await loadFeed();
    slide = $('.video-slide[data-video-id="' + CSS.escape(String(videoId)) + '"]');
  }
  if (slide) slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else toast('That video is not in the feed right now.');
}

/* ---------------- Boot ---------------- */
(async function init() {
  setAuthTab('signup');
  try {
    const data = await api('/api/session');
    if (data && data.user) {
      state.user = data.user;
      showView('feed');
      await loadFeed();
    } else {
      showView('auth');
    }
  } catch (err) {
    // Backend unreachable / session check failed: stay on auth so the
    // user can still read Terms/Privacy and retry logging in.
    showView('auth');
  }
})();
