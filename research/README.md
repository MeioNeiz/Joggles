# Joggles research index

Entry point for the reverse-engineering findings. Each document below is
self-contained: read only the one that matches your task.

| Document | Covers | Read it when |
| --- | --- | --- |
| `firmware-image-format.md` | OTA container format, firmware internals, SoC identity, flash map, flashing risk and recovery | Touching firmware, OTA, or anything that writes flash |
| `vendor-app-protocol.md` | Saved content (`DATS`/`DATCP`), wide buffers, complete opcode inventory, hard limits | Improving rendering or driving the display |
| `ota-codec.ts` | Runnable decode/encode/verify for OTA images | Inspecting or rebuilding a firmware image |

`notes/protocol.md` remains the day-to-day protocol reference (key, frame format,
geometry, command table). These documents extend and in places correct it.

## Conventions used throughout

Writing style for these documents is set by `notes/WRITING.md`. The confidence
markers below are the canonical set; do not introduce others.

- **Offsets** are stated as `body 0xNNNN` (an offset into the *deobfuscated* OTA
  payload, i.e. after the 16-byte container header) or `abs 0xNNNN` (an address in
  the device's flash). The relationship is fixed: `abs = body + 0x16800`.
  Published third-party analyses use `0x10000` as the base and are wrong by
  `0x6800`, so absolute addresses quoted elsewhere will not match.
- **Confidence** is labelled explicitly: *verified* means checked against bytes or
  running hardware, *derived* means inferred from firmware literals or app code,
  *unverified* means plausible but untested.
- Every factual claim about the OTA container is reproducible with
  `bun research/ota-codec.ts verify firmware/*.bin`.

## Current state in one paragraph

The display protocol is solved and verified on hardware. The OTA container format
is also solved: the payload is XOR-obfuscated with a fixed 128-byte pad, not
encrypted with a key we lack, and the header CRC-32 covers the deobfuscated body,
so valid modified images can be built. Flashing is nonetheless **not** safe yet,
because the ~90 KB bootloader region below `abs 0x16800` has never been dumped and
no recovery path has been confirmed on this unit. Better rendering does not require
firmware changes: the device already stores and scrolls buffers far wider than the
panel.
