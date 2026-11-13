'use strict';

// Video upload: Cloudinary in production, local disk fallback for dev only.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;

const configured =
  Boolean(process.env.CLOUDINARY_CLOUD_NAME) &&
  Boolean(process.env.CLOUDINARY_API_KEY) &&
  Boolean(process.env.CLOUDINARY_API_SECRET);

if (configured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function uploadToCloudinary(buffer, filename) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'video', folder: 'picante', public_id: filename },
      (err, result) => {
        if (err) return reject(err);
        const thumbnailUrl = cloudinary.url(result.public_id, {
          resource_type: 'video',
          format: 'jpg',
          transformation: [{ width: 540, height: 960, crop: 'fill' }],
        });
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
          thumbnail_url: thumbnailUrl,
        });
      }
    );
    stream.end(buffer);
  });
}

// Upload a video buffer. Returns {url, public_id, thumbnail_url}.
// DEV-ONLY FALLBACK: when Cloudinary is not configured, the file is written
// to ../uploads/ and served locally as /uploads/<name>. This fallback is for
// local development only — production must use Cloudinary.
async function uploadVideo(buffer, filename) {
  if (configured) {
    return uploadToCloudinary(buffer, filename);
  }
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  await fs.promises.mkdir(uploadsDir, { recursive: true });
  const ext = path.extname(filename) || '.mp4';
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  await fs.promises.writeFile(path.join(uploadsDir, name), buffer);
  return { url: `/uploads/${name}`, public_id: null, thumbnail_url: null };
}

// Delete a video from Cloudinary by public_id. No-op when Cloudinary is
// not configured or no public_id is given.
async function deleteVideo(publicId) {
  if (!configured || !publicId) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
}

module.exports = { uploadVideo, deleteVideo, cloudinaryConfigured: configured };
