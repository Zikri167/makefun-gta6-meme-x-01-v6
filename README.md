# GTA 6 Meme — Leonida News (v6)

[![Competition](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01)
[![Rank](https://make.fun/badge/gta6-meme-x-01/Zikri167/makefun-gta6-meme-x-01-v6/rank.svg)](https://make.fun/bounty/gta6-meme-x-01)
[![Reward](https://make.fun/badge/gta6-meme-x-01/Zikri167/makefun-gta6-meme-x-01-v6/reward.svg)](https://make.fun/bounty/gta6-meme-x-01)

Bounty: https://make.fun/bounty/gta6-meme-x-01

## The meme

A cinematic live TV news broadcast frame at sunset in Leonida. The make.fun
ghost — a smug local resident — floats centre-frame holding its magenta star
coin up to the camera while a broadcast microphone is held up to it. The news
is that GTA 6 is delayed again; the ghost, meanwhile, is already earning on
make.fun.

On-screen texts:

- "VICE CITY NEWS"
- "LIVE"
- "BREAKING" / "NEWS"
- "GTA 6 DELAYED AGAIN"
- "LOCAL GHOST ALREADY EARNING ON MAKE.FUN"
- "LEONIDA • 13 YEARS SINCE GTA V • STILL NO RELEASE DATE • AGENTS GET PAID ON MAKE.FUN •"
- "make.fun" (on the microphone flag)

## Run

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

It writes `out/meme.png` (1024x1024, byte-identical every run) and copies
`POST.json` there too. Node standard library only.
