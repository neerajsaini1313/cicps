"""
CICPS — Complaint Intelligence & Crime Pattern System
Flask Backend v4.1 | NCT Delhi
"""

import os
import json
import csv
import io
import logging
from datetime import datetime
from collections import Counter
from flask import (
    Flask, render_template, jsonify,
    request, send_file, abort
)
from werkzeug.utils import secure_filename

# ── App Setup ────────────────────────────────────────
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'cicps-delhi-2026-change-in-production')
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB

BASE      = os.path.dirname(os.path.abspath(__file__))
DATA_DIR  = os.path.join(BASE, 'data')
UPL_DIR   = os.path.join(BASE, 'uploads')

RECORDS_F = os.path.join(DATA_DIR, 'records.json')
SUMMARY_F = os.path.join(DATA_DIR, 'summary.json')
FILES_F   = os.path.join(DATA_DIR, 'files.json')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPL_DIR,  exist_ok=True)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger(__name__)

# ── I/O Helpers ──────────────────────────────────────
def _read(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        log.error('Read error %s: %s', path, e)
        return default

def _write(path, data):
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
        return True
    except Exception as e:
        log.error('Write error %s: %s', path, e)
        return False

def load_records():  return _read(RECORDS_F, [])
def load_summary():  return _read(SUMMARY_F, {})
def load_files():    return _read(FILES_F,   [])
def save_records(d): return _write(RECORDS_F, d)
def save_summary(d): return _write(SUMMARY_F, d)
def save_files(d):   return _write(FILES_F,   d)

# ── Analytics ────────────────────────────────────────
def compute_summary(records):
    if not records:
        return {
            'total': 0, 'uniq_mob': 0, 'uniq_imei': 0,
            'districts': {}, 'providers': {}, 'hours': {},
            'dates': {}, 'months': {}, 'hotspots': [],
            'peak_hour': '0', 'top_district': '', 'top_provider': '',
            'top_hotspot': {}, 'date_range': {'from': '', 'to': ''},
            'peak_date': '', 'peak_date_count': 0,
            'airtel_dist': {}, 'jio_dist': {}
        }

    # R cols: [0]dist [1]mob_full [2]mob_s [3]imei [4]prov
    #         [5]time [6]lat [7]lon [8]addr [9]victim [10]ackdet [11]hour [12]date
    dc = Counter(r[0] for r in records)
    pc = Counter(r[4] for r in records)
    hc = {str(h): sum(1 for r in records if r[11] == h) for h in range(24)}
    date_c  = dict(sorted(Counter(r[12] for r in records).items()))
    month_c = {}
    for r in records:
        mo = r[12][:7]
        month_c[mo] = month_c.get(mo, 0) + 1
    month_c = dict(sorted(month_c.items()))

    coord_c  = Counter((round(r[6], 4), round(r[7], 4)) for r in records if r[6])
    hotspots = [{'la': k[0], 'lo': k[1], 'c': v} for k, v in coord_c.most_common(100)]

    ad, jd = {}, {}
    for r in records:
        if r[4] == 'AIRTEL':
            ad[r[0]] = ad.get(r[0], 0) + 1
        else:
            jd[r[0]] = jd.get(r[0], 0) + 1

    peak_date = max(date_c, key=date_c.get) if date_c else ''

    return {
        'total':           len(records),
        'uniq_mob':        len(set(r[1] for r in records)),
        'uniq_imei':       len(set(r[3] for r in records)),
        'districts':       dict(dc.most_common()),
        'providers':       dict(pc.most_common()),
        'hours':           hc,
        'dates':           date_c,
        'months':          month_c,
        'hotspots':        hotspots,
        'peak_hour':       max(hc, key=lambda x: hc[x]) if hc else '0',
        'top_district':    dc.most_common(1)[0][0] if dc else '',
        'top_provider':    pc.most_common(1)[0][0] if pc else '',
        'top_hotspot':     hotspots[0] if hotspots else {},
        'date_range': {
            'from': min(date_c) if date_c else '',
            'to':   max(date_c) if date_c else ''
        },
        'peak_date':       peak_date,
        'peak_date_count': date_c.get(peak_date, 0),
        'airtel_dist':     ad,
        'jio_dist':        jd,
    }

# ── CSV Ingestion ────────────────────────────────────
def _clean(s, n=100):
    if not s:
        return ''
    return ' '.join(str(s).replace('\n', ' ').replace('\r', ' ').replace('\t', ' ').split())[:n]

def _parse_dt(v):
    for fmt in ('%d-%m-%Y %H:%M', '%Y-%m-%d %H:%M:%S',
                '%d/%m/%Y %H:%M', '%Y-%m-%dT%H:%M:%S',
                '%d-%m-%Y %H:%M:%S', '%m/%d/%Y %H:%M'):
        try:
            return datetime.strptime(v.strip(), fmt)
        except Exception:
            pass
    return None

def _get(row, *names):
    """Case-insensitive column getter."""
    lower_row = {k.strip().lower(): v for k, v in row.items()}
    for name in names:
        val = lower_row.get(name.lower(), '')
        if val:
            return val
    return ''

def ingest_csv(content, existing_records):
    """Parse CSV bytes → (new_rows, new_count, dup_count, fail_count)."""
    existing_keys = set((r[1], r[5]) for r in existing_records)

    try:
        text = content.decode('utf-8-sig')
    except Exception:
        try:
            text = content.decode('utf-8')
        except Exception:
            text = content.decode('latin-1')

    # Detect delimiter
    first_line = text.split('\n')[0]
    delim = ',' if first_line.count(',') >= first_line.count(';') else ';'

    try:
        reader = csv.DictReader(io.StringIO(text), delimiter=delim)
        rows = list(reader)
    except Exception as e:
        log.error('CSV parse error: %s', e)
        return [], 0, 0, 1

    new_rows, nc, dc, fc = [], 0, 0, 0

    for row in rows:
        try:
            mob   = _clean(_get(row, 'mobile', 'mobile number', 'mob', 'msisdn'), 20)
            mob_s = mob[-10:] if len(mob) >= 10 else mob
            dist  = _clean(_get(row, 'district', 'dist', 'city'), 60).upper()
            prov  = _clean(_get(row, 'provider', 'telecom provider', 'network', 'operator'), 40).upper()
            t_raw = _clean(_get(row, 'location fetch time', 'time', 'datetime',
                                 'fetch time', 'timestamp', 'date time'), 30)
            lat_s = _clean(_get(row, 'latitude', 'lat'), 20)
            lon_s = _clean(_get(row, 'longitude', 'lon', 'long'), 20)
            addr  = _clean(_get(row, 'address', 'addr', 'location', 'area'), 100)
            victim= _clean(_get(row, 'victim', 'victim details', 'victims',
                                 'complainant', 'victim name'), 80)
            ackdet= _clean(_get(row, 'ackdet', 'ack', 'case', 'case reference',
                                 'complaint number', 'fir'), 100)
            imei  = _clean(_get(row, 'imei', 'device id'), 20)

            if not mob or not t_raw:
                fc += 1
                continue

            dt = _parse_dt(t_raw)
            if not dt:
                fc += 1
                continue

            try:
                lat = float(lat_s) if lat_s else 0.0
                lon = float(lon_s) if lon_s else 0.0
            except ValueError:
                lat, lon = 0.0, 0.0

            # Validate India bounds (loose check)
            if lat and not (6.0 <= lat <= 38.0):
                lat = 0.0
            if lon and not (68.0 <= lon <= 98.0):
                lon = 0.0

            key = (mob, t_raw)
            if key in existing_keys:
                dc += 1
                continue
            existing_keys.add(key)

            new_rows.append([
                dist, mob, mob_s, imei, prov, t_raw,
                lat, lon, addr, victim, ackdet,
                dt.hour, dt.strftime('%Y-%m-%d')
            ])
            nc += 1

        except Exception as e:
            log.debug('Row skip: %s', e)
            fc += 1

    return new_rows, nc, dc, fc

# ── Routes ───────────────────────────────────────────
@app.route('/')
def index():
    records = load_records()
    summary = load_summary() or compute_summary(records)
    return render_template(
        'index.html',
        records_json=json.dumps(records, separators=(',', ':'), ensure_ascii=False),
        summary_json=json.dumps(summary, separators=(',', ':'), ensure_ascii=False)
    )

@app.route('/api/summary')
def api_summary():
    return jsonify(load_summary() or compute_summary(load_records()))

@app.route('/api/records')
def api_records():
    records  = load_records()
    district = request.args.get('district', '')
    provider = request.args.get('provider', '')
    mobile   = request.args.get('mobile', '').strip()
    date_from= request.args.get('date_from', '')
    date_to  = request.args.get('date_to', '')
    page     = max(1, int(request.args.get('page', 1)))
    per_page = min(500, int(request.args.get('per_page', 50)))

    filtered = [r for r in records if
        (not district or r[0] == district) and
        (not provider or r[4] == provider) and
        (not mobile   or mobile in r[1] or mobile in r[2]) and
        (not date_from or r[12] >= date_from) and
        (not date_to   or r[12] <= date_to)
    ]

    total = len(filtered)
    start = (page - 1) * per_page
    return jsonify({
        'data':  filtered[start:start + per_page],
        'total': total,
        'page':  page,
        'pages': max(1, (total + per_page - 1) // per_page)
    })

@app.route('/api/search')
def api_search():
    records = load_records()
    q       = request.args.get('q', '').strip()
    field   = request.args.get('field', 'all')
    prov    = request.args.get('provider', '')
    dist    = request.args.get('district', '')
    df      = request.args.get('date_from', '')
    dt      = request.args.get('date_to', '')
    limit   = min(500, int(request.args.get('limit', 200)))
    qt      = q.lower()

    def match(r):
        if prov and r[4] != prov:  return False
        if dist and r[0] != dist:  return False
        if df   and r[12] < df:    return False
        if dt   and r[12] > dt:    return False
        if not q:                  return True
        if field == 'mob':    return q in r[1] or q in r[2]
        if field == 'imei':   return q in r[3]
        if field == 'dist':   return qt in r[0].lower()
        if field == 'prov':   return qt in r[4].lower()
        if field == 'victim': return qt in r[9].lower()
        if field == 'addr':   return qt in r[8].lower()
        if field == 'ackdet': return qt in r[10].lower()
        # all fields
        return (q in r[1] or q in r[2] or q in r[3] or
                qt in r[0].lower() or qt in r[4].lower() or
                qt in r[8].lower() or qt in r[9].lower() or qt in r[10].lower())

    results = [r for r in records if match(r)]
    return jsonify({'data': results[:limit], 'total': len(results)})

@app.route('/api/export')
def api_export():
    records  = load_records()
    district = request.args.get('district', '')
    provider = request.args.get('provider', '')
    mobile   = request.args.get('mobile', '').strip()
    date_from= request.args.get('date_from', '')
    date_to  = request.args.get('date_to', '')

    filtered = [r for r in records if
        (not district or r[0] == district) and
        (not provider or r[4] == provider) and
        (not mobile   or mobile in r[1] or mobile in r[2]) and
        (not date_from or r[12] >= date_from) and
        (not date_to   or r[12] <= date_to)
    ]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['District', 'Mobile', 'IMEI', 'Provider', 'Time',
                     'Latitude', 'Longitude', 'Address', 'Victim', 'CaseRef'])
    for r in filtered:
        writer.writerow([r[0], r[1], r[3], r[4], r[5],
                         r[6], r[7], r[8], r[9], r[10]])

    output.seek(0)
    fname = f'CICPS_Export_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
    return send_file(
        io.BytesIO(('\ufeff' + output.getvalue()).encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=fname
    )

@app.route('/api/upload', methods=['POST'])
def api_upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    f = request.files['file']
    if not f or not f.filename:
        return jsonify({'error': 'Empty file'}), 400

    ext = f.filename.rsplit('.', 1)[-1].lower()
    if ext not in ('csv', 'xlsx', 'xls'):
        return jsonify({'error': 'Only CSV files are supported'}), 400

    content  = f.read()
    records  = load_records()
    new_rows, nc, dc, fc = ingest_csv(content, records)

    if new_rows:
        records = records + new_rows

    summary = compute_summary(records)
    save_records(records)
    save_summary(summary)

    # Track upload
    files = load_files()
    files.append({
        'id':       datetime.now().strftime('%Y%m%d%H%M%S%f'),
        'name':     secure_filename(f.filename),
        'size_kb':  round(len(content) / 1024, 1),
        'uploaded': datetime.now().strftime('%d %b %Y, %H:%M'),
        'new':      nc,
        'dup':      dc,
        'fail':     fc,
        'total':    nc + dc + fc
    })
    save_files(files)
    log.info('Upload: %s | new=%d dup=%d fail=%d', f.filename, nc, dc, fc)

    return jsonify({
        'filename':          secure_filename(f.filename),
        'total_rows':        nc + dc + fc,
        'new_records':       nc,
        'duplicate_records': dc,
        'failed_records':    fc,
        'status':            'completed',
        'summary':           summary
    })

@app.route('/api/files')
def api_files():
    return jsonify(load_files())

@app.route('/api/files/<file_id>', methods=['DELETE'])
def api_delete_file(file_id):
    files = [f for f in load_files() if f.get('id') != file_id]
    save_files(files)
    return jsonify({'status': 'ok'})

@app.route('/api/reset', methods=['POST'])
def api_reset():
    empty = compute_summary([])
    save_records([])
    save_summary(empty)
    save_files([])
    log.info('All data reset')
    return jsonify({'status': 'ok', 'summary': empty})

@app.route('/api/stats')
def api_stats():
    s = load_summary()
    return jsonify({
        'status':  'ok',
        'total':   s.get('total', 0),
        'version': '4.1',
        'ts':      datetime.now().isoformat()
    })

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(413)
def too_large(e):
    return jsonify({'error': 'File too large. Maximum 100 MB.'}), 413

@app.errorhandler(500)
def server_error(e):
    log.error('500: %s', e)
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    log.info('CICPS v4.1 starting on http://localhost:5000')
    app.run(debug=True, host='0.0.0.0', port=5000)
