---
description: Run comprehensive codebase consistency checks (language, code quality, security, documentation)
allowed-tools: Grep, Glob, Read, Bash
---

# Dployr Codebase Consistency Check

Run all consistency checks on the Dployr codebase and report findings.

## 1. Language / Code Style Checks

### German comments in code files (.js, .ejs, .sh, .yml)
Search for German text patterns in comments:
- `// [German words with umlauts]`
- `/* [German text] */`
- `<%# [German text] %>`
- `<!-- [German text] -->`
- `# [German text]` in .sh and .yml files

Common German words to search:
- Umlauts: ä, ö, ü, Ä, Ö, Ü, ß
- Common words: "und", "oder", "wenn", "dann", "nicht", "wird", "werden", "ist", "sind", "kann", "muss", "Funktion", "Prüfen", "erstellt", "geladen", "gestartet", "Fehler"

### German log messages
Search for `logger.(info|warn|error|debug)` with German text.

### German echo messages in shell scripts
Search for `echo` with German text in .sh files.

### German comments in .env.example
Check comments are in English.

## 2. Code Quality Checks

### console.log usage (should use logger instead)
Search for `console.log` in dashboard/src/**/*.js files.

### TODO/FIXME comments
Search for `TODO`, `FIXME`, `HACK`, `XXX` comments.

### Commented-out code blocks
Look for patterns like `// const`, `// function`, `// if (`, etc.

### Missing error handling
Check for `await` without try/catch in route handlers.

## 3. Security Checks

### Hardcoded secrets/passwords
Search for patterns like:
- `password = "` or `password: "`
- `secret = "` or `secret: "`
- `token = "` or `token: "`
(Exclude .env.example and test files)

### eval() usage
Search for `eval(` in .js files.

### SQL string concatenation
Search for patterns that might indicate SQL injection risk.

## 4. Documentation Checks

### CLAUDE.md accuracy
Check if key files mentioned in CLAUDE.md still exist:
- All files in the "Key Files" table
- All services mentioned
- All middleware mentioned

### Unused exports
Check if exported functions in services are actually used.

## 5. Git Status

### Uncommitted changes
Run `git status --porcelain` to check for uncommitted work.

### Large untracked files
Check for large files that shouldn't be committed.

## Output Format

For each category, report:
- ✅ Pass - No issues found
- ⚠️ Warning - N issues found (list them)
- ❌ Error - Critical issues that need immediate attention

Provide file:line references for each finding.
