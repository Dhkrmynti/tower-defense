# Pons v2 Autonomous Flywheel Bot (Auto-Claim, Buyback & Burn)

Bot otomatis untuk token yang diluncurkan di [Pons Family v2](https://docs.ponsfamily.com/v2) pada **Robinhood Chain (Chain ID: 4663)**.

## Alur Kerja (Siklus Roda)
1. **Fee Inflow**: Pembeli melakukan swap di curve -> creator fee terakumulasi di **Fee Escrow** (`0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e`).
2. **Auto-Claim Fee**: Bot mendeteksi saldo di Escrow. Jika telah melewati threshold (misal 0.01 ETH), bot memanggil `claim()`.
3. **Auto-Buyback**: ETH hasil klaim langsung dibelikan ke token melalui `curve.buy()`.
4. **Auto-Burn**: Token yang dibeli langsung ditransfer ke `0x000000000000000000000000000000000000dEaD` (Dead Address).
5. **Berulang**: Proses terus berulang tanpa henti secara terdesentralisasi.

## Cara Menjalankan

### 1. Masuk ke folder bot dan install dependensi:
```bash
cd bot
npm install
```

### 2. Salin dan edit file konfigurasi `.env`:
```bash
copy .env.example .env
```
Isi:
- `RPC_URL`: RPC Robinhood Chain (atau default `https://rpc.robinhood.org`)
- `CREATOR_PRIVATE_KEY`: Kunci privat wallet pembuat token
- `TOKEN_ADDRESS`: Contract Address (CA) token Anda
- `CURVE_ADDRESS`: Alamat Curve pasangan token Anda

### 3. Jalankan Bot:
```bash
npm start
```

Atau menggunakan PM2 agar berjalan nonstop di background server:
```bash
pm2 start "npm start" --name "pons-flywheel"
```
