# BadNotes - Professional Note Taking Application
# Flask Backend with Real File Storage
#
# Optimizations Applied (2026-01-21):
# - Removed redundant imports
# - Added response caching headers for static assets
# - Improved error handling consistency

from flask import Flask, render_template, jsonify, request, send_file, send_from_directory, Response, stream_with_context
from functools import wraps
import os
import json
import uuid
import base64
import io
import time
import threading
import re
import shutil
import secrets
from datetime import datetime
from pathlib import Path

import requests as http_requests
import numpy as np
import cv2
from PIL import Image, ImageOps
from dotenv import load_dotenv
from timetable_feed import get_timetable

load_dotenv(os.environ.get('BADNOTES_CONFIG_FILE') or Path(__file__).parent / '.env', override=False)

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['MAX_CONTENT_LENGTH'] = 128 * 1024 * 1024


@app.before_request
def protect_local_backend():
    """Reject remote website access and authenticate packaged desktop requests."""
    if request.host.split(':', 1)[0] not in ('127.0.0.1', 'localhost'):
        return jsonify(error='BadNotes only accepts loopback hosts'), 403
    origin = request.headers.get('Origin')
    if origin and origin != request.host_url.rstrip('/'):
        return jsonify(error='Cross-origin access is not allowed'), 403
    if request.headers.get('Sec-Fetch-Site') == 'cross-site':
        return jsonify(error='Cross-site access is not allowed'), 403
    token = os.environ.get('BADNOTES_SESSION_TOKEN')
    supplied = request.cookies.get('badnotes-session') or request.headers.get('X-BadNotes-Token', '')
    if token and not secrets.compare_digest(token, supplied):
        return jsonify(error='Desktop session required'), 403
    for key in ('notebook_id', 'page_id', 'font_id', 'variant_id'):
        value = (request.view_args or {}).get(key)
        if value is not None and not re.fullmatch(r'[A-Za-z0-9_-]+', value):
            return jsonify(error='Invalid resource identifier'), 400


# ============== Configuration ==============

APP_DIR = Path(__file__).parent
DATA_DIR = Path(os.environ.get('BADNOTES_DATA_DIR', APP_DIR / 'data'))

NOTEBOOKS_DIR = DATA_DIR / 'notebooks'
IMAGES_DIR = DATA_DIR / 'images'
EXPORTS_DIR = DATA_DIR / 'exports'
BACKUPS_DIR = DATA_DIR / 'backups'
TRASH_NOTEBOOKS_DIR = DATA_DIR / 'trashed-notebooks'
TRASH_LOCK = threading.RLock()

# Ensure all directories exist
for directory in [DATA_DIR, NOTEBOOKS_DIR, IMAGES_DIR, EXPORTS_DIR, BACKUPS_DIR, TRASH_NOTEBOOKS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)


# ============== Response Helpers ==============

def json_response(data, status=200):
    """Consistent JSON response helper"""
    return jsonify(data), status

def error_response(message, status=400):
    """Consistent error response helper"""
    return jsonify({'error': message}), status


# ============== Phone Scan State ==============

SCAN_STATE_LOCK = threading.Lock()
SCAN_STATE = {
    'id': 0,
    'image_path': None,
    'data_url': None,
    'width': 0,
    'height': 0,
    'timestamp': None,
    'progress': 0,
}


# ============== Helper Functions ==============

def get_notebook_path(notebook_id):
    """Get the file path for a notebook JSON file"""
    return NOTEBOOKS_DIR / f"{notebook_id}.json"

def get_page_path(notebook_id, page_id):
    """Get the file path for a page JSON file"""
    notebook_dir = NOTEBOOKS_DIR / notebook_id
    notebook_dir.mkdir(exist_ok=True)
    return notebook_dir / f"{page_id}.json"

def generate_id():
    """Generate a short unique ID"""
    return str(uuid.uuid4())[:8]


# ============== Document Scan Helpers ==============

def _order_points(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def _four_point_transform(image, pts):
    rect = _order_points(pts)
    (tl, tr, br, bl) = rect

    widthA = np.linalg.norm(br - bl)
    widthB = np.linalg.norm(tr - tl)
    maxWidth = int(max(widthA, widthB))

    heightA = np.linalg.norm(tr - br)
    heightB = np.linalg.norm(tl - bl)
    maxHeight = int(max(heightA, heightB))

    dst = np.array([
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]
    ], dtype="float32")

    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, M, (maxWidth, maxHeight))
    return warped

def _decode_image(file_bytes):
    pil = Image.open(io.BytesIO(file_bytes))
    pil = ImageOps.exif_transpose(pil).convert("RGB")
    image = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    return image

def _find_document_contour(image):
    """
    Find document contour - only returns a contour if it's large enough
    to be the actual paper (>40% of image area) and has 4 corners.
    This prevents cropping to small boxes/squares drawn ON the paper.
    """
    orig = image.copy()
    h, w = orig.shape[:2]
    image_area = h * w
    min_area_ratio = 0.40  # Contour must be at least 40% of image

    target_height = 800
    ratio = orig.shape[0] / float(target_height)
    resized = cv2.resize(orig, (int(orig.shape[1] / ratio), target_height))
    resized_h, resized_w = resized.shape[:2]
    resized_area = resized_h * resized_w

    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    # Try multiple edge detection approaches
    best_contour = None
    best_area = 0

    # Method 1: Canny edges
    for thresh_low, thresh_high in [(30, 100), (50, 150), (75, 200)]:
        edged = cv2.Canny(gray, thresh_low, thresh_high)
        # Dilate to close gaps in edges
        kernel = np.ones((3, 3), np.uint8)
        edged = cv2.dilate(edged, kernel, iterations=1)

        cnts = cv2.findContours(edged.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnts = cnts[0] if len(cnts) == 2 else cnts[1]

        for c in cnts:
            area = cv2.contourArea(c)
            # Skip if too small (not the paper)
            if area < resized_area * min_area_ratio:
                continue

            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)

            if len(approx) == 4 and area > best_area:
                best_contour = approx
                best_area = area

    # Method 2: Adaptive threshold (helps with uneven lighting)
    if best_contour is None:
        thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                        cv2.THRESH_BINARY, 11, 2)
        thresh = cv2.bitwise_not(thresh)
        kernel = np.ones((5, 5), np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

        cnts = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnts = cnts[0] if len(cnts) == 2 else cnts[1]

        for c in cnts:
            area = cv2.contourArea(c)
            if area < resized_area * min_area_ratio:
                continue

            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)

            if len(approx) == 4 and area > best_area:
                best_contour = approx
                best_area = area

    if best_contour is not None:
        return best_contour.reshape(4, 2) * ratio

    return None

def _white_balance_gray_world(image):
    result = image.astype(np.float32)
    avg_b = np.mean(result[:, :, 0])
    avg_g = np.mean(result[:, :, 1])
    avg_r = np.mean(result[:, :, 2])
    avg = (avg_b + avg_g + avg_r) / 3.0
    result[:, :, 0] *= (avg / (avg_b + 1e-6))
    result[:, :, 1] *= (avg / (avg_g + 1e-6))
    result[:, :, 2] *= (avg / (avg_r + 1e-6))
    return np.clip(result, 0, 255).astype(np.uint8)

def _grade_document(image, mode='auto'):
    """
    Apply document enhancement based on mode:
    - 'original': No processing
    - 'auto': Auto white balance + CLAHE + sharpen (default)
    - 'bw': High contrast black & white document
    - 'color': Enhanced color document
    - 'magic': CamScanner-style aggressive enhancement
    """
    if mode == 'original':
        return image

    if mode == 'bw':
        # Smart invert: Keep dark text dark, make light backgrounds pure white
        # This preserves the readability of handwriting/text while cleaning background
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Apply CLAHE to enhance contrast first
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        # Compute local mean to detect background vs foreground
        blur_size = 51  # Large blur to get background estimate
        background = cv2.GaussianBlur(enhanced, (blur_size, blur_size), 0)

        # Smart invert: pixels darker than local background stay dark, light pixels go white
        # Normalize relative to local background
        diff = background.astype(np.float32) - enhanced.astype(np.float32)

        # Scale the difference to create contrast
        # Positive diff = darker than background (text) -> keep dark
        # Negative diff = lighter than background -> make white
        result = np.clip(255 - diff * 2.5, 0, 255).astype(np.uint8)

        # Additional threshold to clean up - anything above 220 becomes pure white
        result[result > 220] = 255

        # Anything very dark stays dark (text preservation)
        dark_mask = enhanced < 100
        result[dark_mask] = np.clip(enhanced[dark_mask] * 0.8, 0, 80).astype(np.uint8)

        return cv2.cvtColor(result, cv2.COLOR_GRAY2BGR)

    if mode == 'magic':
        # CamScanner-style aggressive enhancement
        # 1. White balance
        balanced = _white_balance_gray_world(image)

        # 2. Convert to LAB and enhance L channel aggressively
        lab = cv2.cvtColor(balanced, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)

        # Strong CLAHE for contrast
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        cl = clahe.apply(l)

        # 3. Background whitening - make light areas whiter
        # Stretch histogram to push lights toward white
        cl = cv2.normalize(cl, None, 0, 255, cv2.NORM_MINMAX)

        limg = cv2.merge((cl, a, b))
        enhanced = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)

        # 4. Strong sharpening
        blurred = cv2.GaussianBlur(enhanced, (0, 0), 2)
        sharpened = cv2.addWeighted(enhanced, 1.5, blurred, -0.5, 0)

        # 5. Slight saturation boost
        hsv = cv2.cvtColor(sharpened, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:, :, 1] *= 1.2
        hsv[:, :, 1] = np.clip(hsv[:, :, 1], 0, 255)
        result = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

        return result

    if mode == 'color':
        # Enhanced color - boost saturation and contrast
        balanced = _white_balance_gray_world(image)

        # LAB enhancement
        lab = cv2.cvtColor(balanced, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        cl = clahe.apply(l)
        limg = cv2.merge((cl, a, b))
        enhanced = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)

        # Saturation boost
        hsv = cv2.cvtColor(enhanced, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:, :, 1] *= 1.3
        hsv[:, :, 1] = np.clip(hsv[:, :, 1], 0, 255)
        result = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

        # Light sharpen
        blurred = cv2.GaussianBlur(result, (0, 0), 1)
        sharpened = cv2.addWeighted(result, 1.2, blurred, -0.2, 0)

        return sharpened

    # Default 'auto' mode
    balanced = _white_balance_gray_world(image)
    lab = cv2.cvtColor(balanced, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l)
    limg = cv2.merge((cl, a, b))
    graded = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
    blurred = cv2.GaussianBlur(graded, (0, 0), 1.5)
    sharpened = cv2.addWeighted(graded, 1.35, blurred, -0.35, 0)
    return sharpened

def _scan_document(image, mode='auto'):
    """
    Scan document - detects paper edges and applies enhancement.
    If mode is 'nocrop', 'original', or starts with 'nocrop_', skips edge detection.
    """
    # Check for modes that skip all processing
    if mode == 'nocrop' or mode == 'original':
        return image  # No processing at all

    if mode.startswith('nocrop_'):
        # nocrop_auto, nocrop_magic, etc - apply enhancement but no cropping
        actual_mode = mode[7:]  # Remove 'nocrop_' prefix
        return _grade_document(image, actual_mode)

    # Normal mode - try to detect document edges
    contour = _find_document_contour(image)
    if contour is not None:
        warped = _four_point_transform(image, contour)
    else:
        warped = image
    return _grade_document(warped, mode)


# ============== Routes ==============

@app.route('/api/health')
def health():
    return jsonify(status='ok')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/scan')
def scan():
    return render_template('scan.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory(APP_DIR / 'static', filename)

@app.route('/assets/<path:filename>')
def serve_assets(filename):
    return send_from_directory(APP_DIR / 'static' / 'assets', filename)

@app.route('/tests/<path:filename>')
def serve_tests(filename):
    return send_from_directory(APP_DIR / 'tests', filename)

@app.route('/data/images/<path:filename>')
def serve_scanned_images(filename):
    return send_from_directory(IMAGES_DIR, filename)


# ============== PDF Import API ==============




# ============== Phone Scan API ==============

@app.route('/api/scan/preview', methods=['POST'])
def preview_scan():
    """Process image and return preview without saving - for phone to verify crop/enhancement"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    mode = request.form.get('mode', 'auto')

    try:
        raw = file.read()
        image = _decode_image(raw)
        scanned = _scan_document(image, mode)

        height, width = scanned.shape[:2]

        # Encode as JPEG for faster transfer (preview quality)
        success, encoded = cv2.imencode('.jpg', scanned, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not success:
            return jsonify({'error': 'Failed to encode preview'}), 500

        img_bytes = encoded.tobytes()
        img_base64 = base64.b64encode(img_bytes).decode('utf-8')
        preview_url = f'data:image/jpeg;base64,{img_base64}'

        return jsonify({
            'success': True,
            'previewUrl': preview_url,
            'width': width,
            'height': height
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/scan/start', methods=['POST'])
def start_scan():
    """Phone notifies desktop that an upload is starting with dimensions"""
    try:
        data = request.get_json() or {}
        width = data.get('width', 800)
        height = data.get('height', 600)

        with SCAN_STATE_LOCK:
            SCAN_STATE['id'] += 1
            SCAN_STATE['pending'] = True
            SCAN_STATE['width'] = width
            SCAN_STATE['height'] = height
            SCAN_STATE['data_url'] = None  # Not yet uploaded
            SCAN_STATE['timestamp'] = datetime.now().isoformat()
            SCAN_STATE['progress'] = 0  # Reset progress
            scan_id = SCAN_STATE['id']

        return jsonify({
            'success': True,
            'id': scan_id
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/scan/progress', methods=['POST'])
def update_scan_progress():
    """Phone reports upload progress to be shown on desktop"""
    try:
        data = request.get_json() or {}
        progress = data.get('progress', 0)

        with SCAN_STATE_LOCK:
            SCAN_STATE['progress'] = min(100, max(0, progress))

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/scan/upload', methods=['POST'])
def upload_scan():
    """Upload raw image from phone, save immediately, then process"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    # Get enhancement mode from form data
    mode = request.form.get('mode', 'auto')
    scan_id = request.form.get('scan_id')  # Optional: link to started scan

    try:
        raw = file.read()

        # Step 1: Save raw file immediately (fast response to phone)
        is_png = raw[:8] == b'\x89PNG\r\n\x1a\n'
        is_jpeg = raw[:2] == b'\xff\xd8'

        # Determine extension and get dimensions
        if is_png:
            ext = 'png'
            width = int.from_bytes(raw[16:20], 'big')
            height = int.from_bytes(raw[20:24], 'big')
        elif is_jpeg:
            ext = 'jpg'
            # Need to decode for JPEG dimensions
            img = _decode_image(raw)
            height, width = img.shape[:2]
        else:
            # Unknown format, decode to get info
            img = _decode_image(raw)
            height, width = img.shape[:2]
            ext = 'jpg'

        # Generate filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")

        # For 'original' mode: save raw bytes directly
        if mode == 'original':
            filename = f'scan_{timestamp}.{ext}'
            file_path = IMAGES_DIR / filename
            with open(file_path, 'wb') as f:
                f.write(raw)
        else:
            # Decode if not already decoded
            if 'img' not in locals():
                img = _decode_image(raw)
                height, width = img.shape[:2]

            # For 'nocrop': save as high quality JPEG without processing
            if mode == 'nocrop':
                filename = f'scan_{timestamp}.jpg'
                file_path = IMAGES_DIR / filename
                success, encoded = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 95])
                if success:
                    with open(file_path, 'wb') as f:
                        f.write(encoded.tobytes())
            else:
                # 'bw' or 'auto': Process the image
                # Update state to show "Processing..." on desktop
                with SCAN_STATE_LOCK:
                    if not scan_id:
                        SCAN_STATE['id'] += 1
                    SCAN_STATE['pending'] = True
                    SCAN_STATE['width'] = width
                    SCAN_STATE['height'] = height
                    SCAN_STATE['progress'] = 100  # Upload complete, processing now
                    SCAN_STATE['timestamp'] = datetime.now().isoformat()

                # Process the image
                scanned = _scan_document(img, mode)
                height, width = scanned.shape[:2]

                filename = f'scan_{timestamp}.jpg'
                file_path = IMAGES_DIR / filename
                success, encoded = cv2.imencode('.jpg', scanned, [cv2.IMWRITE_JPEG_QUALITY, 95])
                if success:
                    with open(file_path, 'wb') as f:
                        f.write(encoded.tobytes())

        # Update final state
        with SCAN_STATE_LOCK:
            if not scan_id:
                if SCAN_STATE.get('pending') != True:  # Don't increment again if already did
                    SCAN_STATE['id'] += 1
            SCAN_STATE['pending'] = False
            SCAN_STATE['image_path'] = str(file_path)
            SCAN_STATE['width'] = width
            SCAN_STATE['height'] = height
            SCAN_STATE['timestamp'] = datetime.now().isoformat()
            SCAN_STATE['progress'] = 100
            final_scan_id = SCAN_STATE['id']

        return jsonify({
            'success': True,
            'id': final_scan_id,
            'width': width,
            'height': height
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/scan/status', methods=['GET'])
def get_scan_status():
    """Get current scan state including pending scans (for polling fallback)"""
    with SCAN_STATE_LOCK:
        if SCAN_STATE['id'] == 0:
            return jsonify({'id': 0, 'pending': False, 'ready': False})
        return jsonify({
            'id': SCAN_STATE['id'],
            'pending': SCAN_STATE.get('pending', False),
            'ready': SCAN_STATE.get('image_path') is not None and not SCAN_STATE.get('pending', False),
            'width': SCAN_STATE.get('width', 0),
            'height': SCAN_STATE.get('height', 0),
            'progress': SCAN_STATE.get('progress', 0)
        })


@app.route('/api/scan/latest', methods=['GET'])
def get_latest_scan():
    with SCAN_STATE_LOCK:
        if SCAN_STATE['id'] == 0 or not SCAN_STATE.get('image_path'):
            return jsonify({'error': 'No scan available'}), 404
        # Return URL path for desktop to load image directly
        image_path = SCAN_STATE['image_path']
        filename = Path(image_path).name
        return jsonify({
            'id': SCAN_STATE['id'],
            'imageUrl': f'/data/images/{filename}',  # Desktop loads via HTTP
            'width': SCAN_STATE['width'],
            'height': SCAN_STATE['height'],
            'timestamp': SCAN_STATE['timestamp']
        })


@app.route('/api/scan/stream')
def scan_stream():
    def event_stream():
        last_id = 0
        last_pending = False
        last_progress = 0
        while True:
            with SCAN_STATE_LOCK:
                current_id = SCAN_STATE['id']
                current_width = SCAN_STATE.get('width', 0)
                current_height = SCAN_STATE.get('height', 0)
                is_pending = SCAN_STATE.get('pending', False)
                has_data = SCAN_STATE.get('image_path') is not None
                progress = SCAN_STATE.get('progress', 0)

            # Send event if id changed, pending status changed, or progress changed
            if current_id and (current_id != last_id or is_pending != last_pending or progress != last_progress):
                payload = json.dumps({
                    'id': current_id,
                    'width': current_width,
                    'height': current_height,
                    'pending': is_pending,
                    'ready': has_data and not is_pending,
                    'progress': progress
                })
                yield f"event: scan\ndata: {payload}\n\n"
                last_id = current_id
                last_pending = is_pending
                last_progress = progress
            time.sleep(0.3)  # Check more frequently for progress updates

    headers = {
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
    }
    return Response(stream_with_context(event_stream()), headers=headers, mimetype='text/event-stream')


# ============== Notebook API ==============

@app.route('/api/notebooks', methods=['GET'])
def get_notebooks():
    """Get all notebooks"""
    notebooks = []

    for file in NOTEBOOKS_DIR.glob('*.json'):
        try:
            with open(file, 'r') as f:
                notebook = json.load(f)
                notebooks.append(notebook)
        except:
            pass

    # Check for custom order file
    order_file = DATA_DIR / 'notebook_order.json'
    if order_file.exists():
        try:
            with open(order_file, 'r') as f:
                order_data = json.load(f)
                order = order_data.get('order', [])

            # Sort by custom order - notebooks not in list go to the beginning (index -1)
            order_map = {id: i for i, id in enumerate(order)}
            notebooks.sort(key=lambda x: order_map.get(x.get('id'), -1))
        except:
            # Fallback to date sorting
            notebooks.sort(key=lambda x: x.get('modifiedAt', ''), reverse=True)
    else:
        # Sort by modified date
        notebooks.sort(key=lambda x: x.get('modifiedAt', ''), reverse=True)

    return jsonify(notebooks)


@app.route('/api/notebooks', methods=['POST'])
def create_notebook():
    """Create a new notebook (regular or font book)"""
    data = request.json

    notebook = {
        'id': generate_id(),
        'name': data.get('name', 'Untitled Notebook'),
        'color': data.get('color', '#6c5ce7'),
        'icon': data.get('icon', 'book'),
        'template': data.get('template', 'blank'),
        'createdAt': datetime.now().isoformat(),
        'modifiedAt': datetime.now().isoformat(),
        'pages': []
    }

    # Support font book notebooks
    if data.get('isFontBook'):
        notebook['isFontBook'] = True
        notebook['fontBookId'] = data.get('fontBookId')

    # Only create first page for regular notebooks
    # Font books will create their own pages with character assignments
    if not data.get('isFontBook'):
        page = create_new_page(notebook['id'], notebook['template'])
        notebook['pages'].append(page['id'])
    else:
        page = None

    # Save notebook
    with open(get_notebook_path(notebook['id']), 'w') as f:
        json.dump(notebook, f, indent=2)

    return jsonify({'notebook': notebook, 'page': page})


@app.route('/api/notebooks/<notebook_id>', methods=['GET'])
def get_notebook(notebook_id):
    """Get a specific notebook with all its pages"""
    notebook_path = get_notebook_path(notebook_id)

    if not notebook_path.exists():
        return jsonify({'error': 'Notebook not found'}), 404

    try:
        with open(notebook_path, 'r', encoding='utf-8') as f:
            notebook = json.load(f)
    except json.JSONDecodeError:
        return jsonify({'error': 'Notebook data corrupted'}), 500

    # Load all pages
    pages = []
    notebook_dir = NOTEBOOKS_DIR / notebook_id

    for page_id in notebook.get('pages', []):
        page_path = notebook_dir / f"{page_id}.json"
        if page_path.exists():
            try:
                with open(page_path, 'r', encoding='utf-8') as f:
                    pages.append(json.load(f))
            except json.JSONDecodeError:
                # Skip corrupted pages, create a fresh one
                fresh_page = create_new_page(notebook_id, notebook.get('template', 'blank'))
                fresh_page['id'] = page_id
                pages.append(fresh_page)

    return jsonify({'notebook': notebook, 'pages': pages})


@app.route('/api/notebooks/<notebook_id>', methods=['PUT'])
def update_notebook(notebook_id):
    """Update notebook metadata"""
    notebook_path = get_notebook_path(notebook_id)

    if not notebook_path.exists():
        return jsonify({'error': 'Notebook not found'}), 404

    with open(notebook_path, 'r') as f:
        notebook = json.load(f)

    data = request.json
    notebook['name'] = data.get('name', notebook['name'])
    notebook['color'] = data.get('color', notebook['color'])
    notebook['icon'] = data.get('icon', notebook.get('icon', 'book'))
    notebook['pages'] = data.get('pages', notebook.get('pages', []))
    notebook['trash'] = data.get('trash', notebook.get('trash', []))
    notebook['contentTrash'] = data.get('contentTrash', notebook.get('contentTrash', []))
    notebook['modifiedAt'] = datetime.now().isoformat()

    with open(notebook_path, 'w') as f:
        json.dump(notebook, f, indent=2)

    return jsonify(notebook)


def valid_trash_id(value):
    return bool(re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value))


@app.route('/api/trash/notebooks', methods=['GET'])
def list_trashed_notebooks():
    entries = []
    with TRASH_LOCK:
        for folder in TRASH_NOTEBOOKS_DIR.iterdir():
            if not folder.is_dir() or not valid_trash_id(folder.name):
                continue
            try:
                metadata = json.loads((folder / 'notebook.json').read_text(encoding='utf-8'))
                info = json.loads((folder / 'trash.json').read_text(encoding='utf-8'))
                entries.append({**metadata, **info})
            except (OSError, ValueError):
                continue
    return jsonify(sorted(entries, key=lambda entry: entry['deletedAt'], reverse=True))


@app.route('/api/notebooks/<notebook_id>/trash', methods=['POST'])
def trash_notebook(notebook_id):
    """Move metadata and ALL page files together; never recreate an empty book."""
    if not valid_trash_id(notebook_id):
        return error_response('Invalid notebook ID')
    with TRASH_LOCK:
        source = get_notebook_path(notebook_id)
        source_pages = NOTEBOOKS_DIR / notebook_id
        target = TRASH_NOTEBOOKS_DIR / notebook_id
        if not source.exists():
            return error_response('Notebook not found', 404)
        notebook = json.loads(source.read_text(encoding='utf-8'))
        if notebook.get('isFontBook'):
            return error_response('Cannot delete Fontbook', 403)
        if target.exists():
            return error_response('Notebook already exists in trash', 409)
        target.mkdir()
        try:
            (target / 'trash.json').write_text(json.dumps({
                'deletedAt': datetime.now().isoformat(),
                'originalIndex': (request.get_json(silent=True) or {}).get('originalIndex', 0)
            }), encoding='utf-8')
            if source_pages.exists():
                source_pages.rename(target / 'pages')
            source.rename(target / 'notebook.json')
        except OSError:
            if (target / 'pages').exists():
                (target / 'pages').rename(source_pages)
            if (target / 'notebook.json').exists():
                (target / 'notebook.json').rename(source)
            shutil.rmtree(target)
            raise
    return jsonify({'success': True, 'id': notebook_id})


@app.route('/api/trash/notebooks/<notebook_id>/restore', methods=['POST'])
def restore_trashed_notebook(notebook_id):
    if not valid_trash_id(notebook_id):
        return error_response('Invalid notebook ID')
    with TRASH_LOCK:
        source = TRASH_NOTEBOOKS_DIR / notebook_id
        target = get_notebook_path(notebook_id)
        target_pages = NOTEBOOKS_DIR / notebook_id
        if not (source / 'notebook.json').exists():
            return error_response('Trashed notebook not found', 404)
        if target.exists() or target_pages.exists():
            return error_response('An active notebook already uses this ID', 409)
        info = json.loads((source / 'trash.json').read_text(encoding='utf-8'))
        try:
            if (source / 'pages').exists():
                (source / 'pages').rename(target_pages)
            (source / 'notebook.json').rename(target)
        except OSError:
            if target_pages.exists():
                target_pages.rename(source / 'pages')
            raise
        shutil.rmtree(source)
        order_path = DATA_DIR / 'notebook_order.json'
        if order_path.exists():
            order = json.loads(order_path.read_text(encoding='utf-8')).get('order', [])
            order = [item for item in order if item != notebook_id]
            order.insert(max(0, min(len(order), int(info.get('originalIndex', 0)))), notebook_id)
            order_path.write_text(json.dumps({'order': order}), encoding='utf-8')
    return jsonify({'success': True, 'id': notebook_id})


@app.route('/api/trash/notebooks/<notebook_id>', methods=['DELETE'])
def permanently_delete_trashed_notebook(notebook_id):
    if not valid_trash_id(notebook_id):
        return error_response('Invalid notebook ID')
    with TRASH_LOCK:
        target = TRASH_NOTEBOOKS_DIR / notebook_id
        if not (target / 'notebook.json').exists():
            return error_response('Trashed notebook not found', 404)
        shutil.rmtree(target)
    return jsonify({'success': True})


@app.route('/api/notebooks/<notebook_id>', methods=['DELETE'])
def delete_notebook(notebook_id):
    """Delete a notebook and all its pages"""
    notebook_path = get_notebook_path(notebook_id)
    notebook_dir = NOTEBOOKS_DIR / notebook_id

    # Protect Fontbook from deletion
    if notebook_path.exists():
        try:
            with open(notebook_path, 'r') as f:
                nb_data = json.load(f)
                if nb_data.get('isFontBook'):
                    return jsonify({'error': 'Cannot delete Fontbook'}), 403
        except:
            pass

    # Delete notebook file
    if notebook_path.exists():
        notebook_path.unlink()

    # Delete pages directory
    if notebook_dir.exists():
        import shutil
        shutil.rmtree(notebook_dir)

    return jsonify({'success': True})


@app.route('/api/notebooks/order', methods=['PUT'])
def update_notebook_order():
    """Update the order of notebooks"""
    data = request.json
    order = data.get('order', [])

    if not order:
        return jsonify({'error': 'No order provided'}), 400

    # Save order to a special file
    order_file = DATA_DIR / 'notebook_order.json'
    with open(order_file, 'w') as f:
        json.dump({'order': order}, f, indent=2)

    return jsonify({'success': True})


# ============== Page API ==============

def create_new_page(notebook_id, template='blank', font_char=None, font_book_id=None,
                    is_font_atlas=False, font_id=None, font_name=None):
    """Create a new page, optionally for font training"""
    page = {
        'id': generate_id(),
        'notebookId': notebook_id,
        'width': 800,
        'height': 1100,
        'template': template,
        'backgroundColor': '#1a1a2e',
        'strokes': [],
        'shapes': [],
        'textElements': [],
        'textFields': [],
        'handwrittenTextFields': [],
        'images': [],
        'createdAt': datetime.now().isoformat(),
        'modifiedAt': datetime.now().isoformat()
    }

    # Add font book properties if this is a font training page
    if font_char is not None:
        page['fontChar'] = font_char
    if font_book_id is not None:
        page['fontBookId'] = font_book_id

    # Add font atlas properties
    if is_font_atlas:
        page['isFontAtlas'] = True
    if font_id is not None:
        page['fontId'] = font_id
    if font_name is not None:
        page['fontName'] = font_name

    # Save page
    page_path = get_page_path(notebook_id, page['id'])
    with open(page_path, 'w') as f:
        json.dump(page, f, indent=2)

    return page


@app.route('/api/notebooks/<notebook_id>/pages', methods=['POST'])
def add_page(notebook_id):
    """Add a new page to notebook"""
    try:
        notebook_path = get_notebook_path(notebook_id)

        if not notebook_path.exists():
            return jsonify({'error': 'Notebook not found'}), 404

        with open(notebook_path, 'r') as f:
            notebook = json.load(f)

        data = request.json or {}
        template = data.get('template', notebook.get('template', 'blank'))
        font_char = data.get('fontChar')
        font_book_id = data.get('fontBookId')
        is_font_atlas = data.get('isFontAtlas', False)
        font_id = data.get('fontId')
        font_name = data.get('fontName')

        page = create_new_page(notebook_id, template, font_char, font_book_id,
                               is_font_atlas, font_id, font_name)

        # Add to notebook
        insert_index = data.get('insertIndex', len(notebook['pages']))
        notebook['pages'].insert(insert_index, page['id'])
        notebook['modifiedAt'] = datetime.now().isoformat()

        with open(notebook_path, 'w') as f:
            json.dump(notebook, f, indent=2)

        return jsonify(page)
    except Exception as e:
        print(f'Error creating page: {e}')
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/notebooks/<notebook_id>/pages/<page_id>', methods=['GET'])
def get_page(notebook_id, page_id):
    """Get a specific page"""
    page_path = get_page_path(notebook_id, page_id)

    if not page_path.exists():
        # Auto-create missing page instead of 404
        notebook_path = get_notebook_path(notebook_id)
        template = 'blank'
        if notebook_path.exists():
            try:
                with open(notebook_path, 'r') as f:
                    notebook = json.load(f)
                    template = notebook.get('template', 'blank')
            except:
                pass

        page = {
            'id': page_id,
            'notebookId': notebook_id,
            'width': 800,
            'height': 1100,
            'template': template,
            'backgroundColor': '#1a1a2e',
            'strokes': [],
            'shapes': [],
            'textElements': [],
            'textFields': [],
            'handwrittenTextFields': [],
            'images': [],
            'createdAt': datetime.now().isoformat(),
            'modifiedAt': datetime.now().isoformat()
        }

        # Save the new page
        try:
            with open(page_path, 'w') as f:
                json.dump(page, f, indent=2)
        except Exception as e:
            return jsonify({'error': str(e)}), 500

        return jsonify(page)

    try:
        with open(page_path, 'r', encoding='utf-8') as f:
            page = json.load(f)
        return jsonify(page)
    except json.JSONDecodeError:
        return jsonify({'error': 'Page data corrupted'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/notebooks/<notebook_id>/pages/<page_id>', methods=['PUT'])
def save_page(notebook_id, page_id):
    """Save page data (strokes, shapes, etc.)"""
    try:
        page_path = get_page_path(notebook_id, page_id)

        data = request.json
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        # Load existing or create new
        if page_path.exists():
            try:
                with open(page_path, 'r', encoding='utf-8') as f:
                    page = json.load(f)
            except json.JSONDecodeError:
                # If corrupted, start fresh
                page = {
                    'id': page_id,
                    'notebookId': notebook_id,
                    'createdAt': datetime.now().isoformat()
                }
        else:
            page = {
                'id': page_id,
                'notebookId': notebook_id,
                'width': data.get('width', 800),
                'height': data.get('height', 1100),
                'template': data.get('template', 'blank'),
                'backgroundColor': data.get('backgroundColor', '#1a1a2e'),
                'createdAt': datetime.now().isoformat()
            }

        # Update page data - preserve all fields from request
        page['strokes'] = data.get('strokes', page.get('strokes', []))
        page['shapes'] = data.get('shapes', page.get('shapes', []))
        page['textElements'] = data.get('textElements', page.get('textElements', []))
        page['textFields'] = data.get('textFields', page.get('textFields', []))
        page['handwrittenTextFields'] = data.get('handwrittenTextFields', page.get('handwrittenTextFields', []))
        page['images'] = data.get('images', page.get('images', []))
        page['width'] = data.get('width', page.get('width', 800))
        page['height'] = data.get('height', page.get('height', 1100))
        page['template'] = data.get('template', page.get('template', 'blank'))
        page['gridShiftX'] = data.get('gridShiftX', page.get('gridShiftX', 0))
        page['gridShiftY'] = data.get('gridShiftY', page.get('gridShiftY', 0))
        page['modifiedAt'] = datetime.now().isoformat()

        # Save
        with open(page_path, 'w', encoding='utf-8') as f:
            json.dump(page, f, indent=2)

        # Update notebook modified time
        notebook_path = get_notebook_path(notebook_id)
        if notebook_path.exists():
            try:
                with open(notebook_path, 'r', encoding='utf-8') as f:
                    notebook = json.load(f)
                notebook['modifiedAt'] = datetime.now().isoformat()
                with open(notebook_path, 'w', encoding='utf-8') as f:
                    json.dump(notebook, f, indent=2)
            except:
                pass  # Non-critical error

        return jsonify({'success': True, 'page': page})
    except Exception as e:
        print(f"Error saving page: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/notebooks/<notebook_id>/pages/<page_id>', methods=['DELETE'])
def delete_page(notebook_id, page_id):
    """Delete a page"""
    # Remove from notebook
    notebook_path = get_notebook_path(notebook_id)
    if notebook_path.exists():
        with open(notebook_path, 'r') as f:
            notebook = json.load(f)

        if page_id in notebook['pages']:
            notebook['pages'].remove(page_id)
            notebook['modifiedAt'] = datetime.now().isoformat()

            with open(notebook_path, 'w') as f:
                json.dump(notebook, f, indent=2)

    # Delete page file
    page_path = get_page_path(notebook_id, page_id)
    if page_path.exists():
        page_path.unlink()

    return jsonify({'success': True})


# ============== Image API ==============

@app.route('/api/images', methods=['POST'])
def upload_image():
    """Upload an image"""
    data = request.json
    image_data = data.get('data')  # Base64 encoded

    if not image_data:
        return jsonify({'error': 'No image data'}), 400

    image_id = generate_id()

    # Save base64 data
    image_path = IMAGES_DIR / f"{image_id}.txt"
    with open(image_path, 'w') as f:
        f.write(image_data)

    return jsonify({'id': image_id, 'url': f'/api/images/{image_id}'})


@app.route('/api/images/<image_id>', methods=['GET'])
def get_image(image_id):
    """Get an image"""
    image_path = IMAGES_DIR / f"{image_id}.txt"

    if not image_path.exists():
        return jsonify({'error': 'Image not found'}), 404

    with open(image_path, 'r') as f:
        data = f.read()

    return jsonify({'data': data})


# ============== Settings API ==============

@app.route('/api/settings', methods=['GET'])
def get_settings():
    """Get app settings"""
    settings_path = DATA_DIR / 'settings.json'

    if settings_path.exists():
        with open(settings_path, 'r') as f:
            return jsonify(json.load(f))

    # Default settings
    return jsonify({
        'theme': 'dark',
        'autoSave': True,
        'autoSaveInterval': 30,
        'pressureEnabled': True,
        'pressureCurve': 'linear',
        'strokeSmoothing': 5
    })


@app.route('/api/settings', methods=['PUT'])
def save_settings():
    """Save app settings"""
    settings_path = DATA_DIR / 'settings.json'

    with open(settings_path, 'w') as f:
        json.dump(request.json, f, indent=2)

    return jsonify({'success': True})


# ============== Export API ==============

@app.route('/api/export/<notebook_id>', methods=['POST'])
def export_notebook(notebook_id):
    """Export notebook"""
    data = request.json
    format_type = data.get('format', 'json')

    notebook_path = get_notebook_path(notebook_id)
    if not notebook_path.exists():
        return jsonify({'error': 'Notebook not found'}), 404

    with open(notebook_path, 'r') as f:
        notebook = json.load(f)

    # Load all pages
    pages = []
    notebook_dir = NOTEBOOKS_DIR / notebook_id
    for page_id in notebook.get('pages', []):
        page_path = notebook_dir / f"{page_id}.json"
        if page_path.exists():
            with open(page_path, 'r') as f:
                pages.append(json.load(f))

    if format_type == 'json':
        export_data = {
            'notebook': notebook,
            'pages': pages,
            'exportedAt': datetime.now().isoformat()
        }

        export_path = EXPORTS_DIR / f"{notebook['name']}_{notebook_id}.json"
        with open(export_path, 'w') as f:
            json.dump(export_data, f, indent=2)

        return send_file(export_path, as_attachment=True)

    return jsonify({'error': 'Format not supported'}), 400


@app.route('/api/import', methods=['POST'])
def import_notebook():
    """Import a notebook from JSON"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    data = json.load(file)

    notebook = data.get('notebook')
    pages = data.get('pages', [])

    # Generate new IDs
    old_to_new_page_ids = {}
    notebook['id'] = generate_id()

    for page in pages:
        old_id = page['id']
        page['id'] = generate_id()
        page['notebookId'] = notebook['id']
        old_to_new_page_ids[old_id] = page['id']

    notebook['pages'] = [old_to_new_page_ids.get(p, p) for p in notebook['pages']]
    notebook['createdAt'] = datetime.now().isoformat()
    notebook['modifiedAt'] = datetime.now().isoformat()

    # Save notebook
    with open(get_notebook_path(notebook['id']), 'w') as f:
        json.dump(notebook, f, indent=2)

    # Save pages
    for page in pages:
        page_path = get_page_path(notebook['id'], page['id'])
        with open(page_path, 'w') as f:
            json.dump(page, f, indent=2)

    return jsonify({'notebook': notebook, 'pages': pages})


# ============== Handwritten Fonts API ==============

FONTS_DIR = DATA_DIR / 'fonts'
FONTS_DIR.mkdir(parents=True, exist_ok=True)

def get_font_path(font_id):
    return FONTS_DIR / f"{font_id}.json"

@app.route('/api/fonts', methods=['GET'])
def list_fonts():
    """List all handwritten fonts"""
    fonts = []
    for font_file in FONTS_DIR.glob('*.json'):
        try:
            with open(font_file, 'r') as f:
                font_data = json.load(f)
                # Return summary only (not full character data)
                fonts.append({
                    'id': font_data.get('id'),
                    'name': font_data.get('name'),
                    'createdAt': font_data.get('createdAt'),
                    'modifiedAt': font_data.get('modifiedAt'),
                    'characterCount': len(font_data.get('characters', {}))
                })
        except Exception as e:
            print(f"Error reading font {font_file}: {e}")
    return jsonify(fonts)

@app.route('/api/fonts', methods=['POST'])
def create_font():
    """Create a new handwritten font"""
    data = request.get_json() or {}
    font_id = generate_id()
    now = datetime.now().isoformat()

    font = {
        'id': font_id,
        'name': data.get('name', 'My Handwriting'),
        'createdAt': now,
        'modifiedAt': now,
        'metadata': {
            'baselineOffset': 0.8,
            'averageCharWidth': 40,
            'averageCharHeight': 60,
            'letterSpacing': 5,
            'lineHeight': 1.4,
            'slant': 0
        },
        'characters': {}
    }

    with open(get_font_path(font_id), 'w') as f:
        json.dump(font, f, indent=2)

    return jsonify(font), 201

@app.route('/api/fonts/<font_id>', methods=['GET'])
def get_font(font_id):
    """Get a font with all character data"""
    font_path = get_font_path(font_id)
    if not font_path.exists():
        return jsonify({'error': 'Font not found'}), 404

    with open(font_path, 'r') as f:
        font = json.load(f)

    return jsonify(font)

@app.route('/api/fonts/<font_id>', methods=['PUT'])
def update_font(font_id):
    """Update font metadata (not characters)"""
    font_path = get_font_path(font_id)
    if not font_path.exists():
        return jsonify({'error': 'Font not found'}), 404

    with open(font_path, 'r') as f:
        font = json.load(f)

    data = request.get_json() or {}

    # Update allowed fields
    if 'name' in data:
        font['name'] = data['name']
    if 'metadata' in data:
        font['metadata'].update(data['metadata'])

    font['modifiedAt'] = datetime.now().isoformat()

    with open(font_path, 'w') as f:
        json.dump(font, f, indent=2)

    return jsonify(font)

@app.route('/api/fonts/<font_id>', methods=['DELETE'])
def delete_font(font_id):
    """Delete a font"""
    font_path = get_font_path(font_id)
    if not font_path.exists():
        return jsonify({'error': 'Font not found'}), 404

    os.remove(font_path)
    return jsonify({'success': True})

@app.route('/api/fonts/<font_id>/characters/<char>', methods=['POST'])
def add_character_variant(font_id, char):
    """Add a new variant for a character"""
    font_path = get_font_path(font_id)
    if not font_path.exists():
        return jsonify({'error': 'Font not found'}), 404

    with open(font_path, 'r') as f:
        font = json.load(f)

    data = request.get_json()
    if not data or 'strokes' not in data:
        return jsonify({'error': 'Missing strokes data'}), 400

    # Initialize character if not exists
    if char not in font['characters']:
        font['characters'][char] = {
            'variants': [],
            'preferredVariant': 0
        }

    # Create variant
    variant = {
        'id': f"var_{generate_id()}",
        'strokes': data['strokes'],
        'boundingBox': data.get('boundingBox', {'width': 1.0, 'height': 1.0}),
        'totalTime': data.get('totalTime', 500)
    }

    font['characters'][char]['variants'].append(variant)
    font['modifiedAt'] = datetime.now().isoformat()

    with open(font_path, 'w') as f:
        json.dump(font, f, indent=2)

    return jsonify(variant), 201

@app.route('/api/fonts/<font_id>/characters/<char>/<variant_id>', methods=['DELETE'])
def delete_character_variant(font_id, char, variant_id):
    """Delete a specific variant of a character"""
    font_path = get_font_path(font_id)
    if not font_path.exists():
        return jsonify({'error': 'Font not found'}), 404

    with open(font_path, 'r') as f:
        font = json.load(f)

    if char not in font['characters']:
        return jsonify({'error': 'Character not found'}), 404

    char_data = font['characters'][char]
    original_len = len(char_data['variants'])
    char_data['variants'] = [v for v in char_data['variants'] if v['id'] != variant_id]

    if len(char_data['variants']) == original_len:
        return jsonify({'error': 'Variant not found'}), 404

    # Remove character entirely if no variants left
    if len(char_data['variants']) == 0:
        del font['characters'][char]
    else:
        # Adjust preferred variant if needed
        if char_data['preferredVariant'] >= len(char_data['variants']):
            char_data['preferredVariant'] = 0

    font['modifiedAt'] = datetime.now().isoformat()

    with open(font_path, 'w') as f:
        json.dump(font, f, indent=2)

    return jsonify({'success': True})


# ============== AI Helper API ==============

@app.route('/api/server/restart', methods=['POST'])
def restart_server():
    """Trigger server restart by touching a file (Flask debug auto-reload)"""
    if not app.debug:
        return error_response('Restart BadNotes through its desktop application', 409)

    try:
        # Touch this file to trigger Flask's auto-reload in debug mode
        restart_trigger = APP_DIR / '.restart_trigger'
        restart_trigger.touch()

        # Also touch app.py as fallback
        app_file = APP_DIR / 'app.py'
        app_file.touch()

        return jsonify({'success': True, 'message': 'Restarting...'})
    except Exception as e:
        return error_response(f'Restart failed: {str(e)}', 500)


@app.route('/api/timetable', methods=['GET'])
def aki1_timetable():
    try:
        response = jsonify(get_timetable())
        response.headers['Cache-Control'] = 'no-store'
        return response
    except Exception:
        return error_response('Calendar is temporarily unavailable', 503)


@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    """Proxy AI requests to Comet API"""
    api_key = os.environ.get('COMET_API_KEY')
    api_base = os.environ.get('COMET_API_BASE', 'https://api.cometapi.com/v1')

    if not api_key:
        return error_response('AI API key not configured', 500)

    try:
        data = request.get_json()
        if not data:
            return error_response('No data provided')

        messages = data.get('messages', [])
        model = data.get('model', 'gpt-6-luna')
        max_tokens = data.get('max_tokens', 16384)
        temperature = data.get('temperature', 0.7)

        payload = {
            'model': model,
            'messages': messages,
            'max_tokens': max_tokens,
            'temperature': temperature
        }
        if model in ('gpt-6-luna', 'gpt-6-sol'):
            payload['reasoning_effort'] = 'none'
            payload['max_completion_tokens'] = payload.pop('max_tokens')

        # Make request to Comet API
        response = http_requests.post(
            f"{api_base}/chat/completions",
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json'
            },
            json=payload,
            timeout=120
        )

        if response.status_code != 200:
            error_detail = response.text
            try:
                error_json = response.json()
                error_detail = error_json.get('error', {}).get('message', error_detail)
            except:
                pass
            return error_response(f'AI API error: {error_detail}', response.status_code)

        result = response.json()
        content = result.get('choices', [{}])[0].get('message', {}).get('content', '')

        return jsonify({
            'content': content,
            'model': model,
            'usage': result.get('usage', {})
        })

    except http_requests.Timeout:
        return error_response('AI request timed out', 504)
    except http_requests.RequestException as e:
        return error_response(f'AI request failed: {str(e)}', 500)
    except Exception as e:
        return error_response(f'Error: {str(e)}', 500)


# ============== Main ==============

if __name__ == '__main__':
    print("\n" + "="*50)
    print("  BadNotes - Professional Note Taking App")
    print("="*50)
    print(f"\n  Data stored in: {DATA_DIR}")
    print(f"  Open in browser: http://localhost:5001")
    print("\n  Ctrl+Alt+R in browser to restart server")
    print("  Press Ctrl+C to stop the server")
    print("="*50 + "\n")

    from waitress import serve
    serve(app, host='127.0.0.1', port=int(os.environ.get('BADNOTES_PORT', '5001')), threads=8)
