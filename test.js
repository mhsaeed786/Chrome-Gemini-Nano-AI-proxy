const axios = require('axios');
const { spawn } = require('child_process');

async function runTests() {
  console.log('Starting server for tests...');
  const server = spawn('node', ['index.js'], { env: { ...process.env, PORT: 3001 } });
  
  server.stdout.on('data', data => console.log(`[SERVER] ${data.toString().trim()}`));
  server.stderr.on('data', data => console.error(`[SERVER ERROR] ${data.toString().trim()}`));

  // Wait for server to start by polling the generate-key endpoint until it doesn't return ECONNREFUSED
  for (let i = 0; i < 20; i++) {
    try {
      await axios.post('http://localhost:3001/admin/generate-key');
      break;
    } catch (e) {
      if (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET') {
        await new Promise(r => setTimeout(r, 1000));
      } else {
        break;
      }
    }
  }

  try {
    // 1. Generate Key
    console.log('\\n--- Generating API Key ---');
    const keyRes = await axios.post('http://localhost:3001/admin/generate-key');
    const apiKey = keyRes.data.key;
    console.log('Key generated:', apiKey);

    const headers = { 'Authorization': `Bearer ${apiKey}` };

    // 2. Test OpenAI Endpoint
    console.log('\\n--- Testing OpenAI Endpoint ---');
    let openAIStart = Date.now();
    try {
      const openAIRes = await axios.post('http://localhost:3001/v1/chat/completions', {
        model: 'chrome-ai',
        messages: [{ role: 'user', content: 'Write a haiku about code.' }]
      }, { headers });
      const openAIDuration = (Date.now() - openAIStart) / 1000;
      const text = openAIRes.data.choices[0].message.content;
      console.log('OpenAI Response:', text);
      const approxTokens = text.length / 4;
      console.log(`OpenAI TPS: ${(approxTokens / openAIDuration).toFixed(2)} tokens/sec`);
    } catch (e) {
      console.error('OpenAI Error:', e.response ? e.response.data : e.message);
    }
    
    console.log('\\n--- Testing OpenAI Streaming ---');
    try {
      const openAIStream = await axios.post('http://localhost:3001/v1/chat/completions', {
        model: 'chrome-ai',
        stream: true,
        messages: [{ role: 'user', content: 'Stream test' }]
      }, { headers, responseType: 'stream' });
      
      await new Promise(r => {
        openAIStream.data.on('data', chunk => process.stdout.write(chunk.toString()));
        openAIStream.data.on('end', () => { console.log('\\n[Stream Ended]'); r(); });
      });
    } catch (e) { console.error(e.message); }

    // 3. Test Anthropic Endpoint
    console.log('\\n--- Testing Anthropic Endpoint ---');
    const anthropicStart = Date.now();
    try {
      const anthropicRes = await axios.post('http://localhost:3001/v1/messages', {
        model: 'chrome-ai',
        max_tokens: 1000,
        messages: [{ role: 'user', content: 'Say hello in French.' }]
      }, { headers });
      const anthropicDuration = (Date.now() - anthropicStart) / 1000;
      const text = anthropicRes.data.content[0].text;
      console.log('Anthropic Response:', text);
      const approxTokens = text.length / 4;
      console.log(`Anthropic TPS: ${(approxTokens / anthropicDuration).toFixed(2)} tokens/sec`);
    } catch (e) {
      console.error('Anthropic Error:', e.response ? e.response.data : e.message);
    }

    // 4. Test Gemini Endpoint
    console.log('\\n--- Testing Gemini Endpoint ---');
    const geminiStart = Date.now();
    try {
      const geminiRes = await axios.post('http://localhost:3001/v1/models/gemini:generateContent', {
        contents: [{ role: 'user', parts: [{ text: 'What is 2+2?' }] }]
      }, { headers });
      const geminiDuration = (Date.now() - geminiStart) / 1000;
      const text = geminiRes.data.candidates[0].content.parts[0].text;
      console.log('Gemini Response:', text);
      const approxTokens = text.length / 4;
      console.log(`Gemini TPS: ${(approxTokens / geminiDuration).toFixed(2)} tokens/sec`);
    } catch (e) {
      console.error('Gemini Error:', e.response ? e.response.data : e.message);
    }

  } finally {
    console.log('\\nShutting down server...');
    server.kill();
  }
}

runTests().catch(console.error);
