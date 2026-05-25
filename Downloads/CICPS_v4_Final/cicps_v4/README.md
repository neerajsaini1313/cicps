# CICPS — Complaint Intelligence & Crime Pattern System
**NCT Delhi | Restricted | v4.1**

A professional Flask-based web platform for analyzing suspect location and complaint data across NCT Delhi districts.

---

## Features

| Feature | Details |
|---|---|
| **Dashboard** | 8 KPI cards, district/hour/provider charts, daily trend |
| **Geo Intelligence** | Interactive Leaflet map — Cluster / Heat / Hotspot modes. Click any point for full details |
| **Analytics** | Monthly, daily, hourly, provider×district cross-analysis |
| **Search** | Search by mobile, IMEI, district, provider, victim, address, case ref |
| **Records Table** | Sortable, filterable, paginated — click row for detail modal |
| **Data Upload** | Drag-and-drop CSV, auto column detection, duplicate removal |
| **Insights** | Auto-generated intelligence summary with text export |
| **Hindi / English** | Full UI language toggle |
| **Dark / Light mode** | Theme switch including map tiles |
| **File Management** | Upload history with delete option |
| **Reset** | Delete all data and start fresh |

---

## Quick Start

### 1. Install Python (3.9+)
Download from [python.org](https://www.python.org/downloads/)

### 2. Install Flask
```bash
pip install -r requirements.txt
```

### 3. Run
```bash
python app.py
```

### 4. Open browser
```
http://localhost:5000
```

### 5. Upload your CSV
Go to the **Upload** page and drop your CSV file.

---

## CSV Format

The system auto-detects column names. Supported columns:

| Column | Required | Notes |
|---|---|---|
| District | Yes | e.g. WEST, EAST |
| Mobile | Yes | 10 or 12 digit |
| IMEI | No | Device ID |
| Provider | No | AIRTEL, JIO, etc. |
| Location Fetch Time | Yes | DD-MM-YYYY HH:MM |
| Latitude | Yes | e.g. 28.6572 |
| Longitude | Yes | e.g. 77.2090 |
| Address | No | Full address string |
| ackdet | No | Case reference |
| victim | No | Victim name/number |

---

## Project Structure

```
cicps/
├── app.py              ← Flask backend (API, ingestion, analytics)
├── requirements.txt    ← Flask only
├── README.md
├── .gitignore
├── data/
│   ├── records.json    ← All complaint records
│   ├── summary.json    ← Pre-computed analytics
│   └── files.json      ← Upload history
├── templates/
│   └── index.html      ← Full UI (Jinja2)
├── static/
│   ├── css/main.css    ← Dark/Light theme
│   └── js/main.js      ← All frontend logic
└── uploads/            ← Uploaded files (gitignored)
```

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Main application |
| `/api/summary` | GET | Dataset summary |
| `/api/records` | GET | Paginated records (filters: district, provider, mobile, date_from, date_to) |
| `/api/search` | GET | Search (q, field, provider, district, date_from, date_to) |
| `/api/export` | GET | Download filtered CSV |
| `/api/upload` | POST | Upload CSV file |
| `/api/files` | GET | Upload history |
| `/api/files/<id>` | DELETE | Remove upload record |
| `/api/reset` | POST | Delete all data |
| `/api/stats` | GET | Health check |

---

## Tech Stack

- **Backend:** Python 3, Flask
- **Frontend:** HTML5, CSS3, Vanilla JS (no framework dependency)
- **Charts:** Chart.js 4
- **Maps:** Leaflet.js + CartoDB tiles (Dark + Light)
- **Storage:** JSON flat-file (no database required)

---

*Classification: Restricted | NCT Delhi*
