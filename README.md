# Playmar reels plan

https://jetmetrics-io.github.io/playmar-plan/ (password).

Only the page code lives here. The plan, the ticks and the videos are in a private repo; the page reads and
writes them through the GitHub API with a key from `auth.json`. The key is encrypted with the password
(PBKDF2-SHA256, 600,000 iterations, then AES-256-GCM) and is decrypted in the browser only.

Fonts: Ubuntu, Ubuntu Font Licence 1.0 (`fonts/UFL.txt`). Icons: Lucide, ISC.
Do not edit here: the next publish overwrites it.
