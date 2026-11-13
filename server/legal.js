'use strict';

// Plain-language legal texts for Picante. Served via /api/legal/terms and
// /api/legal/privacy. These are starting texts, not legal advice; have a
// lawyer review them before a public launch.

const TERMS = `Terms of Service — Picante

Welcome to Picante, a short-video social app. By creating an account or using Picante, you agree to these terms.

1. Accounts and age. You must be at least 13 years old to join Picante. You are responsible for keeping your password secret and for everything posted from your account. Give us accurate information when you sign up, and do not create accounts for other people or pretend to be someone else.

2. Community rules. Be kind and lawful. Do not post anything illegal, harmful, hateful, harassing, threatening, or sexually explicit, and do not post content involving minors in a sexual way, non-consensual intimate images, or anything that encourages self-harm, violence, or dangerous behaviour. No spam, scams, impersonation, or deceptive content. We may remove content and suspend or delete accounts that break these rules, with or without warning.

3. Your content. You own the videos and other content you post. By posting, you give Picante a non-exclusive, worldwide licence to host, display, and share your content on the service so other people can watch it, and to use it to operate and promote Picante. You promise that what you post is yours to share or that you have permission to share it, and that it does not infringe anyone else's rights.

4. Copyright and DMCA takedowns. We respect copyright. If you believe content on Picante infringes your copyright, send us a takedown report using the in-app report button (choose "copyright") or contact us with: a description of the copyrighted work, a link to the infringing video, your name and contact details, and a statement that you believe in good faith the use is not authorised and that the information is accurate. We will review the report, remove content we find infringing, and may terminate accounts of repeat infringers.

5. Moderation and removal. We may review, hide, or remove any content, and limit, suspend, or close any account, at our discretion, including for breaking these terms or the law. Reporting content does not guarantee its removal, but every report is reviewed.

6. What we do not promise. Picante is provided "as is" and "as available", without warranties of any kind. We do not guarantee the service will always be available, error-free, or secure, or that any content on it is accurate. To the extent the law allows, we are not liable for content posted by other users or for losses arising from your use of the service.

7. Changes. We may update these terms from time to time. If we make a material change, we will let you know in the app. Continuing to use Picante after a change means you accept the new terms. If you do not agree, stop using Picante and delete your account.`;

const PRIVACY = `Privacy Policy — Picante

This policy explains what Picante collects, why, and what you can do about it. Picante is a short-video social app. We collect only what we need to run it.

What we collect. When you sign up we collect your username, a password hash (we never store your plain-text password), and your date of birth. Your date of birth is used only for the age check — to confirm you are at least 13 — and is never shown to other users. You may also add a display name and a bio. When you use Picante we collect the videos you upload, your likes, saves, comments, follows, shares, and reports, and basic technical information needed to keep the service working.

Why we collect it. Your account details let you sign in and let others see your profile. Your videos, likes, and comments are the service itself — they are shown to other users so they can watch, like, and comment. Session cookies keep you signed in. We use the information to operate, secure, and improve Picante, and to enforce our community rules.

Cookies and sessions. We use a single httpOnly session cookie to keep you signed in for up to 30 days. It contains only a random session token, not your password or personal details. Logging out deletes the session.

Video hosting. Videos you upload are hosted by Cloudinary, our video hosting provider. Uploaded videos are stored and delivered through Cloudinary under our account, and may be processed by Cloudinary to create playback and thumbnail versions. Cloudinary's own privacy practices apply to that hosting.

No sale of personal data. We do not sell your personal information to anyone, and we do not share it with advertisers. We share data only with service providers that help us run Picante (such as Cloudinary) and when required by law.

Under-13 policy. Picante is for people aged 13 and over. We do not knowingly collect information from children under 13. If we learn that an account belongs to someone under 13, we will delete it.

Your choices and data deletion. You can edit your profile, delete your own videos, block other users, and log out at any time. You can ask us to delete your account and your personal data by contacting us from the account email — we will delete your account, videos, likes, comments, and other content, except where we must keep limited records for legal or safety reasons. We keep your data only for as long as your account exists or as needed to run and protect the service.

Contact. If you have questions about this policy or want your data deleted, contact us through the app or by email and we will respond.`;

module.exports = { TERMS, PRIVACY };
