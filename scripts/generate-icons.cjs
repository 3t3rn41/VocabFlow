/**
 * 生成 VocabFlow 应用图标
 * 纯色背景 + 白色 "V" 字母，无渐变
 *
 * 生成文件：
 *   src-tauri/icons/icon-source.png   (1024x1024 源图)
 *   src-tauri/icons/32x32.png
 *   src-tauri/icons/128x128.png
 *   src-tauri/icons/128x128@2x.png     (256x256)
 *   src-tauri/icons/icon.ico           (Windows)
 *   src-tauri/icons/icon.icns          (macOS, 可选)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sharp = require('sharp');

const SIZE = 1024;
const OUT_DIR = path.resolve(__dirname, '..', 'src-tauri', 'icons');

/* ---- 品牌色（纯色，无渐变） ---- */
const BG_R = 79;   // #4F46E5 indigo-600
const BG_G = 70;
const BG_B = 229;
const FG_R = 255;  // 白色 V
const FG_G = 255;
const FG_B = 255;

/**
 * 生成纯色背景 + 白色 V 字母的 RGBA 像素数据
 */
function createPixels() {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const radius = SIZE * 0.46;          // 圆角矩形/圆形区域
  const cornerRadius = SIZE * 0.22;    // 圆角半径

  // V 字母的笔画参数
  const strokeHalf = SIZE * 0.045;     // 笔画半宽
  const vTopY = SIZE * 0.28;
  const vBottomY = SIZE * 0.72;
  const vHalfWidth = SIZE * 0.16;       // V 顶部半宽

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 4;
      const px = x - cx;
      const py = y - cy;

      // 圆角矩形裁剪：超出范围则透明
      const inRect = Math.abs(px) <= radius && Math.abs(py) <= radius;
      const dx = Math.max(0, Math.abs(px) - (radius - cornerRadius));
      const dy = Math.max(0, Math.abs(py) - (radius - cornerRadius));
      const inCorner = Math.sqrt(dx * dx + dy * dy) <= cornerRadius;
      if (!inRect || !inCorner) {
        pixels[idx + 3] = 0; // 透明
        continue;
      }

      // 判断是否在 V 字笔画内
      // V 由两条斜线组成：左斜线 (−vHalfWidth, vTopY) → (0, vBottomY)
      //                  右斜线 (vHalfWidth, vTopY) → (0, vBottomY)
      const localY = y - vTopY;
      const leftX = -vHalfWidth + (vHalfWidth / (vBottomY - vTopY)) * localY;
      const rightX = vHalfWidth - (vHalfWidth / (vBottomY - vTopY)) * localY;
      const inV = localY >= 0 && localY <= (vBottomY - vTopY) &&
        (Math.abs(x - (cx + leftX)) <= strokeHalf ||
         Math.abs(x - (cx + rightX)) <= strokeHalf);

      if (inV) {
        pixels[idx] = FG_R;
        pixels[idx + 1] = FG_G;
        pixels[idx + 2] = FG_B;
        pixels[idx + 3] = 255;
      } else {
        pixels[idx] = BG_R;
        pixels[idx + 1] = BG_G;
        pixels[idx + 2] = BG_B;
        pixels[idx + 3] = 255;
      }
    }
  }
  return pixels;
}

/* ---- PNG 编码 ---- */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeB, data, crcB]);
}

function createPNG(pixels, width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    pixels.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 用 sharp 从源 PNG 生成各尺寸 + ico
 */
async function generateAll(sourcePngBuffer) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sizes = [
    { name: '32x32.png', size: 32 },
    { name: '128x128.png', size: 128 },
    { name: '128x128@2x.png', size: 256 },
    { name: 'icon.png', size: 512 },
  ];

  for (const { name, size } of sizes) {
    const out = path.join(OUT_DIR, name);
    await sharp(sourcePngBuffer).resize(size, size).png().toFile(out);
    console.log(`[icons] 生成 ${name} (${size}x${size})`);
  }

  // 生成 Windows .ico（多尺寸嵌入）
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = await Promise.all(
    icoSizes.map((s) => sharp(sourcePngBuffer).resize(s, s).png().toBuffer()),
  );
  const icoPath = path.join(OUT_DIR, 'icon.ico');
  writeIco(icoPath, icoSizes, pngBuffers);
  console.log(`[icons] 生成 icon.ico`);

  // 生成 macOS .icns（简单 ICON247 格式）
  const icnsPath = path.join(OUT_DIR, 'icon.icns');
  const icnsPng = await sharp(sourcePngBuffer).resize(512, 512).png().toBuffer();
  writeIcns(icnsPath, icnsPng);
  console.log(`[icons] 生成 icon.icns`);
}

/** 写入 .ico 文件 */
function writeIco(filePath, sizes, pngBuffers) {
  const headerSize = 6;
  const dirSize = 16 * sizes.length;
  const offset = headerSize + dirSize;

  // 计算总大小
  let dataSize = 0;
  pngBuffers.forEach((buf) => (dataSize += buf.length));

  const file = Buffer.alloc(offset + dataSize);
  // ICONDIR header
  file.writeUInt16LE(0, 0);      // reserved
  file.writeUInt16LE(1, 2);      // type = icon
  file.writeUInt16LE(sizes.length, 4); // count

  let dataOffset = offset;
  for (let i = 0; i < sizes.length; i++) {
    const dirOffset = 6 + i * 16;
    file.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], dirOffset);     // width
    file.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], dirOffset + 1); // height
    file.writeUInt8(0, dirOffset + 2);    // palette
    file.writeUInt8(0, dirOffset + 3);    // reserved
    file.writeUInt16LE(1, dirOffset + 4); // planes
    file.writeUInt16LE(32, dirOffset + 6); // bpp
    file.writeUInt32LE(pngBuffers[i].length, dirOffset + 8); // size
    file.writeUInt32LE(dataOffset, dirOffset + 12);          // offset
    pngBuffers[i].copy(file, dataOffset);
    dataOffset += pngBuffers[i].length;
  }

  fs.writeFileSync(filePath, file);
}

/** 写入 .icns 文件（简单版，仅含 PNG） */
function writeIcns(filePath, pngBuffer) {
  const type = Buffer.from('ic07', 'ascii'); // 512x512 png
  const len = 8 + pngBuffer.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(len, 4);
  const icon = Buffer.concat([type, header, pngBuffer]);

  const magic = Buffer.from('icns', 'ascii');
  const totalLen = 8 + icon.length;
  const totalHeader = Buffer.alloc(8);
  totalHeader.writeUInt32BE(totalLen, 4);
  const file = Buffer.concat([magic, totalHeader, icon]);
  fs.writeFileSync(filePath, file);
}

/* ---- 主流程 ---- */
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('[icons] 生成 1024x1024 源图（纯色 + V 字母）...');
  const pixels = createPixels();
  const sourcePng = createPNG(pixels, SIZE, SIZE);
  const srcPath = path.join(OUT_DIR, 'icon-source.png');
  fs.writeFileSync(srcPath, sourcePng);
  console.log(`[icons] 源图已生成: ${srcPath} (${(sourcePng.length / 1024).toFixed(1)} KB)`);

  console.log('[icons] 生成各尺寸图标...');
  await generateAll(sourcePng);
  console.log('[icons] 全部完成');
})().catch((err) => {
  console.error('[icons] 生成失败:', err);
  process.exit(1);
});
