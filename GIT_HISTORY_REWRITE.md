# ⚠️ Git History Rewrite Notice

## What Happened

On February 26, 2026, we rewrote the entire git history of this repository to remove sensitive credentials that were accidentally committed in the past.

## What Was Removed

The following sensitive information was removed from ALL commits:

- Database password: `w4Qd2pW2bYiIZjkj96aa`
- Database hostname: `masterpg.cc1zpwoqvmxn.us-east-1.rds.amazonaws.com`
- Database username: `adminpg`
- JWT secrets: `menodao-dev-jwt-secret-2024` and production variants

All occurrences were replaced with `***REMOVED***` placeholder.

## Tool Used

[BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) - A faster, simpler alternative to `git filter-branch` for removing sensitive data.

## Impact on Contributors

### If You Have a Local Clone

Your local repository will have the OLD history. You need to update:

```bash
# Save any local changes
git stash

# Fetch the new history
git fetch origin

# Reset your branches to match the new history
git reset --hard origin/main  # or origin/dev

# Apply your stashed changes if any
git stash pop
```

### If You Have Open Pull Requests

Your PRs will need to be rebased on the new history:

```bash
# Update your local main/dev
git fetch origin
git checkout main
git reset --hard origin/main

# Rebase your feature branch
git checkout your-feature-branch
git rebase main

# Force push (your PR will update automatically)
git push --force-with-lease origin your-feature-branch
```

## Verification

To verify the sensitive data is gone:

```bash
# Search for the old database password (should return nothing)
git log --all --source --full-history -S "w4Qd2pW2bYiIZjkj96aa"

# Search for the old hostname (should return nothing)
git log --all --source --full-history -S "masterpg.cc1zpwoqvmxn"
```

## Backup

A backup of the original repository (with sensitive data) was created at:

- `/tmp/menodao-backend-backup.git` (on the machine that performed the rewrite)

This backup will be securely deleted after confirming the rewrite was successful.

## Security Actions Taken

1. ✅ Git history rewritten
2. ✅ All sensitive strings replaced
3. ✅ Git reflog expired
4. ✅ Garbage collection performed
5. ⏳ Force push to GitHub (pending)
6. ⏳ Rotate all exposed credentials (required after push)

## Questions?

If you have questions about this rewrite, please contact the maintainers.

---

**Date**: February 26, 2026  
**Performed By**: Repository Maintainers  
**Reason**: Preparing repository for open source release
