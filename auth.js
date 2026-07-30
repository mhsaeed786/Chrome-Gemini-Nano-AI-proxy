const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const keysFile = path.join(__dirname, 'keys.json');

// Initialize keys file if not exists
if (!fs.existsSync(keysFile)) {
  fs.writeFileSync(keysFile, JSON.stringify({ keys: [] }));
}

function getKeys() {
  const data = fs.readFileSync(keysFile);
  return JSON.parse(data).keys;
}

function saveKeys(keys) {
  fs.writeFileSync(keysFile, JSON.stringify({ keys }, null, 2));
}

function generateKey() {
  const key = uuidv4();
  const keys = getKeys();
  keys.push(key);
  saveKeys(keys);
  return key;
}

function validateKey(key) {
  // If no keys exist yet, let the first request pass or maybe we want explicit generation
  const keys = getKeys();
  if (keys.length === 0) return true; // allow all if no keys set up (optional)
  return keys.includes(key);
}

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const apiKey = authHeader.replace('Bearer ', '').trim() || req.headers['x-api-key'] || req.query.key;

  if (!validateKey(apiKey)) {
    return res.status(401).json({ error: 'Unauthorized. Invalid API Key.' });
  }
  next();
};

module.exports = { generateKey, authMiddleware };
