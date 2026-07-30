const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');

let browser;
let page;
const streamCallbacks = new Map();

async function initBrowser(chromeExecutablePath) {
  const executablePath = chromeExecutablePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  
  console.log(`Launching Chrome from ${executablePath} with Multimodal flags...`);
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--enable-features=PromptAPIForGeminiNano,PromptAPIForGeminiNanoMultimodalInput', 
      '--no-sandbox', 
      '--disable-setuid-sandbox'
    ]
  });

  page = await browser.newPage();
  
  await page.exposeFunction('onStreamChunk', (sessionId, chunk) => {
    const callback = streamCallbacks.get(sessionId);
    if (callback) {
      callback(chunk);
    }
  });
  
  await page.exposeFunction('onStreamEnd', (sessionId, fullText, error) => {
    const callback = streamCallbacks.get(sessionId + '_end');
    if (callback) {
      callback(fullText, error);
    }
    streamCallbacks.delete(sessionId);
    streamCallbacks.delete(sessionId + '_end');
  });

  await page.goto('about:blank');
  
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
    initialPrompts.push({ role: 'system', content: systemPrompt }); // simplified to text
  }
  for (const msg of history || []) {
    // Initial prompts in history usually expect string content in current Chrome draft,
    // but we can pass the parts if it supports it. We will stringify history images as [Image] to be safe,
    // since session creation (initialPrompts) often doesn't accept ImageBitmap yet, only the final prompt() does.
    const textContent = msg.parts.map(p => p.type === 'image' ? '[Image included]' : p.text).join('\\n');
    initialPrompts.push({
      role: msg.role === 'user' ? 'user' : 'model',
      content: textContent
    });
  }
  return initialPrompts;
}

async function generate(promptParts, systemPrompt, history = []) {
  if (!page) throw new Error('Browser not initialized');
  
  const initialPrompts = formatHistory(systemPrompt, history);
  
  return await page.evaluate(async (promptParts, initialPrompts) => {
    if (!window.ai || !window.ai.languageModel) {
      return "[Mocked Inference]: Chrome Prompt API is not enabled in this profile. The prompt and base64 images were received correctly and parsed into ImageBitmaps.";
    }
    
    // Convert parts into the array Chrome expects
    const finalPromptArray = [];
    let hasImage = false;
    for (const part of promptParts) {
      if (part.type === 'image') {
        hasImage = true;
        const dataUrl = `data:${part.mimeType};base64,${part.data}`;
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        // Chrome's multimodal Prompt API generally expects the ImageBitmap directly in the array,
        // or an object { type: 'image', image: bitmap }. Let's pass the bitmap directly as per recent standard drafts.
        finalPromptArray.push(bitmap);
      } else {
        finalPromptArray.push(part.text);
      }
    }
    
    // Create session, hint if we expect images
    const sessionOpts = { initialPrompts };
    if (hasImage) {
      sessionOpts.expectedInputs = [{ type: 'image' }];
    }
    
    const session = await window.ai.languageModel.create(sessionOpts);
    
    // Pass the array of text/bitmaps to prompt
    const result = await session.prompt(finalPromptArray.length === 1 && !hasImage ? finalPromptArray[0] : finalPromptArray);
    session.destroy();
    return result;
  }, promptParts, initialPrompts);
}

async function generateStream(promptParts, systemPrompt, history = [], onChunk) {
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
      await page.evaluate(async (promptParts, initialPrompts, sessionId) => {
        try {
          if (!window.ai || !window.ai.languageModel) {
             const mock = "[Mocked Streaming Inference]: Chrome Prompt API is not enabled. Image parts parsed successfully.";
             for (let i = 0; i < mock.length; i += 5) {
                window.onStreamChunk(sessionId, mock.substring(i, i+5));
             }
             window.onStreamEnd(sessionId, mock, null);
             return;
          }
          
          const finalPromptArray = [];
          let hasImage = false;
          for (const part of promptParts) {
            if (part.type === 'image') {
              hasImage = true;
              const dataUrl = `data:${part.mimeType};base64,${part.data}`;
              const response = await fetch(dataUrl);
              const blob = await response.blob();
              const bitmap = await createImageBitmap(blob);
              finalPromptArray.push(bitmap);
            } else {
              finalPromptArray.push(part.text);
            }
          }
          
          const sessionOpts = { initialPrompts };
          if (hasImage) {
            sessionOpts.expectedInputs = [{ type: 'image' }];
          }
          
          const session = await window.ai.languageModel.create(sessionOpts);
          const stream = await session.promptStreaming(finalPromptArray.length === 1 && !hasImage ? finalPromptArray[0] : finalPromptArray);
          
          let previousChunkLength = 0;
          let fullText = '';
          for await (const chunk of stream) {
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
      }, promptParts, initialPrompts, sessionId);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { initBrowser, generate, generateStream };
