const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { generate, generateStream } = require('./browser');

const router = express.Router();

// Helper to extract parts from various message formats
// Returns an array of parts: { type: 'text', text: '...' } or { type: 'image', mimeType: '...', data: '...' }
function extractParts(content) {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      // OpenAI/Anthropic text
      if (part.type === 'text') {
        parts.push({ type: 'text', text: part.text });
      } 
      // Gemini text
      else if (part.text) {
        parts.push({ type: 'text', text: part.text });
      }
      // OpenAI image
      else if (part.type === 'image_url') {
        let url = part.image_url.url;
        if (url.startsWith('data:')) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) parts.push({ type: 'image', mimeType: match[1], data: match[2] });
        } else {
          // If it's a real URL, we would need to fetch it. For now, we assume agent sends base64 for local proxy
          parts.push({ type: 'text', text: `[Image URL provided: ${url}. Chrome API requires base64 inline images.]` });
        }
      }
      // Anthropic image
      else if (part.type === 'image' && part.source && part.source.type === 'base64') {
        parts.push({ type: 'image', mimeType: part.source.media_type, data: part.source.data });
      }
      // Gemini image
      else if (part.inlineData) {
        parts.push({ type: 'image', mimeType: part.inlineData.mimeType, data: part.inlineData.data });
      }
    }
    return parts;
  }
  return [];
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
        const parts = extractParts(msg.content);
        systemPrompt += parts.map(p => p.text || '').join('\n') + '\n';
      } else {
        history.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: extractParts(msg.content)
        });
      }
    }
    
    const promptParts = history.pop()?.parts || [];

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const id = 'chatcmpl-' + uuidv4();
      const created = Math.floor(Date.now() / 1000);
      
      await generateStream(promptParts, systemPrompt.trim(), history, (chunk) => {
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
      const result = await generate(promptParts, systemPrompt.trim(), history);
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
    let systemPrompt = '';
    if (system) {
      const parts = extractParts(system);
      systemPrompt = parts.map(p => p.text || '').join('\n');
    }
    
    const history = [];
    for (const msg of messages) {
      history.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: extractParts(msg.content)
      });
    }
    
    const promptParts = history.pop()?.parts || [];

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const msgId = 'msg_' + uuidv4();
      
      res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, role: 'assistant', model: 'chrome-ai-nano' } })}\n\n`);
      res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
      
      await generateStream(promptParts, systemPrompt, history, (chunk) => {
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } })}\n\n`);
      });
      
      res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      return res.end();
      
    } else {
      const result = await generate(promptParts, systemPrompt, history);
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
router.post('/v1/models/:model\\::action', async (req, res) => {
  try {
    const action = req.params.action; 
    const isStream = action === 'streamGenerateContent' || req.query.alt === 'sse';
    
    const { contents, systemInstruction } = req.body;
    const systemPrompt = systemInstruction?.parts?.map(p => p.text || '').join('\n') || '';
    
    const history = [];
    for (const c of contents) {
      history.push({
        role: c.role === 'model' ? 'model' : 'user',
        parts: extractParts(c.parts)
      });
    }
    
    const promptParts = history.pop()?.parts || [];

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      await generateStream(promptParts, systemPrompt, history, (chunk) => {
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: chunk }], role: 'model' } }] })}\n\n`);
      });
      return res.end();
    } else {
      const result = await generate(promptParts, systemPrompt, history);
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
