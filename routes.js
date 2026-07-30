const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { generate, generateStream } = require('./browser');

const router = express.Router();

// Helper to extract text from various message formats
function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (part.type === 'text') return part.text;
      if (part.text) return part.text;
      if (part.type === 'image_url' || part.type === 'image') {
        return '[Image omitted - Chrome AI currently supports text only]';
      }
      return '';
    }).join('\n');
  }
  return '';
}

// -----------------------------------------
// OpenAI Compatible Endpoint
// -----------------------------------------
router.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, stream } = req.body;
    let systemPrompt = '';
    const history = [];
    
    // Parse messages
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt += extractText(msg.content) + '\n';
      } else {
        history.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          content: extractText(msg.content)
        });
      }
    }
    
    const prompt = history.pop()?.content || '';

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const id = 'chatcmpl-' + uuidv4();
      const created = Math.floor(Date.now() / 1000);
      
      await generateStream(prompt, systemPrompt.trim(), history, (chunk) => {
        const payload = {
          id,
          object: 'chat.completion.chunk',
          created,
          model: 'chrome-ai-nano',
          choices: [{ delta: { content: chunk }, index: 0, finish_reason: null }]
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      });
      
      res.write(`data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created, model: 'chrome-ai-nano',
        choices: [{ delta: {}, index: 0, finish_reason: 'stop' }]
      })}\n\n`);
      return res.end('data: [DONE]\n\n');
      
    } else {
      const result = await generate(prompt, systemPrompt.trim(), history);
      return res.json({
        id: 'chatcmpl-' + uuidv4(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'chrome-ai-nano',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });
    }
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
});

// -----------------------------------------
// Anthropic Compatible Endpoint
// -----------------------------------------
router.post('/v1/messages', async (req, res) => {
  try {
    const { messages, system, stream } = req.body;
    const systemPrompt = extractText(system || '');
    const history = [];
    
    for (const msg of messages) {
      history.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        content: extractText(msg.content)
      });
    }
    
    const prompt = history.pop()?.content || '';

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const msgId = 'msg_' + uuidv4();
      
      res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, role: 'assistant', model: 'chrome-ai-nano' } })}\n\n`);
      res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
      
      await generateStream(prompt, systemPrompt, history, (chunk) => {
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } })}\n\n`);
      });
      
      res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      return res.end();
      
    } else {
      const result = await generate(prompt, systemPrompt, history);
      return res.json({
        id: 'msg_' + uuidv4(),
        type: 'message',
        role: 'assistant',
        model: 'chrome-ai-nano',
        content: [{ type: 'text', text: result }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 }
      });
    }
  } catch (error) {
    res.status(500).json({ type: 'error', error: { type: 'api_error', message: error.message } });
  }
});

// -----------------------------------------
// Gemini Compatible Endpoint
// -----------------------------------------
// Regex to catch both /v1/models/model-name:generateContent and streamGenerateContent
router.post('/v1/models/:model\\::action', async (req, res) => {
  try {
    const action = req.params.action; // generateContent or streamGenerateContent
    const isStream = action === 'streamGenerateContent' || req.query.alt === 'sse';
    
    const { contents, systemInstruction } = req.body;
    const systemPrompt = systemInstruction?.parts?.map(p => p.text).join('\n') || '';
    
    const history = [];
    for (const c of contents) {
      history.push({
        role: c.role === 'model' ? 'model' : 'user',
        content: c.parts.map(p => p.text || '').join('\n')
      });
    }
    
    const prompt = history.pop()?.content || '';

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      await generateStream(prompt, systemPrompt, history, (chunk) => {
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: chunk }], role: 'model' } }] })}\n\n`);
      });
      return res.end();
    } else {
      const result = await generate(prompt, systemPrompt, history);
      return res.json({
        candidates: [{
          content: { parts: [{ text: result }], role: 'model' },
          finishReason: 'STOP',
          index: 0
        }]
      });
    }
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
});

module.exports = router;
