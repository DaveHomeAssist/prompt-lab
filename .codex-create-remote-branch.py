#!/usr/bin/env python3
import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

OWNER = "DaveHomeAssist"
REPO = "prompt-lab"
BRANCH = "feature/promptlab-ui-notebook-handoff-20260320"
BASE_BRANCH = "main"
REPO_ROOT = Path("/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab")
FILES = [
    "prompt-lab-source/prompt-lab-extension/src/App.jsx",
    "prompt-lab-source/prompt-lab-extension/src/ResultPane.jsx",
    "prompt-lab-source/prompt-lab-extension/src/HeaderNav.jsx",
    "prompt-lab-source/prompt-lab-extension/src/SavePanel.jsx",
    "prompt-lab-source/prompt-lab-extension/src/ModalLayer.jsx",
    "prompt-lab-source/prompt-lab-extension/src/ComposerTab.jsx",
    "prompt-lab-source/prompt-lab-extension/src/RunTimelinePanel.jsx",
    "prompt-lab-source/prompt-lab-extension/src/ABTestTab.jsx",
    "prompt-lab-source/prompt-lab-extension/src/EditorActions.jsx",
    "prompt-lab-source/prompt-lab-extension/src/PadTab.jsx",
    "prompt-lab-source/prompt-lab-extension/src/icons.jsx",
    "prompt-lab-source/prompt-lab-extension/src/index.css",
    "prompt-lab-source/prompt-lab-extension/src/lib/navigationRegistry.js",
    "prompt-lab-source/prompt-lab-extension/src/lib/promptLabBridge.js",
    "prompt-lab-source/prompt-lab-extension/src/hooks/useABTest.js",
]
MESSAGE = "feat(prompt-lab): improve editor UX, runs UI, and notebook handoff"


def gh_token() -> str:
    proc = subprocess.run(
        ["gh", "auth", "token"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        if proc.stderr:
            print(proc.stderr, file=sys.stderr)
        raise SystemExit(proc.returncode)
    return proc.stdout.strip()


TOKEN = gh_token()
BASE_URL = f"https://api.github.com/repos/{OWNER}/{REPO}"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "codex-git-data-uploader",
}


def request(method: str, path: str, data=None, allow_404: bool = False):
    url = BASE_URL + path
    body = None
    headers = dict(HEADERS)
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload) if payload else {}
    except urllib.error.HTTPError as exc:
        if allow_404 and exc.code == 404:
            return None
        detail = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"{method} {path} failed: {exc.code} {detail}")


def main() -> None:
    existing = request("GET", f"/git/ref/heads/{BRANCH}", allow_404=True)
    if existing is not None:
        print(
            json.dumps(
                {
                    "status": "already_exists",
                    "branch": BRANCH,
                    "sha": existing["object"]["sha"],
                },
                indent=2,
            )
        )
        return

    base_ref = request("GET", f"/git/ref/heads/{BASE_BRANCH}")
    base_commit_sha = base_ref["object"]["sha"]
    base_commit = request("GET", f"/git/commits/{base_commit_sha}")
    base_tree_sha = base_commit["tree"]["sha"]

    entries = []
    for rel_path in FILES:
        content = (REPO_ROOT / rel_path).read_text(encoding="utf-8")
        blob = request("POST", "/git/blobs", {"content": content, "encoding": "utf-8"})
        entries.append(
            {
                "path": rel_path,
                "mode": "100644",
                "type": "blob",
                "sha": blob["sha"],
            }
        )

    tree = request("POST", "/git/trees", {"base_tree": base_tree_sha, "tree": entries})
    commit = request(
        "POST",
        "/git/commits",
        {"message": MESSAGE, "tree": tree["sha"], "parents": [base_commit_sha]},
    )
    ref = request(
        "POST",
        "/git/refs",
        {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]},
    )

    print(
        json.dumps(
            {
                "status": "created",
                "branch": BRANCH,
                "base": base_commit_sha,
                "commit": commit["sha"],
                "ref": ref["ref"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
