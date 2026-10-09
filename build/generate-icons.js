const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule.imagesToIco;

const iconsDir = path.resolve(__dirname, '../assets/icons');
// icon-source.png is the original full-res PNG — never generated/overwritten by this script.
// All derived sizes (including icon-512.png) are outputs, not the source.
const sourcePng = path.join(iconsDir, 'icon-source.png');
const sourceFallback = path.join(iconsDir, 'icon-512.png');

const appSizes = [16, 32, 48, 64, 128, 256, 512];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function fileExists(filePath) {
    return fs.existsSync(filePath);
}

// The source PNG has ~10% black padding on each side around the rounded-square icon.
// Strip it so the icon fills its allocated space in the taskbar, tray, and ICO — matching
// how other apps' icons look at the same sizes.
async function getCroppedBuffer(input) {
    const meta = await sharp(input).metadata();
    const padPct = 0.12;
    const left   = Math.floor(meta.width  * padPct);
    const top    = Math.floor(meta.height * padPct);
    const width  = meta.width  - left * 2;
    const height = meta.height - top  * 2;
    return sharp(input).extract({ left, top, width, height }).toBuffer();
}

async function generatePngSize(croppedBuf, size) {
    const target = path.join(iconsDir, `icon-${size}.png`);
    await sharp(croppedBuf)
        .resize(size, size, { fit: 'cover' })
        .png({ quality: 100, compressionLevel: 9 })
        .toFile(target);
    return target;
}

async function generateTrayIcons(croppedBuf) {
    const tray16 = path.join(iconsDir, 'tray-icon.png');
    const tray32 = path.join(iconsDir, 'tray-icon@2x.png');

    await sharp(croppedBuf)
        .resize(16, 16, { fit: 'cover' })
        .png({ quality: 100, compressionLevel: 9 })
        .toFile(tray16);

    await sharp(croppedBuf)
        .resize(32, 32, { fit: 'cover' })
        .png({ quality: 100, compressionLevel: 9 })
        .toFile(tray32);

    return [tray16, tray32];
}

async function generateIco(croppedBuf) {
    const icoPath = path.join(iconsDir, 'icon.ico');
    const pngBuffers = await Promise.all(
        icoSizes.map((size) =>
            sharp(croppedBuf)
                .resize(size, size, { fit: 'cover' })
                .png({ quality: 100, compressionLevel: 9 })
                .toBuffer()
        )
    );

    const icoBuffer = await pngToIco(pngBuffers);
    fs.writeFileSync(icoPath, icoBuffer);
    return icoPath;
}

function verifyRequiredIcons() {
    const required = [
        'icon-source.png',
        'icon.ico',
        'icon.png',
        'icon-16.png',
        'icon-32.png',
        'icon-48.png',
        'icon-64.png',
        'icon-128.png',
        'icon-256.png',
        'icon-512.png',
        'tray-icon.png',
        'tray-icon@2x.png',
    ];

    const missing = required.filter((name) => !fileExists(path.join(iconsDir, name)));
    return { required, missing };
}

async function run() {
    ensureDir(iconsDir);

    const input = fileExists(sourcePng) ? sourcePng : sourceFallback;
    if (!fileExists(input)) {
        throw new Error(`Missing source icon. Expected ${sourcePng} or ${sourceFallback}`);
    }

    const croppedBuf = await getCroppedBuffer(input);

    for (const size of appSizes) {
        await generatePngSize(croppedBuf, size);
    }

    // icon.png is the standard 256px app asset used as a fallback.
    await sharp(croppedBuf)
        .resize(256, 256, { fit: 'cover' })
        .png({ quality: 100, compressionLevel: 9 })
        .toFile(path.join(iconsDir, 'icon.png'));

    await generateTrayIcons(croppedBuf);
    await generateIco(croppedBuf);

    const verification = verifyRequiredIcons();
    if (verification.missing.length > 0) {
        throw new Error(`Icon generation incomplete. Missing: ${verification.missing.join(', ')}`);
    }

    console.log('Icon pipeline is healthy. Generated and verified icon assets:');
    verification.required.forEach((name) => console.log(` - ${name}`));
}

run().catch((error) => {
    console.error('Failed to generate icons:', error.message);
    process.exit(1);
});
