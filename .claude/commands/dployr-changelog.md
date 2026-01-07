---
description: Generate changelog from Git commits for releases (project)
allowed-tools: Bash, Read, Write
---

# Dployr Changelog Generator

Generate a changelog from Git commits since the last release/tag.

## 1. Analyze Git History

### Find Last Release
```bash
git describe --tags --abbrev=0 2>/dev/null || echo "No tags found"
```

### Get Commits Since Last Release
```bash
git log <last-tag>..HEAD --oneline --no-merges
```

Or if no tags exist, get recent commits:
```bash
git log --oneline --no-merges -50
```

## 2. Categorize Commits

Group commits by their prefix:

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

## 3. Generate Changelog Entry

Format following [Keep a Changelog](https://keepachangelog.com/):

```markdown
## [X.X.X] - YYYY-MM-DD

### Added
- New feature description

### Fixed
- Bug fix description

### Changed
- Change description

### Security
- Security improvement description
```

## 4. Update CHANGELOG.md

If CHANGELOG.md exists:
- Insert new version at the top (after header)
- Keep existing entries

If CHANGELOG.md does not exist:
- Create new file with header and first entry

## Output Format

1. Show categorized commits
2. Show generated changelog entry
3. Ask user for version number
4. Update/create CHANGELOG.md

## Version Numbering (Semantic Versioning)

Suggest version based on changes:
- **Major (X.0.0)**: Breaking changes
- **Minor (0.X.0)**: New features (Feat:)
- **Patch (0.0.X)**: Bug fixes only (Fix:)
