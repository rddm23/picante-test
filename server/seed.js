'use strict';

// Seed script for Picante: inserts the clips from server/seed-clips.json
// as videos by the system user "picante", but only when the videos table
// is empty. Shared by server/index.js (auto-seed on startup) and runnable
// standalone: `node server/seed.js` (uses DATABASE_URL from env).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SYSTEM_USERNAME = 'picante';

async function seedIfEmpty(pool) {
  const clipsPath = path.join(__dirname, 'seed-clips.json');
  if (!fs.existsSync(clipsPath)) return { seeded: false, reason: 'no seed-clips.json' };

  let clips;
  try {
    clips = JSON.parse(fs.readFileSync(clipsPath, 'utf8'));
  } catch (err) {
    console.error('seed: could not parse seed-clips.json:', err.message);
    return { seeded: false, reason: 'unparseable seed-clips.json' };
  }
  if (!Array.isArray(clips)) return { seeded: false, reason: 'seed-clips.json is not an array' };

  const { rows: existing } = await pool.query('SELECT COUNT(*)::int AS n FROM videos');
  if (existing[0].n > 0) return { seeded: false, reason: 'videos table not empty' };

  // Ensure the system user exists.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, display_name, bio, dob)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    [SYSTEM_USERNAME, passwordHash, 'Picante', 'Official Picante clips.', '1990-01-01']
  );
  let systemUserId;
  if (rows.length > 0) {
    systemUserId = rows[0].id;
  } else {
    const found = await pool.query('SELECT id FROM users WHERE username = $1', [SYSTEM_USERNAME]);
    systemUserId = found.rows[0].id;
  }

  let inserted = 0;
  for (const clip of clips) {
    if (!clip || typeof clip.url !== 'string' || typeof clip.mood !== 'string') continue;
    await pool.query(
      `INSERT INTO videos (user_id, cloudinary_public_id, url, thumbnail_url, caption, mood)
       VALUES ($1, NULL, $2, NULL, $3, $4)`,
      [systemUserId, clip.url, clip.caption || '', clip.mood]
    );
    inserted += 1;
  }
  return { seeded: true, inserted };
}

// Standalone: `node server/seed.js`
if (require.main === module) {
  (async () => {
    const { pool, initDb } = require('./db');
    try {
      await initDb();
      const result = await seedIfEmpty(pool);
      console.log('seed result:', result);
    } catch (err) {
      console.error('seed failed:', err.message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}

module.exports = { seedIfEmpty };
