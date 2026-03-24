const { registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const contentType = res.headers['content-type'] || '';
          if (contentType.includes('text') || contentType.includes('css')) {
            resolve(Buffer.concat(chunks).toString('utf-8'));
          } else {
            resolve(Buffer.concat(chunks));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadFont(family, numericWeight) {
  const safeName = family.replace(/\s+/g, '+');
  const cssUrl = `https://fonts.googleapis.com/css2?family=${safeName}:wght@${numericWeight}&display=swap`;

  let css;
  try {
    css = await httpGet(cssUrl);
  } catch (e) {
    throw new Error(`Failed to fetch Google Fonts CSS for "${family}" weight ${numericWeight}: ${e.message}`);
  }

  // Extract TTF/WOFF URL from CSS
  const urlMatch = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!urlMatch) {
    throw new Error(`No font URL found in CSS for "${family}" weight ${numericWeight}. CSS: ${css.substring(0, 200)}`);
  }

  const fontUrl = urlMatch[1];
  const ext = fontUrl.includes('.woff2') ? '.woff2' : fontUrl.includes('.ttf') ? '.ttf' : '.woff';
  const fileName = `${family.replace(/\s+/g, '_')}-${numericWeight}${ext}`;
  const fontPath = path.join(FONT_CACHE_DIR, fileName);

  if (!fs.existsSync(fontPath)) {
    const fontData = await httpGet(fontUrl);
    fs.writeFileSync(fontPath, fontData);
  }

  return fontPath;
}

async function ensureFont(family, weight) {
  const resolvedFamily = resolveFont(family);
  const numericWeight = resolveWeight(weight);
  const key = `${resolvedFamily}|${numericWeight}`;

  if (registeredFonts.has(key)) return resolvedFamily;

  try {
    const fontPath = await downloadFont(resolvedFamily, numericWeight);
    registerFont(fontPath, {
      family: resolvedFamily,
      weight: numericWeight,
      style: 'normal',
    });
    registeredFonts.add(key);
    console.log(`Registered font: ${resolvedFamily} weight ${numericWeight}`);
  } catch (e) {
    console.error(`Font load failed for ${resolvedFamily} ${numericWeight}: ${e.message}`);
    // Try fallback
    if (resolvedFamily !== 'Roboto') {
      console.log(`Falling back to Roboto for ${family}`);
      return ensureFont('Roboto', weight);
    }
    throw e;
  }

  return resolvedFamily;
}

// Detect script and load Noto fallback fonts for non-Latin text
async function ensureScriptFonts(text) {
  const loaded = [];

  // Bengali (U+0980-U+09FF)
  if (/[\u0980-\u09FF]/.test(text)) {
    try {
      await ensureFont('Noto Sans Bengali', '400');
      await ensureFont('Noto Sans Bengali', '700');
      loaded.push('Noto Sans Bengali');
    } catch (e) { console.error('Failed to load Noto Sans Bengali:', e.message); }
  }

  // CJK (Chinese/Japanese/Korean)
  if (/[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\u30A0-\u30FF\u3040-\u309F]/.test(text)) {
    try {
      await ensureFont('Noto Sans SC', '400');
      await ensureFont('Noto Sans SC', '700');
      loaded.push('Noto Sans SC');
    } catch (e) { console.error('Failed to load Noto Sans SC:', e.message); }
  }

  // Devanagari / Hindi (U+0900-U+097F)
  if (/[\u0900-\u097F]/.test(text)) {
    try {
      await ensureFont('Noto Sans Devanagari', '400');
      await ensureFont('Noto Sans Devanagari', '700');
      loaded.push('Noto Sans Devanagari');
    } catch (e) { console.error('Failed to load Noto Sans Devanagari:', e.message); }
  }

  // Arabic (U+0600-U+06FF)
  if (/[\u0600-\u06FF]/.test(text)) {
    try {
      await ensureFont('Noto Sans Arabic', '400');
      await ensureFont('Noto Sans Arabic', '700');
      loaded.push('Noto Sans Arabic');
    } catch (e) { console.error('Failed to load Noto Sans Arabic:', e.message); }
  }

  return loaded;
}

module.exports = { ensureFont, ensureScriptFonts, resolveFont, resolveWeight };
