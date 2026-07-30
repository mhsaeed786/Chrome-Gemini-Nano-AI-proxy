require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initBrowser } = require('./browser');
const { authMiddleware, generateKey } = require('./auth');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// A simple management endpoint to generate keys locally (only allowed from localhost)
app.post('/admin/generate-key', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (ip === '::1' || ip === '127.0.0.1' || ip.includes('::ffff:127.0.0.1')) {
    const newKey = generateKey();
    res.json({ key: newKey });
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
});

// Protect all other routes
app.use(authMiddleware);

// Mount AI routes
app.use(routes);

async function start() {
  try {
    console.log('Initializing headless Chrome for Prompt API...');
    await initBrowser(process.env.CHROME_PATH); // Will fallback to default Windows path
    
    app.listen(PORT, () => {
      console.log(`=================================`);
      console.log(`🚀 Chrome AI Proxy running at http://localhost:${PORT}`);
      console.log(`=================================`);
      console.log(`Endpoints available:`);
      console.log(` - OpenAI:    POST http://localhost:${PORT}/v1/chat/completions`);
      console.log(` - Anthropic: POST http://localhost:${PORT}/v1/messages`);
      console.log(` - Gemini:    POST http://localhost:${PORT}/v1/models/gemini-nano:generateContent`);
      console.log(``);
      console.log(`🔑 To generate a new API Key, run:`);
      console.log(` curl -X POST http://localhost:${PORT}/admin/generate-key`);
      console.log(`=================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
