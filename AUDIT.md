---
audited: never
result: runbook only
---

# AUDIT: the alignment runbook

The committed procedure that checks this repository still obeys the rules `CLAUDE.md` claims. It is the
**alignment** half of an audit: mechanical checks with a command and a pass bar, all run from the
repository root.

The **quality** half is
[`AUDIT-STANDARD.md`](https://portfolio.tjakoen.com/standards/audit-standard). A pass that runs only
this file is the most common way an audit lies. Nothing here restates `CLAUDE.md`, `ARCHITECTURE` or
`CONVENTIONS`; when a check and a canon disagree, the canon wins and the check gets fixed.

The gate commands below are the ones the container runs. `CLAUDE.md` explains why the container is the
canonical path on Windows; the scripts are the same either way.

Run every check, then either fix what it finds or flag it as deferred with a reason. Set `audited:` to
the date of the pass and leave the report beside the work.

## 1. The green gate

```sh
bun run check
bun test
bun run lint 2>&1 | grep -E "^[^ ]+:[0-9]+:[0-9]+: error"
```

Pass: typecheck exits 0, the suite reports `0 fail`, and the lint grep prints nothing. Warnings are
listed, not policed.

## 2. BATCH imports nothing upward

```sh
git grep -nE "^(import|export).*(@tjakoen/(grain|mill|proof|crumb)|\.\./(grain|project))" -- '*.ts' '*.js'
```

Pass: no output. A need from above is a port plus injection at the composition root.

## 3. The runtime dependency block stays empty

```sh
grep -c '"dependencies"' package.json
```

Pass: `0`. Dev dependencies for tests and measurement are allowed; a third-party runtime dependency is
not.

## 4. No vocabulary leaks in from GRAIN

```sh
git grep -n "RenderOp" -- '*.ts' '*.js'
```

Pass: no output. Inside BATCH the stream carries opaque payloads; the door, verbs and surfaces belong
above this layer.

## 5. Client modules are refused unless they are client-safe

```sh
bun test http/modules.test.ts
```

Pass: `0 fail`. The guard is the mechanism that keeps `node:`, Bun and npm imports out of anything
served to a browser.

## 6. BATCH ships no stylesheet of its own

```sh
git ls-files '*.css' | wc -l
```

Pass: `0`. Themes and tokens live in GRAIN; BATCH ships the mechanism.

## 7. No app and no end-to-end suite live here

```sh
ls -d app e2e tests playwright.config.ts 2>/dev/null
```

Pass: no output. The proving app and its browser tests belong to the composition root.

## 8. Every export subpath is a real directory

```sh
grep -oE '"\./[a-z]+/\*"' package.json | sed 's/"\.\///; s/\/\*"//' | sort -u \
  | while read -r d; do [ -d "$d" ] || echo "missing: $d"; done
```

Pass: no `missing:` line.

## 9. Erasable TypeScript only

```sh
git grep -nE "^[[:space:]]*(export )?(enum|namespace) " -- '*.ts'
```

Pass: no output. Closed sets are a union plus a const registry.

## 10. No `.npmrc` is committed

```sh
find . -name .npmrc -not -path "./node_modules/*"
```

Pass: no output.

## 11. No secret material is tracked

```sh
git grep -nE "ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----" -- . ':!bun.lock'
```

Pass: no output. A hit is a blocker, not a finding.

## 12. `AGENTS.md` is the shared link, not a second copy

```sh
[ -L AGENTS.md ] && [ "$(readlink AGENTS.md)" = "CLAUDE.md" ] && echo ok
```

Pass: `ok`.

## 13. Every plan carries the PROOF frontmatter

```sh
for f in plans/*.md; do
  [ "$f" = "plans/README.md" ] && continue
  for k in id status track depends touches owner; do
    grep -q "^$k:" "$f" || echo "$f missing $k"
  done
done
```

Pass: no `missing` line.

## 14. The README carries the badge the standard requires

```sh
grep -q "Made with Claude" README.md && echo badged
```

Pass: `badged`.

## 15. The history carries no AI attribution

```sh
git log -E --grep="^Co-Authored-By:" --oneline | wc -l
```

Pass: `0`.

## Findings template

```
✅ 1. gate                typecheck 0, tests 0 fail, lint 0 errors
⚠️ 4. vocabulary          app/x.ts:12, finding, fix or flag
🚫 5. client guard        deferred, accepted: reason and who accepted it
```

Done means every line is ✅, or every ⚠️ is fixed, or every 🚫 names why it is deferred and who
accepted it. Then replace `audited: never` with the date.
