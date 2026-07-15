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


def normalize_item(item):
    if not isinstance(item, dict):
        return None

    name = str(item.get('name') or item.get('product_name') or item.get('item_name') or '').strip()
    if not name:
        return None

    name = re.sub(r'\s+', ' ', name)
    name = re.sub(r'[^\w\s\(\)\-\/#&.,]', '', name)
    name = name[:100].strip()
    if len(name) < 2 or re.match(r'^\d+$', name):
        return None

    quantity_value = item.get('real_quantity', item.get('receipt_quantity', item.get('quantity', 1)))
    try:
        receipt_quantity = int(float(quantity_value))
    except Exception:
        receipt_quantity = 1
    if receipt_quantity < 1:
        receipt_quantity = 1

    price_value = item.get('price', item.get('unit_price', item.get('amount', 0)))
    try:
        price = round(float(price_value), 2)
    except Exception:
        price = 0.0

    normalized_item = {
        'name': name,
        'price': price,
        'receipt_quantity': receipt_quantity,
        'real_quantity': receipt_quantity,
        'comment': str(item.get('comment', '') or '').strip(),
        'accepted': bool(item.get('accepted', True)),
        'removed': bool(item.get('removed', False))
    }

    confidence = item.get('confidence')
    if confidence is not None:
        try:
            normalized_item['confidence'] = max(0.0, min(1.0, float(confidence)))
        except Exception:
            pass

    product_code = item.get('product_code')
    if product_code:
        normalized_item['product_code'] = str(product_code).strip()[:50]

    return normalized_item


def parse_receipt_response(text):
    """
    Parse the VLM response into a stable receipt payload.
    Prefers strict JSON, but falls back to the legacy line parser if needed.
    """
    payload = extract_json_payload(text)
    if isinstance(payload, dict) and isinstance(payload.get('items'), list):
        items = []
        for item in payload.get('items', []):
            normalized = normalize_item(item)
            if normalized:
                items.append(normalized)
        return {'items': items}

    if isinstance(payload, list):
        items = []
        for item in payload:
            normalized = normalize_item(item)
            if normalized:
                items.append(normalized)
        return {'items': items}

    if not text or not isinstance(text, str):
        return {'items': []}

    lines = text.strip().split('\n')
    items = []

    for line in lines:
        line = line.strip()
        if not line or len(line) < 3:
            continue

        # Skip obvious non-item lines
        if any(skip in line.lower() for skip in [
            'total', 'subtotal', 'tax', 'discount', 'amount due', 'thank',
            'items:', 'item name', 'table header', 'row', 'delivery'
        ]):
            continue

        # Look for Qty pattern (handles "Qty: 2" or "qty 2")
        qty_match = re.search(r'qty[:\s]+(\d+)', line, re.IGNORECASE)
        if not qty_match:
            continue

        receipt_quantity = int(qty_match.group(1))

        # Look for price AFTER the qty pattern
        after_qty = line[qty_match.end():]
        price_match = re.search(r'[₱$]?\s*(\d+(?:[,\.]?\d+)*(?:\.\d{2})?)', after_qty)
        if not price_match:
            continue

        price_str = price_match.group(1).replace(',', '')
        try:
            price = float(price_str)
        except ValueError:
            continue

        name = re.split(r'\s*[-–—]\s*|qty[:\s]+', line, flags=re.IGNORECASE)[0].strip()
        name = re.sub(r'[^\w\s\(\)-]', '', name)
        name = ' '.join(name.split())

        if name and len(name) > 2 and not re.match(r'^\d+$', name):
            items.append({
                'name': name[:100],
                'price': round(price, 2),
                'receipt_quantity': receipt_quantity,
                'real_quantity': receipt_quantity,
                'comment': '',
                'accepted': True,
                'removed': False
            })

    return {'items': items}



def get_env_model():
    return os.getenv('VISION_MODEL', 'nvidia/nemotron-nano-12b-v2-vl:free')


def get_api_key():
    """Get API key from environment or use hardcoded fallback"""
    api_key = os.getenv('OPENROUTER_API_KEY')
    if not api_key:
        # Hardcoded fallback (same as in openrouter.js)
        api_key = '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'
    return api_key


def image_to_text(image_path, api_key, model):
    # Read file bytes and build a data URL
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
                'content': 'You are a receipt extraction engine. Return ONLY valid JSON that matches the schema {"items":[{"name":"string","quantity":1,"price":0.0,"confidence":0.0}]}. Extract ONLY purchased items/products from receipts. Skip totals, taxes, headers, payment info, and store details. Do not add markdown, code fences, or extra text.'
            },
            {
                'role': 'user',
                'content': [
                    {
                        'type': 'text',
                        'text': '''Extract all purchased items from this receipt ONLY and return JSON only.

Use exactly this schema:
{"items":[{"name":"string","quantity":1,"price":0.0,"confidence":0.0}]}

Rules:
1. Extract ONLY product/item lines (things that were bought)
2. SKIP totals, subtotals, taxes, discounts, payment methods, customer info, store name, store address
3. For each item, include name, quantity, price, and confidence
4. If quantity is missing, use 1
5. If price is missing, use 0.0
6. confidence must be a number between 0 and 1
7. Do not include markdown, code fences, explanations, or extra keys

Example:
{"items":[{"name":"Item Name","quantity":2,"price":100.0,"confidence":0.92},{"name":"Another Product","quantity":1,"price":250.0,"confidence":0.87}]}'''
                    },
                    {
                        'type': 'image_url',
                        'image_url': {
                            'url': data_url
                        }
                    }
                ]
            }
        ],
        'temperature': 0.0,
        'max_tokens': 12000
    }

    url = 'https://openrouter.ai/api/v1/chat/completions'
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
    
    # Parse the LLM response flexibly
    parsed = parse_receipt_response(content)
    
    if not parsed or not parsed.get('items'):
        print('{}', file=sys.stderr)
        parsed = {'items': []}

    print(json.dumps(parsed, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python_ocr.py <image_file_path>', file=sys.stderr)
        sys.exit(1)

    api_key = get_api_key()
    model = get_env_model()
    try:
        image_to_text(sys.argv[1], api_key, model)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
