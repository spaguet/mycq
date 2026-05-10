# MyCQ v2

MyCQ is an ICQ-inspired PWA messenger prototype built around a decentralized transport.

Current MVP status:

- Static PWA, no paid backend.
- Local onboarding.
- Nostr key generation in the browser.
- Private key encryption with a user password via Web Crypto.
- Local contacts.
- Encrypted Nostr direct messages over public relays.
- Manual and periodic relay sync.
- Self-contact protection.
- ICQ-like contact authorization requests.
- Public Nostr contact-request events for reliable discovery.
- Optional `ntfy.sh` notifications without message text.
- Profile restore from `nsec...` backup key.
- Enter-to-send with Shift+Enter for a new line.
- Nostr profile metadata publishing.
- Contact profile metadata sync from Nostr.
- Profile nickname editing and local contact renaming.
- Authorized contacts are protected from old pending request replays.
- Compact settings entry for profile, ntfy, backup, and sync.
- Settings modal for profile name, UIN, ntfy tests, backup, and sync.
- Add contact modal.
- Share own UIN by copy, native share, or downloadable contact file.
- Responsive desktop/mobile layout with a mobile contact-list/chat switch.
- Restore modal and contact-file import.
- Faster relay publishing and polling; removed manual sync and temporary emoji button.
- ICQ-like skeuomorphic UI.

Next steps:

1. Publish the user's Nostr profile metadata.
2. Add contact request/authorization UX.
3. Improve backup and account recovery UX.
4. Move from legacy NIP-04 DMs to newer NIP-44/NIP-17 private messaging.
5. Add native Web Push for installed PWA sessions.

## Run Locally

Use any local static server from this folder.

With Python:

```bash
python -m http.server 8080
```

On Windows, if `python` is not available:

```bash
py -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

For PWA install and service worker behavior, use `localhost` or HTTPS.

## Free Hosting

MyCQ is a static PWA, so it can be hosted for free without a backend.

Recommended options:

- Cloudflare Pages: upload/connect this folder as a static site. It supports HTTPS, PWA, and the `_headers` file.
- GitHub Pages: free static hosting, but custom headers are limited.
- Netlify: free static hosting and supports the `_headers` file.

For Cloudflare Pages:

1. Create a GitHub repository and push this folder.
2. In Cloudflare Pages, create a new project from the repository.
3. Build command: leave empty.
4. Output directory: `/` or project root.
5. Deploy.

After deployment, open the HTTPS URL and install the PWA from the browser menu.

Release checklist:

1. Increment `CACHE_NAME` in `sw.js`.
2. Commit and push changes.
3. Wait for Cloudflare Pages deployment.
4. Open the site and hard refresh once.

## Privacy Model

The app does not require a central MyCQ server. The private key is generated locally and encrypted before storage in `localStorage`.

Important limitation: if the user loses both the password and backup key, the account cannot be restored.

Messages are encrypted before publishing to Nostr relays. Relay operators can see metadata such as event time, sender public key, receiver public key, and relay usage, but not the message body.

Optional `ntfy.sh` notifications contain only a generic "new MyCQ message" text and the sender nickname. The message body is never sent to ntfy.
