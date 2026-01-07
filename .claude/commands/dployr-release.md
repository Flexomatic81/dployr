---
description: Create a new Dployr release with changelog, tag, and GitHub release (project)
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
---

# Dployr Release Creator

Create a new release for Dployr with all necessary steps.

## Prerequisites Check

Before starting, verify:
```bash
# Must be on main branch
git branch --show-current

# Working directory must be clean
git status --porcelain

# Must be up to date with remote
git fetch origin main
git log HEAD..origin/main --oneline

# Check for draft releases (should be published before new release)
gh release list | grep -i draft
```

### Draft Release Check

If there are draft releases, they should be published first:
```bash
# Publish a draft release
gh release edit vX.X.X --draft=false
```

**Why?** When a draft is published after newer releases, GitHub may incorrectly mark it as "Latest".

## Release Process

### 1. Generate Changelog

Use the `/dployr-changelog` skill logic:

1. Find the last release tag:
   ```bash
   git describe --tags --abbrev=0 2>/dev/null || echo "No tags found"
   ```

2. Get commits since last release:
   ```bash
   git log <last-tag>..HEAD --oneline --no-merges
   ```

3. Categorize commits by prefix:
   | Prefix | Category |
   |--------|----------|
   | `Feat:` | Added |
   | `Fix:` | Fixed |
   | `Refactor:` | Changed |
   | `Docs:` | Documentation |
   | `Test:` | Tests |
   | `Chore:` | Maintenance |
   | `Security:` | Security |
   | `Perf:` | Performance |
   | `i18n:` | Internationalization |

4. Generate changelog entry in Keep a Changelog format

### 2. Determine Version Number

Suggest version based on Semantic Versioning:
- **Major (X.0.0)**: Breaking changes, major rewrites
- **Minor (0.X.0)**: New features (`Feat:` commits)
- **Patch (0.0.X)**: Bug fixes only (`Fix:` commits)

Ask user to confirm or modify the suggested version.

### 3. Update CHANGELOG.md

- If exists: Insert new version at the top (after header)
- If not exists: Create new file with header and first entry

### 4. Commit Changelog

```bash
git add CHANGELOG.md
git commit -m "Docs: Update CHANGELOG for vX.X.X"
git push origin main
```

### 5. Create Git Tag

**IMPORTANT**: The tag must be created on the commit AFTER the changelog update!

```bash
# Create tag on current HEAD (which includes changelog)
git tag vX.X.X

# Push tag to remote
git push origin vX.X.X
```

### 6. Create GitHub Release

**IMPORTANT**: Always use `--latest` to explicitly mark the new release as latest!

```bash
gh release create vX.X.X \
  --title "vX.X.X" \
  --latest \
  --notes "$(cat <<'EOF'
<changelog content for this version>
EOF
)"
```

This ensures the new release is marked as "Latest" even if older releases were recently modified.

### 7. Verify Release

```bash
# Verify tag exists on remote
git ls-remote --tags origin | grep vX.X.X

# Verify GitHub release
gh release view vX.X.X
```

### 8. Sync dev Branch

After a successful release, merge `main` back into `dev` to keep branches synchronized:

```bash
# Switch to dev and merge main
git checkout dev
git merge main --no-edit

# Push updated dev branch
git push origin dev

# Switch back to main
git checkout main
```

This ensures:
- CHANGELOG.md is available on both branches
- Release commits are included in dev history
- No merge conflicts when next feature branch is merged

## Dployr-Specific Considerations

### version.json in Docker Build

Dployr uses `version.json` for version detection in containers. The build process:
1. `deploy.sh` runs `git fetch --tags` to get all tags
2. `git describe --tags --exact-match` finds the tag on current commit
3. Tag is written to `/app/version.json` during Docker build

**Important**: After creating a release, existing installations will only show the correct version after running an update (which rebuilds the container with the new tag).

### Update Channel Behavior

- **Stable channel**: Checks GitHub releases API for latest release
- **Beta channel**: Checks for new commits on `dev` branch

The release process only affects the **stable channel**. Beta users see commit-based updates.

### Tag Placement

Tags must point to the **final commit** that should be in the release. This includes:
- All code changes
- The CHANGELOG.md update

Never create a tag before committing the changelog!

## Checklist

Before running this skill, ensure:
- [ ] All features/fixes for this release are merged to main
- [ ] Tests pass (`npm test` in dashboard/)
- [ ] No uncommitted changes
- [ ] You have push access to the repository
- [ ] `gh` CLI is authenticated

## Output

After successful release:
1. Display the GitHub release URL
2. Remind about server updates:
   - Existing installations need to run update to get new version
   - `deploy.sh` will fetch tags and rebuild with correct version.json
