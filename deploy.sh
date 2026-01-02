#!/bin/bash
# Dployr Deploy Script
# Updates the repository and rebuilds the dashboard with version information
#
# Usage:
#   ./deploy.sh              # Full update (pull, build, restart) from main
#   ./deploy.sh --branch dev # Update from specific branch
#   ./deploy.sh --check      # Check for updates only (returns JSON)
#   ./deploy.sh --version    # Show current version (returns JSON)

set -e

cd "$(dirname "$0")"

# Parse arguments
ACTION="deploy"
JSON_OUTPUT=false
BRANCH="main"

while [[ $# -gt 0 ]]; do
    case $1 in
        --check)
            ACTION="check"
            JSON_OUTPUT=true
            shift
            ;;
        --version)
            ACTION="version"
            JSON_OUTPUT=true
            shift
            ;;
        --json)
            JSON_OUTPUT=true
            shift
            ;;
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        --help|-h)
            echo "Dployr Deploy Script"
            echo ""
            echo "Usage:"
            echo "  ./deploy.sh                  Full update from main branch"
            echo "  ./deploy.sh --branch dev     Update from specific branch"
            echo "  ./deploy.sh --check          Check for updates (JSON output)"
            echo "  ./deploy.sh --version        Show current version (JSON output)"
            echo "  ./deploy.sh --json           Enable JSON output for deploy"
            echo "  ./deploy.sh --help           Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Get current version info
get_version() {
    local hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
    local date=$(git log -1 --format=%cd --date=format:'%Y-%m-%d' 2>/dev/null || echo "unknown")
    local tag=$(git describe --tags --exact-match 2>/dev/null || echo "")
    local branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"hash\":\"$hash\",\"date\":\"$date\",\"tag\":\"$tag\",\"branch\":\"$branch\"}"
    else
        if [ -n "$tag" ]; then
            echo "$tag ($hash, $date)"
        else
            echo "$hash ($date) on $branch"
        fi
    fi
}

# Check for available updates
check_updates() {
    # Fetch latest from remote
    git fetch origin main --quiet 2>/dev/null || true

    local current_hash=$(git rev-parse HEAD 2>/dev/null)
    local remote_hash=$(git rev-parse origin/main 2>/dev/null || echo "")
    local commits_behind=0

    if [ -n "$remote_hash" ] && [ "$current_hash" != "$remote_hash" ]; then
        commits_behind=$(git rev-list HEAD..origin/main --count 2>/dev/null || echo "0")
    fi

    local update_available=false
    if [ "$commits_behind" -gt 0 ]; then
        update_available=true
    fi

    if [ "$JSON_OUTPUT" = true ]; then
        local current_tag=$(git describe --tags --exact-match 2>/dev/null || echo "")
        local latest_tag=$(git describe --tags origin/main --abbrev=0 2>/dev/null || echo "")
        echo "{\"updateAvailable\":$update_available,\"commitsBehind\":$commits_behind,\"currentHash\":\"$(git rev-parse --short HEAD)\",\"currentTag\":\"$current_tag\",\"latestTag\":\"$latest_tag\"}"
    else
        if [ "$update_available" = true ]; then
            echo "Update available: $commits_behind commits behind"
        else
            echo "Already up to date"
        fi
    fi
}

# Perform the update
do_deploy() {
    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"status\":\"starting\",\"step\":\"pull\",\"branch\":\"$BRANCH\"}"
    else
        echo "=== Dployr Deploy ==="
        echo "Updating from branch: $BRANCH"
    fi

    # Git Pull from specified branch
    git pull origin "$BRANCH"

    # Get version information for build args
    export GIT_HASH=$(git rev-parse --short HEAD)
    export GIT_DATE=$(git log -1 --format=%cd --date=format:'%d.%m.%Y')

    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"status\":\"building\",\"step\":\"build\",\"version\":\"$GIT_HASH\"}"
    else
        echo "Version: $GIT_HASH ($GIT_DATE)"
        echo "Building dashboard..."
    fi

    # Build dashboard with version info (env vars are read by docker-compose.yml)
    docker compose build --no-cache dashboard

    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"status\":\"restarting\",\"step\":\"restart\"}"
    else
        echo "Restarting dashboard..."
    fi

    # Restart dashboard
    docker compose up -d dashboard

    if [ "$JSON_OUTPUT" = true ]; then
        echo "{\"status\":\"complete\",\"success\":true,\"version\":\"$GIT_HASH\",\"date\":\"$GIT_DATE\"}"
    else
        echo "=== Done ==="
    fi
}

# Execute requested action
case $ACTION in
    version)
        get_version
        ;;
    check)
        check_updates
        ;;
    deploy)
        do_deploy
        ;;
esac
