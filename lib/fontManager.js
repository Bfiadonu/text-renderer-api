const { registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const FONT_CACHE_DIR = process.env.FONT_CACHE_DIR || '/tmp/fonts';
if (!fs.existsSync(FONT_CACHE_DIR)) fs.mkdirSync(FONT_CACHE_DIR, { recursive: true });

const registeredFonts = new Set();

// Map commercial fonts to closest Google Fonts equivalents
const FONT_ALIASES = {
  'helvetica': 'Roboto',
  'arial': 'Roboto',
  'futura': 'Nunito Sans',
  'century gothic': 'Raleway',
  'gill sans': 'Lato',
  'palatino': 'Libre Baskerville',
  'baskerville': 'Libre Baskerville',
  'times new roman': 'Merriweather',
  'times': 'Merriweather',
  'caslon': 'Libre Caslon Text',
  'garamond': 'EB Garamond',
  'bodoni': 'Libre Bodoni',
  'didot': 'Playfair Display',
  'optima': 'Lato',
  'avenir': 'Nunito',
  'myriad pro': 'Source Sans Pro',
  'frutiger': 'Open Sans',
  'univers': 'Roboto',
  'din': 'DM Sans',
  'cooper black': 'Alfa Slab One',
  'rockwell': 'Roboto Slab',
  'impact': 'Oswald',
  'franklin gothic': 'Libre Franklin',
  'open sans': 'Open Sans',
  'merriweather': 'Merriweather',
  'roboto': 'Roboto',
  'lato': 'Lato',
  'montserrat': 'Montserrat',
  'poppins': 'Poppins',
  'source sans pro': 'Source Sans Pro',
  'nunito': 'Nunito',
  'raleway': 'Raleway',
  'playfair display': 'Playfair Display',
  'oswald': 'Oswald',
};

const WEIGHT_MAP = {
  'thin': '100',
  'extralight': '200',
  'light': '300',
  'regular': '400',
  'normal': '400',
  'medium': '500',
  'semibold': '600',
  'bold': '700',
  'extrabold': '800',
  'black': '900',
  'heavy': '900',
};

function resolveFont(family) {
  const lower = (family || '').toLowerCase().trim();
  return FONT_ALIASES[lower] || family;
}

function resolveWeight(weight) {
  if (!weight) return '400';
  const w = String(weight).toLowerCase().trim();
  return WEIGHT_MAP[w] || w;
}

// Find the actual TTF file path for a system font
function findSystemFontPath(family, weight) {
  try {
    const numWeight = resolveWeight(weight);
    const weightStyle = parseInt(numWeight) >= 600 ? ':weight=bold' : '';
    const result = execSync(`fc-match -f "%{file}" "${family}${weightStyle}"`, { encoding: 'utf-8', timeout: 3000 });
    const filePath = result.trim();
    // Only return TTF or OTF files — node-canvas cannot parse woff/woff2
    if (filePath && fs.existsSync(filePath) && /\.(ttf|otf)$/i.test(filePath)) {
      return filePath;
    }
  } catch (e) {}
  return null;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl, redirectCount) => {
      if (redirectCount > 5) return reject(new Error('Too many redirects'));
      https.get(requestUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return makeRequest(res.headers.location, redirectCount + 1);
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks));
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
        res.on('error', reject);
      }).on('error', reject);
    };
    makeRequest(url, 0);
  });
}

async function ensureFont(family, weight) {
  const resolvedFamily = resolveFont(family);
  const numericWeight = resolveWeight(weight);
  const key = `${resolvedFamily}|${numericWeight}`;

  if (registeredFonts.has(key)) return resolvedFamily;

  // Strategy 1: Check if system font exists (installed in Docker)
  // Don't call registerFont for system fonts — Pango/fontconfig handles them
  // Just verify the font is available so we can use it by name in ctx.font
  const systemPath = findSystemFontPath(resolvedFamily, weight);
  if (systemPath) {
    registeredFonts.add(key);
    console.log(`System font available: ${resolvedFamily} ${numericWeight} at ${systemPath}`);
    return resolvedFamily;
  }

  // Strategy 2: Download from Google Fonts via fonts.google.com/download (always TTF)
  try {
    const safeName = resolvedFamily.replace(/\s+/g, '+');
    const downloadUrl = `https://fonts.google.com/download?family=${safeName}`;
    const zipData = await httpsGet(downloadUrl);

    // The ZIP contains TTF files. Find and extract the right weight.
    const fontDir = path.join(FONT_CACHE_DIR, resolvedFamily.replace(/\s+/g, '_'));
    if (!fs.existsSync(fontDir)) fs.mkdirSync(fontDir, { recursive: true });

    const zipPath = path.join(FONT_CACHE_DIR, `${resolvedFamily.replace(/\s+/g, '_')}.zip`);
    fs.writeFileSync(zipPath, zipData);

    // Extract using system unzip
    execSync(`unzip -o -q "${zipPath}" -d "${fontDir}" 2>/dev/null || true`, { timeout: 10000 });
    fs.unlinkSync(zipPath);

    // Find matching TTF file
    const weightNames = {
      '100': ['Thin'],
      '200': ['ExtraLight', 'UltraLight'],
      '300': ['Light'],
      '400': ['Regular', 'Normal', ''],
      '500': ['Medium'],
      '600': ['SemiBold', 'DemiBold'],
      '700': ['Bold'],
      '800': ['ExtraBold', 'UltraBold'],
      '900': ['Black', 'Heavy'],
    };

    const candidates = weightNames[numericWeight] || ['Regular'];
    let ttfPath = null;

    // Recursively find all .ttf files
    const findTtfFiles = (dir) => {
      const files = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...findTtfFiles(fullPath));
        } else if (entry.name.toLowerCase().endsWith('.ttf')) {
          files.push(fullPath);
        }
      }
      return files;
    };

    const ttfFiles = findTtfFiles(fontDir);

    // Match by weight name
    for (const candidate of candidates) {
      const match = ttfFiles.find(f => {
        const base = path.basename(f, '.ttf').replace(/-/g, '');
        return base.toLowerCase().includes(candidate.toLowerCase()) ||
               (candidate === '' && base.toLowerCase().includes('regular'));
      });
      if (match) { ttfPath = match; break; }
    }

    // Fallback: use any TTF that's not italic
    if (!ttfPath) {
      ttfPath = ttfFiles.find(f => !f.toLowerCase().includes('italic')) || ttfFiles[0];
    }

    if (ttfPath) {
      registerFont(ttfPath, {
        family: resolvedFamily,
        weight: numericWeight,
        style: 'normal',
      });
      registeredFonts.add(key);
      console.log(`Registered downloaded font: ${resolvedFamily} ${numericWeight} from ${ttfPath}`);
      return resolvedFamily;
    }

    throw new Error('No TTF file found in downloaded archive');
  } catch (e) {
    console.error(`Font download failed for ${resolvedFamily}: ${e.message}`);
    // Fallback to Roboto (always available as system font)
    if (resolvedFamily !== 'Roboto') {
      console.log(`Falling back to Roboto for ${family}`);
      return ensureFont('Roboto', weight);
    }
    throw e;
  }
}

// Detect script and load Noto fallback fonts for non-Latin text
async function ensureScriptFonts(text) {
  const loaded = [];

  if (/[\u0980-\u09FF]/.test(text)) {
    try { await ensureFont('Noto Sans Bengali', '400'); loaded.push('Noto Sans Bengali'); } catch (e) {}
    try { await ensureFont('Noto Sans Bengali', '700'); } catch (e) {}
  }

  if (/[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F]/.test(text)) {
    try { await ensureFont('Noto Sans SC', '400'); loaded.push('Noto Sans SC'); } catch (e) {}
    try { await ensureFont('Noto Sans SC', '700'); } catch (e) {}
  }

  if (/[\u0900-\u097F]/.test(text)) {
    try { await ensureFont('Noto Sans Devanagari', '400'); loaded.push('Noto Sans Devanagari'); } catch (e) {}
    try { await ensureFont('Noto Sans Devanagari', '700'); } catch (e) {}
  }

  if (/[\u0600-\u06FF]/.test(text)) {
    try { await ensureFont('Noto Sans Arabic', '400'); loaded.push('Noto Sans Arabic'); } catch (e) {}
    try { await ensureFont('Noto Sans Arabic', '700'); } catch (e) {}
  }

  return loaded;
}

module.exports = { ensureFont, ensureScriptFonts, resolveFont, resolveWeight };
