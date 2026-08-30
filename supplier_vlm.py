#!/usr/bin/env python3
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
import ssl


def extract_json_payload(text):
    if not text or not isinstance(text, str):
        return None

    normalized = text.strip()
    if not normalized:
        return None

    try:
        return json.loads(normalized)
    except Exception:
        match = re.search(r'\{[\s\S]*\}|\[[\s\S]*\]', normalized)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except Exception:
            return None


def parse_supplier_response(text):
    payload = extract_json_payload(text)
    if isinstance(payload, dict):
        if 'supplier' in payload or 'supplier_name' in payload or 'company' in payload:
            return payload
        if 'items' in payload and isinstance(payload['items'], list):
            return {'supplier': payload['items']}

    if isinstance(payload, list):
        return {'supplier': payload}

    if not text or not isinstance(text, str):
        return {'supplier': {}} 

    lines = text.strip().splitlines()
    supplier = {}
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        lower = stripped.lower()
        if 'supplier' in lower or 'company' in lower or 'vendor' in lower or 'name' in lower:
            supplier['raw_text'] = stripped
            break

    return {'supplier': supplier or {'raw_text': text.strip()}}


def get_env_model():
    model = os.getenv('VLM_MODEL') or os.getenv('VISION_MODEL')
    if not model:
        return 'openrouter/auto'
    return model.strip()


def get_api_endpoint():
    return os.getenv('OPENROUTER_API_ENDPOINT') or os.getenv('OPENROUTER_ENDPOINT') or 'https://openrouter.ai/api/v1/chat/completions'


def get_api_key():
    api_key = os.getenv('OPENROUTER_API_KEY')
    if not api_key:
        api_key = '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'
    return api_key


def image_to_supplier_details(image_path, api_key, model):
    try:
        with open(image_path, 'rb') as f:
            image_bytes = f.read()
    except Exception as exc:
        print(f'Error reading image file: {exc}', file=sys.stderr)
        sys.exit(1)

    mime_type = 'image/jpeg'
    ext = os.path.splitext(image_path)[1].lower()
    if ext in ['.png']:
        mime_type = 'image/png'
    elif ext in ['.gif']:
        mime_type = 'image/gif'
    elif ext in ['.webp']:
        mime_type = 'image/webp'

    data_url = f'data:{mime_type};base64,{base64.b64encode(image_bytes).decode("utf-8")}'

    payload = {
        'model': model,
        'messages': [
            {
                'role': 'system',
                'content': 'You are a supplier-details extraction engine. Read the receipt and return ONLY valid JSON describing the supplier/vendor details. Return a compact object with supplier information only; do not include item extraction. Prefer keys like supplier_name, contact_name, phone, email, address, tin, vat, website, and notes. If information is not present, leave the value as null or an empty string. Do not add markdown or commentary.'
            },
            {
                'role': 'user',
                'content': [
                    {
                        'type': 'text',
                        'text': 'Extract only supplier details from this receipt. Return JSON only, for example: {"supplier_name":"Acme Supply Co","contact_name":"John Doe","phone":"123-456-7890","email":"sales@acme.com","address":"123 Main St, Manila","tin":null,"vat":null,"website":null,"notes":""}'
                    },
                    {
                        'type': 'image_url',
                        'image_url': {'url': data_url}
                    }
                ]
            }
        ],
        'temperature': 0.0,
        'max_tokens': 256
    }

    url = get_api_endpoint()
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }

    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers,
        method='POST'
    )

    try:
        with urllib.request.urlopen(request, context=ssl_context, timeout=120) as response:
            raw = response.read().decode('utf-8')
            data = json.loads(raw)
    except urllib.error.HTTPError as http_err:
        err_body = http_err.read().decode('utf-8', errors='ignore')
        print(f'HTTP Error {http_err.code}: {err_body}', file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as url_err:
        print(f'Network Error: {url_err}', file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f'Unexpected error: {exc}', file=sys.stderr)
        sys.exit(1)

    choices = data.get('choices') or []
    if not choices:
        print('No choices returned from OpenRouter', file=sys.stderr)
        sys.exit(1)

    message = choices[0].get('message') or {}
    content = message.get('content') if message else data.get('choices', [])[0].get('text')

    parsed = parse_supplier_response(content)
    if not parsed:
        parsed = {'supplier': {}}

    print(json.dumps(parsed, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python supplier_vlm.py <image_file_path>', file=sys.stderr)
        sys.exit(1)

    api_key = get_api_key()
    model = get_env_model()
    try:
        image_to_supplier_details(sys.argv[1], api_key, model)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
