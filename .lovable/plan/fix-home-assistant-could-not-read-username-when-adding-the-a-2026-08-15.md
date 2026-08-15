# Fix: Home Assistant "could not read Username" when adding the add-on repository

## Root cause (verified)

Home Assistant clones add-on repos over HTTPS **without credentials**. The repo
`https://github.com/arobe14039/frigate-eye.git` returns a credential prompt
(`fatal: could not read Username`), which means one of:

- the GitHub repository does not exist yet, or
- the repository is **private** (HA cannot clone private repos in this flow).

Confirmed in the sandbox: `git ls-remote https://github.com/arobe14039/frigate-eye.git`
fails with the exact same error, and the project's only git remote is Lovable's
private storage — there is no GitHub remote yet.

A second issue: `repository.yaml` and `modern-frigate-ui/config.yaml` still contain
`REPLACE_ME` placeholder URLs, so even after the repo exists the HA panel would show
wrong links.

## What needs to happen

1. **Publish the project to a real, PUBLIC GitHub repository.**
   - Use Lovable's Git sync: Plus (+) menu → GitHub → Connect project, then
     create the repo as `arobe14039/frigate-eye` (public).
   - This pushes the current code (including `repository.yaml` at the repo root
     and `modern-frigate-ui/` add-on folder) to GitHub.
   - The repo **must be public** — HA's add-on clone has no credentials.

2. **Replace the placeholder URLs** so HA shows correct metadata:
   - `repository.yaml`: `url` → `https://github.com/arobe14039/frigate-eye`
   - `modern-frigate-ui/config.yaml`: `url` → `https://github.com/arobe14039/frigate-eye`

3. **Re-add the repository in Home Assistant** using:
   `https://github.com/arobe14039/frigate-eye` — then install the
   "Modern Frigate UI" add-on.

## Changes I will make (after approval)

Edit two files to swap `REPLACE_ME` placeholders for the real repo URL:

- `repository.yaml` — set `url` and `maintainer`.
- `modern-frigate-ui/config.yaml` — set `url`.

No code/logic changes are needed; the 500-on-clone error is purely a
missing/private-repo problem.

## What I cannot do for you (requires your action in the UI)

- Create the public GitHub repo via Git sync (Plus menu → GitHub → Connect project).
- If the repo already exists but is private, make it public in GitHub settings.

Once the public repo exists and the URL edits are synced to it, HA will clone it
successfully.
