const express = require('express');
const { renderTextBlocks } = require('./lib/textRenderer');

const app = express();
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'text-renderer-api' });
});

// Main endpoint: overlay text blocks on an image
app.post('/overlay', async (req, res) => {
  try {
    const { image, image_mime, text_blocks, output_mode } = req.body;

    if (!image) return res.status(400).json({ error: 'Missing "image" field (base64)' });
    if (!text_blocks || !Array.isArray(text_blocks) || text_blocks.length === 0) {
      return res.status(400).json({ error: 'Missing or empty "text_blocks" array' });
    }

    // Validate text blocks
    for (let i = 0; i < text_blocks.length; i++) {
      const b = text_blocks[i];
      if (b.x == null || b.y == null || b.width == null || b.height == null) {
        return res.status(400).json({ error: `text_blocks[${i}] missing x, y, width, or height` });
      }
    }

    const imageBuffer = Buffer.from(image, 'base64');
    const resultBuffer = await renderTextBlocks(imageBuffer, text_blocks);

    if (output_mode === 'binary') {
      res.set('Content-Type', 'image/png');
      return res.send(resultBuffer);
    }

    // Default: return base64
    res.json({
      image: resultBuffer.toString('base64'),
      mime_type: 'image/png',
    });
  } catch (err) {
    console.error('Overlay error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Text renderer API running on port ${PORT}`);
});
