# Working agreement

## Branching

- `main` is the integration branch. It must always build.
- Work happens on short-lived branches cut from `main`:
  - `feat/<short-name>` — new functionality
  - `fix/<short-name>` — bug fix
  - `chore/<short-name>` — tooling, docs, config
- Rebase on `main` before opening a pull request. Delete the branch after merge.

## Commits

Conventional Commits:

```
<type>(<scope>): <subject>
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.

Examples:

```
feat(auth): add email login
fix(api): handle empty payload on /submit
```

Subject in the imperative, under 72 characters, no trailing period.

## Pull requests

- One PR per logical change; keep it small enough to review in 15 minutes.
- Fill in what changed, why, and how it was tested.
- One approval required before merge. Squash on merge.
- Never push directly to `main` once the team is more than one person.

## Code ownership

| Area | Owner |
| --- | --- |
| _fill in_ | _fill in_ |

## Definition of done

- [ ] Code builds locally
- [ ] Tests pass
- [ ] Docs or README updated if behaviour changed
- [ ] Reviewed and approved
