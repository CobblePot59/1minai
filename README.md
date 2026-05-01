# 1min.ai Chat

A self-hosted web chat interface for the [1min.ai](https://1min.ai) API, built with Flask and vanilla JavaScript.

## Features

- Multi-model support (GPT, Claude, Gemini, and more via 1min.ai)
- Streaming responses
- Conversation history with localStorage persistence
- File attachments : images (uploaded to 1min.ai asset API) and text/code files (inlined into the prompt)
- Drag and drop file upload
- Web search integration
- Markdown rendering

## Requirements

- Docker and Docker Compose
- A [1min.ai](https://1min.ai) API key

## Getting started

**1. Clone the repository**

```bash
git clone https://github.com/CobblePot59/1minai.git
cd 1minai
```

**2. Create a `.env` file**

```env
API_KEY=your_1min_ai_api_key
FLASK_ENV=production
```

**3. Start the container**

```bash
docker compose up -d
```

The app is available at `http://localhost:5000`.

## Models

The available models are loaded from `app/models.json`. Edit this file to add or remove models. Each entry requires:

```json
{
  "code": "model-id",
  "name": "Display Name",
  "provider": "Provider",
  "supports_image": true
}
```