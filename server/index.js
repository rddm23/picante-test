'use strict';

// Picante backend — Express API for the TikTok-style short-video app.
// All responses are JSON; errors are {error: "message"}.

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const { pool, initDb } = require('./db');
const auth = require('./auth');
const { uploadVideo, deleteVideo } = require('./cloudinary');
const { TERMS, PRIVACY } = require('./legal');
const { seedIfEmpty } = require('./seed');

const app = express();
const PORT = process.env.PORT || 3000;
const MOODS = ['caliente', 'chill', 'foodie', 'streets'];
const REPORT_REASONS = ['spam', 'nudity', 'violence', 'harassment', 'copyright', 'other'];
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

app.use(helmet());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ---------- helpers ----------

function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name, bio: row.bio };
}

// Shape a video row (from videoQuery) into the API contract shape.
function formatVideo(row) {
  return {
    id: row.id,
    user: { username: row.username, displayName: row.display_name },
    url: row.url,
    thumbnailUrl: row.thumbnail_url,
    caption: row.caption,
    mood: row.mood,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    likeCount: Number(row.like_count),
    commentCount: Number(row.comment_count),
    saveCount: Number(row.save_count),
    shareCount: Number(row.share_count),
    liked: Boolean(row.liked),
    saved: Boolean(row.saved),
    following: Boolean(row.following),
    isOwn: Boolean(row.is_own),
  };
}

// Base SELECT for videos, with counts and per-viewer flags.
// $1 is always the viewer user id (or null when logged out).
const VIDEO_SELECT = `
  SELECT v.id, v.user_id, v.url, v.thumbnail_url, v.caption, v.mood,
         v.share_count, v.created_at,
         u.username, u.display_name,
         (SELECT COUNT(*)::int FROM likes l WHERE l.video_id = v.id) AS like_count,
         (SELECT COUNT(*)::int FROM comments c WHERE c.video_id = v.id) AS comment_count,
         (SELECT COUNT(*)::int FROM saves s WHERE s.video_id = v.id) AS save_count,
         ($1::int IS NOT NULL AND EXISTS (SELECT 1 FROM likes WHERE user_id = $1 AND video_id = v.id)) AS liked,
         ($1::int IS NOT NULL AND EXISTS (SELECT 1 FROM saves WHERE user_id = $1 AND video_id = v.id)) AS saved,
         ($1::int IS NOT NULL AND EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = v.user_id)) AS following,
         ($1::int IS NOT NULL AND v.user_id = $1) AS is_own
    FROM videos v
    JOIN users u ON u.id = v.user_id
`;

async function getVideoById(id, viewerId) {
  const { rows } = await pool.query(`${VIDEO_SELECT} WHERE v.id = $2`, [viewerId || null, id]);
  return rows.length ? formatVideo(rows[0]) : null;
}

async function videoExists(id) {
  const { rows } = await pool.query('SELECT id, user_id, cloudinary_public_id FROM videos WHERE id = $1', [id]);
  return rows[0] || null;
}

// Simple in-memory rate limit for /api/login: 10 attempts per IP per 10 min.
const loginAttempts = new Map(); // ip -> { count, windowStart }
function loginRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const WINDOW_MS = 10 * 60 * 1000;
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    loginAttempts.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > 10) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again in a few minutes.' });
  }
  next();
}

const requireAuth = auth.requireAuth(pool);
const optionalAuth = auth.optionalAuth(pool);

// ---------- health & legal ----------

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/legal/terms', (req, res) => res.json({ title: 'Terms of Service', body: TERMS }));
app.get('/api/legal/privacy', (req, res) => res.json({ title: 'Privacy Policy', body: PRIVACY }));

// ---------- auth ----------

app.post('/api/signup', async (req, res) => {
  try {
    const { username, password, displayName, dob } = req.body || {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 characters, letters, numbers, or underscore.' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    const dobError = auth.validateDob(dob);
    if (dobError) return res.status(400).json({ error: dobError });

    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    const passwordHash = await auth.hashPassword(password);
    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim() : username;
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash, display_name, bio, dob) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, display_name, bio',
      [username, passwordHash, name, '', dob]
    );
    const user = publicUser(rows[0]);
    await auth.createSession(pool, res, user.id);
    return res.status(201).json({ user });
  } catch (err) {
    console.error('signup error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/login', loginRateLimit, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    const { rows } = await pool.query(
      'SELECT id, username, password_hash, display_name, bio FROM users WHERE username = $1',
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid username or password.' });
    const ok = await auth.comparePassword(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });
    const user = publicUser(rows[0]);
    await auth.createSession(pool, res, user.id);
    return res.json({ user });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    await auth.destroySession(pool, req, res);
  } catch (err) {
    console.error('logout error:', err);
  }
  return res.json({ ok: true });
});

app.get('/api/session', optionalAuth, (req, res) => {
  return res.json({ user: req.user || null });
});

// ---------- feed & profile ----------

app.get('/api/feed', optionalAuth, async (req, res) => {
  try {
    const mood = req.query.mood || 'all';
    if (mood !== 'all' && !MOODS.includes(mood)) {
      return res.status(400).json({ error: 'Invalid mood. Use all, caliente, chill, foodie, or streets.' });
    }
    const viewerId = req.user ? req.user.id : null;
    const { rows } = await pool.query(
      `${VIDEO_SELECT}
        WHERE ($2::text IS NULL OR v.mood = $2)
          AND ($1::int IS NULL OR NOT EXISTS (
            SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = v.user_id))
        ORDER BY v.created_at DESC, v.id DESC
        LIMIT 50`,
      [viewerId, mood === 'all' ? null : mood]
    );
    return res.json({ videos: rows.map(formatVideo) });
  } catch (err) {
    console.error('feed error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/profile/:username', optionalAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, display_name, bio FROM users WHERE username = $1',
      [req.params.username]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const target = rows[0];
    const viewerId = req.user ? req.user.id : null;

    const [followers, following, posts] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM follows WHERE following_id = $1', [target.id]),
      pool.query('SELECT COUNT(*)::int AS n FROM follows WHERE follower_id = $1', [target.id]),
      pool.query('SELECT COUNT(*)::int AS n FROM videos WHERE user_id = $1', [target.id]),
    ]);
    let isFollowing = false;
    let isBlocked = false;
    if (viewerId) {
      const rel = await pool.query(
        `SELECT
           EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) AS is_following,
           EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2) AS is_blocked`,
        [viewerId, target.id]
      );
      isFollowing = rel.rows[0].is_following;
      isBlocked = rel.rows[0].is_blocked;
    }
    const { rows: videoRows } = await pool.query(
      `${VIDEO_SELECT} WHERE v.user_id = $2 ORDER BY v.created_at DESC, v.id DESC LIMIT 50`,
      [viewerId, target.id]
    );
    return res.json({
      profile: {
        username: target.username,
        displayName: target.display_name,
        bio: target.bio,
        followerCount: followers.rows[0].n,
        followingCount: following.rows[0].n,
        postCount: posts.rows[0].n,
        isOwn: viewerId === target.id,
        isFollowing,
        isBlocked,
      },
      videos: videoRows.map(formatVideo),
    });
  } catch (err) {
    console.error('profile error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/profile', requireAuth, async (req, res) => {
  try {
    const { displayName, bio } = req.body || {};
    if (displayName !== undefined && (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 50)) {
      return res.status(400).json({ error: 'Display name must be 1-50 characters.' });
    }
    if (bio !== undefined && (typeof bio !== 'string' || bio.length > 500)) {
      return res.status(400).json({ error: 'Bio must be 500 characters or fewer.' });
    }
    const { rows } = await pool.query(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         bio = COALESCE($3, bio)
       WHERE id = $1
       RETURNING username, display_name, bio`,
      [req.user.id, displayName !== undefined ? displayName.trim() : null, bio !== undefined ? bio : null]
    );
    const r = rows[0];
    return res.json({ profile: { username: r.username, displayName: r.display_name, bio: r.bio } });
  } catch (err) {
    console.error('update profile error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- upload & video actions ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.mp4', '.mov', '.webm'].includes(ext)) return cb(null, true);
    return cb(new Error('Only mp4, mov, and webm videos are allowed.'));
  },
});

app.post('/api/upload', requireAuth, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded.' });
    const caption = typeof req.body.caption === 'string' ? req.body.caption : '';
    const mood = req.body.mood;
    if (!MOODS.includes(mood)) {
      return res.status(400).json({ error: 'Mood must be one of caliente, chill, foodie, or streets.' });
    }
    if (caption.length > 500) {
      return res.status(400).json({ error: 'Caption must be 500 characters or fewer.' });
    }
    const ext = path.extname(req.file.originalname || '.mp4').toLowerCase();
    const filename = `${Date.now()}-${req.user.id}${ext}`;
    const uploaded = await uploadVideo(req.file.buffer, filename);
    const { rows } = await pool.query(
      `INSERT INTO videos (user_id, cloudinary_public_id, url, thumbnail_url, caption, mood)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, uploaded.public_id, uploaded.url, uploaded.thumbnail_url, caption, mood]
    );
    const video = await getVideoById(rows[0].id, req.user.id);
    return res.status(201).json({ video });
  } catch (err) {
    console.error('upload error:', err);
    return res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

app.post('/api/videos/:id/delete', requireAuth, async (req, res) => {
  try {
    const video = await videoExists(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    if (video.user_id !== req.user.id) return res.status(403).json({ error: 'You can only delete your own videos.' });
    if (video.cloudinary_public_id) {
      try {
        await deleteVideo(video.cloudinary_public_id);
      } catch (err) {
        console.error('cloudinary delete error:', err);
      }
    }
    await pool.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('delete video error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/videos/:id/like', requireAuth, async (req, res) => {
  try {
    const video = await videoExists(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    const { rows } = await pool.query('SELECT 1 FROM likes WHERE user_id = $1 AND video_id = $2', [req.user.id, video.id]);
    let liked;
    if (rows.length > 0) {
      await pool.query('DELETE FROM likes WHERE user_id = $1 AND video_id = $2', [req.user.id, video.id]);
      liked = false;
    } else {
      await pool.query('INSERT INTO likes (user_id, video_id) VALUES ($1, $2)', [req.user.id, video.id]);
      liked = true;
    }
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM likes WHERE video_id = $1', [video.id]);
    return res.json({ liked, likeCount: count.rows[0].n });
  } catch (err) {
    console.error('like error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/videos/:id/save', requireAuth, async (req, res) => {
  try {
    const video = await videoExists(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    const { rows } = await pool.query('SELECT 1 FROM saves WHERE user_id = $1 AND video_id = $2', [req.user.id, video.id]);
    let saved;
    if (rows.length > 0) {
      await pool.query('DELETE FROM saves WHERE user_id = $1 AND video_id = $2', [req.user.id, video.id]);
      saved = false;
    } else {
      await pool.query('INSERT INTO saves (user_id, video_id) VALUES ($1, $2)', [req.user.id, video.id]);
      saved = true;
    }
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM saves WHERE video_id = $1', [video.id]);
    return res.json({ saved, saveCount: count.rows[0].n });
  } catch (err) {
    console.error('save error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/videos/:id/share', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE videos SET share_count = share_count + 1 WHERE id = $1 RETURNING share_count',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Video not found.' });
    return res.json({ shareCount: rows[0].share_count });
  } catch (err) {
    console.error('share error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/videos/:id/report', requireAuth, async (req, res) => {
  try {
    const video = await videoExists(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    const { reason, details } = req.body || {};
    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'Reason must be one of spam, nudity, violence, harassment, copyright, or other.' });
    }
    await pool.query(
      'INSERT INTO reports (reporter_id, video_id, reason, details) VALUES ($1, $2, $3, $4)',
      [req.user.id, video.id, reason, typeof details === 'string' ? details : '']
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('report error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- comments ----------

app.get('/api/videos/:id/comments', async (req, res) => {
  try {
    const video = await videoExists(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    const { rows } = await pool.query(
      `SELECT c.id, c.text, c.created_at, u.username, u.display_name
         FROM comments c JOIN users u ON u.id = c.user_id
        WHERE c.video_id = $1
        ORDER BY c.created_at ASC, c.id ASC`,
      [video.id]
    );
    return res.json({
      comments: rows.map((r) => ({
        id: r.id,
        user: { username: r.username, displayName: r.display_name },
        text: r.text,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      })),
    });
  } catch (err) {
    console.error('list comments error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/videos/:id/comments', requireAuth, async (req, res) => {
  try {
    const video = await videoExists(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found.' });
    const { text } = req.body || {};
    if (typeof text !== 'string' || text.trim().length < 1 || text.length > 500) {
      return res.status(400).json({ error: 'Comment must be 1-500 characters.' });
    }
    const { rows } = await pool.query(
      'INSERT INTO comments (user_id, video_id, text) VALUES ($1, $2, $3) RETURNING id, text, created_at',
      [req.user.id, video.id, text]
    );
    const c = rows[0];
    return res.status(201).json({
      comment: {
        id: c.id,
        user: { username: req.user.username, displayName: req.user.displayName },
        text: c.text,
        createdAt: c.created_at instanceof Date ? c.created_at.toISOString() : c.created_at,
      },
    });
  } catch (err) {
    console.error('add comment error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- follow / block ----------

app.post('/api/users/:username/follow', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [req.params.username]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const targetId = rows[0].id;
    if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot follow yourself.' });
    const existing = await pool.query(
      'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
      [req.user.id, targetId]
    );
    let following;
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [req.user.id, targetId]);
      following = false;
    } else {
      await pool.query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [req.user.id, targetId]);
      following = true;
    }
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM follows WHERE following_id = $1', [targetId]);
    return res.json({ following, followerCount: count.rows[0].n });
  } catch (err) {
    console.error('follow error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/users/:username/block', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [req.params.username]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const targetId = rows[0].id;
    if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot block yourself.' });
    await pool.query(
      'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, targetId]
    );
    // Remove follows in both directions.
    await pool.query(
      `DELETE FROM follows
        WHERE (follower_id = $1 AND following_id = $2)
           OR (follower_id = $2 AND following_id = $1)`,
      [req.user.id, targetId]
    );
    return res.json({ blocked: true });
  } catch (err) {
    console.error('block error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/users/:username/unblock', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [req.params.username]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    await pool.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, rows[0].id]);
    return res.json({ blocked: false });
  } catch (err) {
    console.error('unblock error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/blocked', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.username, u.display_name
         FROM blocks b JOIN users u ON u.id = b.blocked_id
        WHERE b.blocker_id = $1
        ORDER BY u.username ASC`,
      [req.user.id]
    );
    return res.json({ blocked: rows.map((r) => ({ username: r.username, displayName: r.display_name })) });
  } catch (err) {
    console.error('blocked list error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- error handling ----------

// Multer errors (bad file type / file too large) -> 400 JSON.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Video must be 100MB or smaller.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message === 'Only mp4, mov, and webm videos are allowed.') {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

app.use((err, req, res, next) => {
  console.error('unhandled error:', err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ---------- startup ----------

// pg can surface connection failures as an AggregateError with an empty
// top-level message; surface the nested errors and code instead.
function describeDbError(err) {
  if (!err) return 'unknown error';
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    return err.errors.map((e) => e.message || e.code || String(e)).join('; ');
  }
  return err.message || err.code || String(err);
}

async function start() {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await initDb();
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      console.error(`initDb attempt ${attempt}/5 failed: ${describeDbError(err)}`);
      if (attempt < 5) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (lastError) {
    console.error(`Could not connect to the database after 5 attempts (${describeDbError(lastError)}). Check DATABASE_URL and restart.`);
    process.exit(1);
  }
  console.log('Database ready.');

  try {
    const result = await seedIfEmpty(pool);
    if (result.seeded) console.log(`Seeded ${result.inserted} clip(s) from seed-clips.json.`);
  } catch (err) {
    console.error('Auto-seed failed (continuing):', err.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Picante backend listening on 0.0.0.0:${PORT}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = app;
