'use strict';

// Database connection + schema for Picante.
// Uses DATABASE_URL when set (Render Postgres needs SSL with
// rejectUnauthorized:false). Without DATABASE_URL the pool falls back to
// pg's defaults and initDb() will fail at startup (see server/index.js).

const { Pool } = require('pg');

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {}
);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  bio TEXT DEFAULT '',
  dob DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  cloudinary_public_id TEXT,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  caption TEXT DEFAULT '',
  mood TEXT NOT NULL,
  share_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS likes (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  video_id INT REFERENCES videos(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, video_id)
);

CREATE TABLE IF NOT EXISTS saves (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  video_id INT REFERENCES videos(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, video_id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INT REFERENCES users(id) ON DELETE CASCADE,
  following_id INT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  video_id INT REFERENCES videos(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  reporter_id INT REFERENCES users(id) ON DELETE CASCADE,
  video_id INT REFERENCES videos(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INT REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INT REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_videos_user_id ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);
CREATE INDEX IF NOT EXISTS idx_likes_video_id ON likes(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id);
`;

async function initDb() {
  await pool.query(SCHEMA);
}

module.exports = { pool, initDb };
