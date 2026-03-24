const { createCanvas, loadImage } = require('canvas');
const { ensureFont, ensureScriptFonts, resolveFont, resolveWeight } = require('./fontManager');

// Sample background color from image edges around a bounding box
function sampleBackgroundColor(ctx, x, y, width, height, imgW, imgH) {
  const samples = [];
  const offsets = [
    [x - 2, y + Math.floor(height / 2)],       // left edge
    [x + width + 2, y + Math.floor(height / 2)], // right edge
    [x + Math.floor(width / 2), y - 2],          // top edge
    [x + Math.floor(width / 2), y + height + 2],  // bottom edge
  ];

  for (const [sx, sy] of offsets) {
    if (sx >= 0 && sx < imgW && sy >= 0 && sy < imgH) {
      const pixel = ctx.getImageData(sx, sy, 1, 1).data;
      samples.push([pixel[0], pixel[1], pixel[2]]);
    }
  }

  if (samples.length === 0) return '#FFFFFF';

  // Use median of samples
  const r = Math.round(samples.reduce((s, c) => s + c[0], 0) / samples.length);
  const g = Math.round(samples.reduce((s, c) => s + c[1], 0) / samples.length);
  const b = Math.round(samples.reduce((s, c) => s + c[2], 0) / samples.length);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Word-wrap text to fit within maxWidth
function wrapText(ctx, text, maxWidth) {
  // Handle CJK text (no spaces between characters)
  const hasCJK = /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text);

  if (hasCJK) {
    return wrapCJK(ctx, text, maxWidth);
  }

  const words = text.split(/(\s+)/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (word.match(/^\s+$/)) {
      currentLine += word;
      continue;
    }
    const testLine = currentLine + word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine.trim()) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines;
}

function wrapCJK(ctx, text, maxWidth) {
  const lines = [];
  let currentLine = '';

  for (const char of text) {
    const testLine = currentLine + char;
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

async function renderTextBlocks(imageBuffer, textBlocks) {
  const img = await loadImage(imageBuffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');

  // Draw the original image
  ctx.drawImage(img, 0, 0);

  for (const block of textBlocks) {
    const {
      text,
      x,
      y,
      width,
      height,
      font_family = 'Roboto',
      font_size = 12,
      font_weight = '400',
      font_color = '#000000',
      background_color = null,
      line_height = 1.4,
      padding = 5,
      text_align = 'left',
    } = block;

    if (!text || !text.trim()) continue;

    // Load the font
    const resolvedFamily = await ensureFont(font_family, font_weight);
    const numericWeight = resolveWeight(font_weight);

    // Load script-specific fallback fonts
    await ensureScriptFonts(text);

    // Determine background color
    let bgColor = background_color;
    if (!bgColor) {
      bgColor = sampleBackgroundColor(ctx, x, y, width, height, img.width, img.height);
    }

    // Erase the area
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, width, height);

    // Set up text rendering
    const fontStr = `${numericWeight >= 600 ? 'bold' : ''} ${font_size}px "${resolvedFamily}"`.trim();
    ctx.font = fontStr;
    ctx.fillStyle = font_color;
    ctx.textBaseline = 'top';
    ctx.textAlign = text_align;

    const innerWidth = width - (padding * 2);
    const lineHeightPx = font_size * line_height;

    // Split into paragraphs and wrap
    const paragraphs = text.split(/\n\n|\r\n\r\n/);
    let curY = y + padding;
    const startX = text_align === 'center' ? x + width / 2 :
                   text_align === 'right' ? x + width - padding : x + padding;

    // First pass: check if text fits. If not, reduce font size.
    let effectiveSize = font_size;
    let allLines = [];

    for (let attempt = 0; attempt < 10; attempt++) {
      const testFont = `${numericWeight >= 600 ? 'bold' : ''} ${effectiveSize}px "${resolvedFamily}"`.trim();
      ctx.font = testFont;

      allLines = [];
      for (let pi = 0; pi < paragraphs.length; pi++) {
        const lines = wrapText(ctx, paragraphs[pi].trim(), innerWidth);
        allLines.push(...lines);
        if (pi < paragraphs.length - 1) allLines.push(null); // paragraph break marker
      }

      const totalHeight = allLines.reduce((h, line) => {
        if (line === null) return h + effectiveSize * line_height * 0.3;
        return h + effectiveSize * line_height;
      }, 0);

      if (totalHeight <= height - (padding * 2) || effectiveSize <= font_size * 0.6) break;
      effectiveSize -= 0.5;
    }

    // Re-set font with effective size
    const finalFont = `${numericWeight >= 600 ? 'bold' : ''} ${effectiveSize}px "${resolvedFamily}"`.trim();
    ctx.font = finalFont;
    const effectiveLineHeight = effectiveSize * line_height;

    // Render lines
    for (const line of allLines) {
      if (line === null) {
        curY += effectiveLineHeight * 0.3;
        continue;
      }
      if (curY + effectiveLineHeight > y + height) break; // overflow protection
      ctx.fillText(line, startX, curY, innerWidth);
      curY += effectiveLineHeight;
    }
  }

  // Return as PNG buffer
  return canvas.toBuffer('image/png');
}

module.exports = { renderTextBlocks };
