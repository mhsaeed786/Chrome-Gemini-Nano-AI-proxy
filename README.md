# Chrome AI Proxy

This project creates a local API proxy that wraps Chrome's built-in AI (Gemini Nano) via the Prompt API, exposing it as OpenAI, Anthropic, and Gemini compatible endpoints. This allows you to use your browser's local AI model as a fallback or extra usage for tools like Goose and Hermes Agent Apps.

## Prerequisites
1. **Chrome Version**: Ensure you are using Google Chrome version 127+ or Chrome Canary.
2. **Enable Prompt API**: 
   - Navigate to `chrome://flags` in Chrome.
   - Find and enable **"Prompt API for Gemini Nano"**.
   - Find and enable **"Enables optimization guide on device"** (Set to 'Enabled BypassPerfRequirement' if available).
   - Relaunch Chrome.
3. Wait for the model to download (can be checked in `chrome://components` under "Optimization Guide On Device Model").

## Installation

1. Navigate to this directory.
2. Run `npm install` (if dependencies are not already installed).

## Starting the Server

```bash
npm start
```
The server will start at `http://localhost:3000`. It will attempt to launch a headless Chrome instance that connects to the Prompt API.

## API Keys (Authentication)

The proxy enforces a basic GUID-based API key system. The first time you start the server, no keys are configured, but the system allows the first request if the array is empty. However, it is highly recommended to generate a key explicitly.

**Generate an API Key:**
```bash
curl -X POST http://localhost:3000/admin/generate-key
```
Use the returned `key` as your API Key (e.g., as a Bearer token or `x-api-key` header).

## Usage in Agent Apps

### OpenAI Compatible (e.g., for Goose / Hermes)
- **Base URL / Endpoint**: `http://localhost:3000/v1`
- **Model Name**: `chrome-ai-nano` (or any string, the proxy ignores the exact model name since it only uses the built-in Nano model)
- **API Key**: `<YOUR_GENERATED_KEY>`

### Anthropic Compatible
- **Base URL**: `http://localhost:3000` (The client will append `/v1/messages`)
- **Model Name**: `chrome-ai-nano`
- **API Key**: `<YOUR_GENERATED_KEY>`

### Gemini Compatible
- **Base URL**: `http://localhost:3000` (The client will append `/v1/models/...`)
- **API Key**: `<YOUR_GENERATED_KEY>`

## Notes on Multimodal / Images
Currently, Chrome's built-in AI only supports **text** processing. If an agent app sends a request containing images, this proxy will safely omit the images, replacing them with a placeholder warning so the app does not crash, and process the remaining text.
