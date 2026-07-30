const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

let browser;
let page;
const streamCallbacks = new Map();

async function initBrowser(chromeExecutablePath) {
  const executablePath = chromeExecutablePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  
  console.log(`Launching Chrome from ${executablePath}`);
  browser = await puppeteer.launch({
    executablePath,
    headless: true, // You can change to false for debugging
    args: [
      '--enable-features=PromptAPIForGeminiNano', 
      '--no-sandbox', 
      '--disable-setuid-sandbox'
    ],
    // If the model is in the default profile, you might need to point to the user data dir
    // userDataDir: 'C:\\Users\\<USER>\\AppData\\Local\\Google\\Chrome\\User Data'
  });

  page = await browser.newPage();
  
  // Expose a function to handle streaming chunks back to Node
  await page.exposeFunction('onStreamChunk', (sessionId, chunk) => {
    const callback = streamCallbacks.get(sessionId);
    if (callback) {
      callback(chunk);
    }
  });
  
  // Expose function for stream completion or error
  await page.exposeFunction('onStreamEnd', (sessionId, fullText, error) => {
    const callback = streamCallbacks.get(sessionId + '_end');
    if (callback) {
      callback(fullText, error);
    }
    streamCallbacks.delete(sessionId);
    streamCallbacks.delete(sessionId + '_end');
  });

  // Load a blank page
  await page.goto('about:blank');
  
  // Check availability
  const isAvailable = await page.evaluate(async () => {
    if (!window.ai || !window.ai.languageModel) {
      return 'Prompt API not available. Please ensure you are using Chrome 127+ and have the API enabled.';
    }
    const capabilities = await window.ai.languageModel.capabilities();
    return `Prompt API is available (status: ${capabilities.available})`;
  });
  console.log(isAvailable);
}

// Converts generic history to the format expected by Chrome's initialPrompts
function formatHistory(systemPrompt, history) {
  let initialPrompts = [];
  if (systemPrompt) {
    initialPrompts.push({ role: 'system', content: systemPrompt });
  }
  for (const msg of history || []) {
    initialPrompts.push({
      role: msg.role === 'user' ? 'user' : 'model',
      content: msg.content
    });
  }
  return initialPrompts;
}

async function generate(prompt, systemPrompt, history = []) {
  if (!page) throw new Error('Browser not initialized');
  
  const initialPrompts = formatHistory(systemPrompt, history);
  
  return await page.evaluate(async (prompt, initialPrompts) => {
    if (!window.ai || !window.ai.languageModel) throw new Error('Prompt API not supported');
    
    // Create session
    const session = await window.ai.languageModel.create({ initialPrompts });
    const result = await session.prompt(prompt);
    session.destroy();
    return result;
  }, prompt, initialPrompts);
}

async function generateStream(prompt, systemPrompt, history = [], onChunk) {
  if (!page) throw new Error('Browser not initialized');
  
  const initialPrompts = formatHistory(systemPrompt, history);
  const sessionId = uuidv4();
  
  streamCallbacks.set(sessionId, onChunk);
  
  return new Promise(async (resolve, reject) => {
    streamCallbacks.set(sessionId + '_end', (fullText, error) => {
      if (error) reject(new Error(error));
      else resolve(fullText);
    });
    
    try {
      await page.evaluate(async (prompt, initialPrompts, sessionId) => {
        try {
          if (!window.ai || !window.ai.languageModel) throw new Error('Prompt API not supported');
          const session = await window.ai.languageModel.create({ initialPrompts });
          const stream = await session.promptStreaming(prompt);
          let previousChunkLength = 0;
          let fullText = '';
          for await (const chunk of stream) {
            // Some implementations of promptStreaming return the cumulative string so far
            // We need to check if it's cumulative or just the new token.
            // Documentation usually says it's cumulative. Let's send the new part.
            const newText = chunk.substring(previousChunkLength);
            previousChunkLength = chunk.length;
            fullText = chunk;
            window.onStreamChunk(sessionId, newText);
          }
          session.destroy();
          window.onStreamEnd(sessionId, fullText, null);
        } catch (err) {
          window.onStreamEnd(sessionId, null, err.message);
        }
      }, prompt, initialPrompts, sessionId);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { initBrowser, generate, generateStream };
