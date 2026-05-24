// ============================================================
// GENERATE QR STICKERS - Run once: node generate_qr.js
// ============================================================
const QRCode = require('qrcode');
const path = require('path');

const BASE_URL = 'https://myself-grows-lawyers-sky.trycloudflare.com';

const stickers = [
  {
    filename: 'sticker_eau.png',
    url: `${BASE_URL}/scan/eau`,
    label: 'Compteur Eau'
  },
  {
    filename: 'sticker_electricite.png',
    url: `${BASE_URL}/scan/electricite`,
    label: 'Compteur Electricite'
  },
];

async function generate() {
  for (const sticker of stickers) {
    const filepath = path.join(__dirname, sticker.filename);
    await QRCode.toFile(filepath, sticker.url, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    console.log(`✅ Generated: ${sticker.filename} → ${sticker.url}`);
  }
  console.log('\n✅ All QR stickers generated in backend/ folder!');
  console.log('Print them and stick on the meters.');
}

generate();