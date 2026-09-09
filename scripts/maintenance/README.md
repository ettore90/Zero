# Maintenance scripts

One-off repairs, run by hand against a live container. Not part of any test or
build pipeline. All of them are idempotent — safe to re-run.

They use container paths (`/app/storage/zero.db`, `/app/node_modules`), so run
them inside the `zero` container rather than from the host:

```bash
docker exec zero node /uby/zero/scripts/maintenance/<script>.cjs
```

`/uby` is the bind mount of `~/Software/Uby`, so the working tree is visible to
the container without a rebuild.

## backfill-memory-embeddings.cjs

Generates embeddings for memories that have none, skipping the `event` and
`state` categories (operational log, not recallable knowledge). Takes
`--dry-run`.

Written when 1098 of 1174 memories had no vector and were therefore invisible
to semantic recall — only a literal keyword match reached them. The cause was
that every writer except the agent tool path went through `POST /memory/add`,
which accepted an embedding but never produced one. That route now generates
its own, so this script is only needed for a backlog.

## backfill-memory-embeddings-long.cjs

Second pass for rows `nomic-embed-text` rejects with
`the input length exceeds the context length`. Its ~2048-token context
translates to a different character count per text — prose packs far more per
token than code or JSON — so this steps the length down (6000, 3000, 1500, 800)
until the model accepts the input. Measured: an 11956-char note embedded at
6000 while a 7167-char one needed 3000.
