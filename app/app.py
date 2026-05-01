import os
import requests
import json
import base64
import time
import io
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

API_KEY = os.getenv('API_KEY', 'YOUR_API_KEY')
CHAT_API_URL = "https://api.1min.ai/api/chat-with-ai"
ASSET_API_URL = "https://api.1min.ai/api/assets"

MODELS_FILE = 'models.json'

# Maps file extensions to MIME types for asset uploads
EXT_TO_MIME = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain', 'csv': 'text/csv', 'json': 'application/json',
    'xml': 'application/xml', 'md': 'text/plain',
    'py': 'text/plain', 'js': 'text/plain', 'ts': 'text/plain',
    'html': 'text/plain', 'css': 'text/plain', 'sh': 'text/plain',
    'yaml': 'text/plain', 'yml': 'text/plain', 'toml': 'text/plain',
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
    'mp4': 'video/mp4', 'webm': 'video/webm',
}

IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'}


def load_models():
    try:
        with open(MODELS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return [
            {
                "code": item["code"],
                "name": item["name"],
                "provider": item.get("provider", "Other"),
                "supports_image": item.get("supports_image", False)
            }
            for item in data
        ]
    except Exception:
        return []


def upload_asset(data_url, index, original_filename=None):
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        raise ValueError("Invalid file format")

    try:
        header, encoded = data_url.split(",", 1)
    except ValueError as exc:
        raise ValueError("Invalid file data") from exc

    # Derive extension and MIME type from original filename when available
    if original_filename and '.' in original_filename:
        ext = original_filename.rsplit('.', 1)[-1].lower()
        mime_type = EXT_TO_MIME.get(ext, 'text/plain')
    else:
        mime_type = header.split(";")[0].replace("data:", "")
        raw_ext = mime_type.split("/")[-1].lower()
        ext_map = {
            'jpeg': 'jpg', 'svg+xml': 'svg', 'mpeg': 'mp3',
            'vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'msword': 'doc', 'octet-stream': 'txt',
        }
        ext = ext_map.get(raw_ext, raw_ext)

    try:
        file_bytes = base64.b64decode(encoded)
    except Exception as exc:
        raise ValueError("Invalid base64 data") from exc

    filename = f"upload_{int(time.time())}_{index}.{ext}"
    response = requests.post(
        ASSET_API_URL,
        headers={"API-KEY": API_KEY},
        files={"asset": (filename, io.BytesIO(file_bytes), mime_type)},
        timeout=30
    )

    if response.status_code != 200:
        raise ValueError(f"Asset upload failed: {response.text}")

    result = response.json()
    return result.get("fileContent", {}).get("path") or result.get("asset", {}).get("key")


@app.route('/')
def index():
    return render_template("index.html", models=load_models())


@app.route('/api/user-info', methods=['GET'])
def get_user_info():
    # Fetches user profile by making a minimal chat request (no dedicated user endpoint exists)
    try:
        response = requests.post(
            CHAT_API_URL,
            headers={"Content-Type": "application/json", "API-KEY": API_KEY},
            json={"type": "UNIFY_CHAT_WITH_AI", "model": "gpt-4o-mini", "promptObject": {"prompt": "hi"}},
            timeout=15
        )
        if response.status_code == 200:
            return jsonify(response.json().get("aiRecord", {}).get("teamUser", {}))
        return jsonify({'error': response.text}), response.status_code
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.json
        prompt = data.get('prompt', '')
        model = data.get('model', 'gpt-4o-mini')
        web_search = data.get('webSearch', False)
        num_of_site = data.get('numOfSite', 1)
        max_word = data.get('maxWord', 500)
        files = data.get('files', [])
        conversation_id = data.get('conversationId')
        history = data.get('history', [])

        if not prompt:
            return jsonify({'error': 'Prompt is required'}), 400

        # Prepend conversation history to the prompt
        if history:
            history_text = "\n".join(
                f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
                for m in history
            )
            full_prompt = f"Conversation history:\n{history_text}\n\nUser: {prompt}"
        else:
            full_prompt = prompt

        prompt_object = {
            "prompt": full_prompt,
            "settings": {
                "historySettings": {"isMixed": False, "historyMessageLimit": 10},
                "webSearchSettings": {"webSearch": web_search, "numOfSite": num_of_site, "maxWord": max_word}
            }
        }

        if files:
            image_paths, file_paths = [], []
            for index, file_obj in enumerate(files):
                data_url = file_obj.get('dataUrl') if isinstance(file_obj, dict) else file_obj
                original_filename = file_obj.get('filename') if isinstance(file_obj, dict) else None
                file_type = file_obj.get('type', '') if isinstance(file_obj, dict) else ''
                path = upload_asset(data_url, index, original_filename)
                ext = original_filename.rsplit('.', 1)[-1].lower() if original_filename and '.' in original_filename else ''
                if ext in IMAGE_EXTENSIONS or file_type.startswith('image/'):
                    image_paths.append(path)
                else:
                    file_paths.append(path)

            attachments = {}
            if image_paths:
                attachments['images'] = image_paths
            if file_paths:
                attachments['files'] = file_paths
            if attachments:
                prompt_object['attachments'] = attachments

        payload = {
            "type": "UNIFY_CHAT_WITH_AI",
            "model": model,
            "conversationId": conversation_id,
            "promptObject": prompt_object
        }

        headers = {"Content-Type": "application/json", "API-KEY": API_KEY}

        def generate():
            try:
                stream_resp = requests.post(
                    CHAT_API_URL + "?isStreaming=true",
                    headers=headers,
                    json=payload,
                    stream=True,
                    timeout=120
                )
                for chunk in stream_resp.iter_content(chunk_size=None):
                    if chunk:
                        yield chunk
                yield b"data: [DONE]\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n".encode()

        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'}
        )

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
