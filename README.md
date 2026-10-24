# BASTION — tower defense game di atas engine buyback & burn

Satu halaman = satu game. Seluruh layar adalah arena top-down; HUD melayang di atasnya; engine on-chain
(bot `pons-burn-bot.ts` + hook `useBurnEngine`, sama persis dengan `../graveburn`) adalah "dunia"-nya.
Inspirasi: Bloons TD × Kingdom Rush.

Tagline: **Every round strengthens the last defense.**

## Cara main

- **Title screen** → *Enter the fortress* (atau Space).
- Klik **mount** (lingkaran putus-putus) untuk membangun turret dengan **scrap**. Klik mount yang sudah terisi
  untuk **upgrade** (maks level 3) atau **sell**. Tombol 1–5 memilih jenis turret; klik mount kosong langsung
  membangun jenis yang dipilih.
- Klik musuh di jalur untuk **strike** manual (3 dmg).
- Tiap **wave** musuh merah (grunt, runner, brute) berjalan dari breach ke gerbang. Yang lolos mengurangi **HP gerbang**
  (20). Wave ke-5, 10, 15… adalah **boss**. HP 0 = *The gate has fallen* → Rebuild.
- Kill dan wave yang ditahan memberi scrap. Jeda 14 detik antar wave, atau *Send wave* / Space.
- **P** pause, **F** kecepatan 2x. Tiap 10 wave benteng pindah ke map baru (Breach Road → Twin Gorge dua jalur →
  Spiral Keep); semua turret di-refund penuh.
- Musuh spesial: **healer** (menyembuhkan sekitarnya, turret memprioritaskannya), **armored** (peluru Sentry/Gatling
  hanya 35 %), **swarm** (5 unit kecil sekaligus).
- **Senjata terbuka hybrid**: milestone burn on-chain (global, permanen) **atau** wave sesi ini (Gatling wave 3,
  Tesla 6, Rail 9, Lance 13). Game utuh bisa dimainkan tanpa chain.
- **Perk holder (read-only)**: connect wallet di title screen; game membaca saldo $BASTION dan rank leaderboard.
  Hold apa pun = +50 scrap; hold >= 0.1 % supply = +150 scrap + satu Sentry gratis; top 10 board = gelar di HUD.
  Tidak ada transaksi, tidak menyentuh fee. Angka tier di `HOLDER_TIERS` (`src/game/world.ts`).
- **Bonus purge**: tiap bot benar-benar burn di chain, semua pemain aktif dapat scrap (60 + 8 x wave) dan jalur disapu.
- Best wave disimpan di `localStorage`.

## Mode, ability, riset, isometrik

- **Campaign**: 6 misi (`src/game/campaign.ts`) di 5 map (Breach Road, Twin Gorge, Ridge Pass, Spiral Keep, Dead Harbor,
  lalu The Last Defense). Tiap misi punya jumlah wave, boss tiap N wave, dan kapan musuh spesial muncul. Bintang 1-3
  dari HP gerbang yang tersisa. Progres di `localStorage` (`bastion_campaign`). Map yang misinya sudah dibersihkan
  terbuka untuk Survival.
- **Survival**: endless, pilih map awal, pindah map tiap 10 wave.
- **Ability aktif** (Q/W/E/R, bar kiri): Airstrike (3 bom, target klik), Barricade (tembok di jalur, menahan musuh
  sampai hancur), Tactical drone (15 detik), Overcharge (semua turret 2x cepat 6 detik). Cooldown lebih cepat saat
  war chest lebih penuh. Airstrike tersedia dari awal, sisanya lewat riset.
- **Tech tree** (T, bar kiri): 12 riset dalam 3 tier, dibeli dengan scrap, tersimpan permanen di device
  (`bastion_research`). Membuka senjata (jalur ketiga selain burn milestone dan wave), ability, AP rounds, gerbang +5 HP,
  salvage 85 %, cooldown -20 %, dan **Experimental stage** (level 4 turret; tiap tembakan ke-5 charged shot 3x damage).
- **3D (default)**: `src/game/render3d.ts`, Three.js WebGL dengan gaya low-poly seperti reddome.fun: terrain
  plane + noise (rata di bawah jalur, mount, dan benteng), jalur pita tanah, benteng dari balok/silinder yang tumbuh
  per tahap, turret dari primitif dengan laras berputar dan recoil, musuh bola/kerucut/dodecahedron/icosahedron berduri,
  partikel additive, petir sebagai garis, bloom tipis, fog, matahari + bayangan, obor PointLight berkedip. Kamera orbit
  (drag putar, scroll zoom); klik di-raycast ke bidang tanah jadi koordinat dunia yang sama. Three.js dimuat on-demand
  hanya saat mode 3D aktif. Latar: angkasa dengan 2200 bintang berkelip, tiga nebula, planet bercincin, bulan, dan
  meteor/komet yang melintas tiap beberapa detik; medan tempur jadi pulau melayang di atas kehampaan. Di title screen
  kamera turun rendah dan berputar pelan supaya langitnya terlihat.
- **Isometrik / Top-down**: fallback 2D canvas; tombol 3D/Iso/Top di HUD (tersimpan di `bastion_view`). Simulasi tetap
  top-down 960x540, hanya proyeksinya yang berubah (`src/game/iso.ts`).

## Benteng

Lima tahap dengan siluet berbeda (`buildFortress` di `src/game/render3d.ts`, versi 2D di `makeFortress` `src/game/sprites.ts`):
palisade kayu dengan keep papan; stone keep bertembok battlement, gatehouse dua menara dengan portcullis, dua menara
sudut beratap merah; iron bastion berpelat baja, empat menara, meriam di tiap sudut; citadel dengan keep bertingkat,
menara pusat beratap kuningan, spanduk dan lampu; last defense dengan suar dan kubah energi. Bendera melambai, jendela
menyala, obor berkedip. Saat HP gerbang di bawah 60 % tembok retak; di bawah 35 % gatehouse terbakar dan berasap.
Kubah shield transparan mengikuti isi war chest. Preview tiap tahap di localhost: `/?purged=1`, `3`, `8`, `21`.

## Grafik & suara

- Semua sprite pixel-art digambar dari grid karakter di `src/game/sprites.ts` (musuh, turret per level, benteng 5 tahap,
  dekorasi). Tidak ada file gambar.
- Animasi: squash-stretch + kaki bergantian untuk musuh, recoil laras turret, benteng bergetar saat kena.
- Efek: muzzle flash, trail rail cannon, lance melengkung dari atas lalu ledakan, petir Tesla berantai, shockwave purge,
  glow (`shadowBlur`) pada shield, peluru, obor.
- Map: tanah, cobblestone di jalur, batu/semak/tengkorak/kawah tersebar (seeded), bendera di breach, obor berkedip.
- Suara di `src/game/sfx.ts`: semua SFX dan loop musik (A minor, 104 bpm) disintesis WebAudio. Tombol musik dan
  suara ada di HUD.

## Dunia dari engine (on-chain)

| Engine (bot / on-chain)                     | Di game                                                                 |
|---------------------------------------------|-------------------------------------------------------------------------|
| Creator fee di Pons Fee Escrow (war chest)  | **Shield** gerbang: ring cyan di benteng + meter HUD. Musuh yang lolos diblok dengan peluang = isi chest |
| Siklus bot (claim → buyback → burn)         | **Round** dunia (HUD kiri atas). Fase `burn` = **PURGE**: gelombang kejut dari benteng menyapu jalur |
| Fase `keep` (split ke treasury)             | Banner **Garrison pay**                                                 |
| % supply di 0x…dEaD                         | **Unlock turret**: Gatling 0.5 %, Tesla 2 %, Rail 5 %, Lance 13 %; benteng berevolusi 5 tahap; boss dunia di modal Milestones (1/3/8/21 %) |
| Transfer log token ↔ bonding curve          | **Leaderboard** (modal Board): volume & trade per wallet, *Find my rank* via wallet |
| `/api/status`, ledger on-chain              | Modal Rounds (tiap round = wave repelled / garrison paid), Battle log, Engine |

Tanpa CA (mode "CA soon") game tetap bisa dimainkan dengan Sentry saja; leaderboard dan rounds tertutup.

## Struktur

```
bot/                        bot engine (salinan graveburn/engine/bot), API /api/status di :5015
src/game/world.ts           map, jalur, mount, definisi turret & musuh, ekonomi
src/game/sim.ts             simulasi game (tanpa React): wave, scrap, HP, turret, boss, event
src/game/render.ts          gambar canvas 2D
src/game/Game.tsx           layar game: canvas + HUD + popover mount + title/game over + modal
src/hooks/useBurnEngine.ts  hook engine (sama dengan graveburn)
src/hooks/useDefenders.ts   leaderboard dari chain
src/utils/web3.ts           pembaca on-chain (sama)
src/utils/leaderboard.ts    Transfer log ↔ curve → ranking
src/components/MemexAdmin.tsx        panel operator /memex (teks disesuaikan)
src/components/BurnLedgerDrawer.tsx  Battle log
src/components/engine/split.ts       split & pending fee dari /api/status
src/components/bastion/     konten modal (Rounds, Milestones, Leaderboard, CommandCenter) + lore.ts
```

## Menjalankan

```bash
npm install
cp .env.example .env            # VITE_* fallback build-time, WEB_PORT=3096
cat .env.engine.example >> .env # TOKEN_ADDRESS, CREATOR_PRIVATE_KEY, ADMIN_SECRET, dst. untuk bot
npm run dev                     # http://127.0.0.1:3096, /api di-proxy ke bot :5015
npm run bot                     # bot engine (CREATOR_PRIVATE_KEY = wallet creator token di Pons)
```

Produksi: `npm run build` lalu jalankan bot dengan `SITE_DIR="./dist"`; bot menyajikan game dan `/api/status`
dari satu port (5015), sama seperti graveburn.

## Uji di mainnet (fork)

`test/fork-mainnet.ts` (salinan dari graveburn, `npm run test:fork`) menjalankan bot ini di fork Robinhood Chain:
alur fee asli (trade -> sweepFees -> escrow -> claim), siklus split (sweep, claim, wages ke treasury, buyback bertahap,
burn ke 0x...dEaD), dan jalur Uniswap v4. Butuh `hardhat node` yang mem-fork mainnet di :8599 (config contoh:
`D:\BLOKCHAIN\hh-e2e\hardhat.fork.config.cjs`). Semua aktor di tes memakai wallet acak: akun default hardhat punya
kode delegasi EIP-7702 di chain ini sehingga kontrak gagal mengirim ETH ke mereka.

Catatan jaringan: beberapa ISP Indonesia memblokir DNS `rpc.mainnet.chain.robinhood.com` (dialihkan ke halaman blokir).
Ganti DNS ke 1.1.1.1 / 8.8.8.8, atau pakai `MAINNET_RPC` / `RPC_URL` yang mengarah ke proxy lokal.

Blok chain ini ~0,1 detik. Pembaca on-chain (`src/utils/logscan.ts`) memindai log per 3 juta blok sampai 60 juta blok
(~70 hari) dengan cache inkremental; jendela 600 ribu blok di engine lama hanya 17 jam.

## Yang belum diisi

- CA, domain (`bastion.xyz`) dan akun X (`@bastionrh`) masih placeholder di `src/components/bastion/lore.ts`
  dan `index.html`.
- `public/og-image.png` belum dibuat.
- Balancing angka (HP musuh, harga turret, scrap) ada di `src/game/world.ts`.
