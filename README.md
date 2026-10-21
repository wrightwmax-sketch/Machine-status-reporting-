# Student Projects Building — Machine Fault & Status Reporting System

A zero-dependency, industrial dark-mode Single-Page Application (SPA) designed for the **Student Projects Building**. Physical QR code placards mounted on all **24 shop machines and workstations** deep-link directly to `https://wrightwmax-sketch.github.io/Machine-status-reporting-/?id=<ASSET_ID>`, enabling students to immediately report broken tooling, machine alarms, or safety lockouts from their smartphones, update the live shop status board, and dispatch real-time **Microsoft Teams Adaptive Card (v1.4)** notifications.

---

## 1. Repository File Structure

```text
spl-machine-status/
├── index.html                        # Single-Page Application (Dashboard, Mobile Updater, QR Placard Printer, Settings Modal)
├── css/
│   └── styles.css                    # High-contrast industrial dark mode UI + @media print rules for QR placards
├── js/
│   └── app.js                        # Routing (?id= & ?view=), state sync, QR generation, and Teams Webhook dispatcher
├── data/
│   ├── machines.json                 # Master read-only registry of the 24 shop workstations
│   └── status.json                   # Live state ledger (updated via client localStorage + optional GitHub API/Power Automate sync)
├── .github/
│   └── workflows/
│       └── deploy-and-sync.yml       # GitHub Pages deployment + repository_dispatch listener to commit status.json updates
└── README.md                         # Setup guide for Microsoft Teams Workflows Webhook & QR placard printing
```

---

## 2. Tracked SPL Shop Equipment (24 Workstations)

| Asset ID | Machine / Workstation Name | Shop Zone |
| :--- | :--- | :--- |
| `FAC-01` | General Shop & Paint Booth | Facility & Infrastructure |
| `FAC-02` | Shop Compressed Air System | Facility & Infrastructure |
| `MAC-01` | Manual Mill #1 (Bridgeport) | Manual Machining |
| `MAC-02` | Manual Mill #2 (Bridgeport) | Manual Machining |
| `MAC-03` | Manual Mill #3 (Bridgeport) | Manual Machining |
| `MAC-04` | Manual Lathe | Manual Machining |
| `CNC-01` | CNC Mill | CNC Machining |
| `CNC-02` | Haas CNC Vertical Machining Center | CNC Machining |
| `CNC-03` | CNC Lathe | CNC Machining |
| `SAW-01` | Vertical Bandsaw | Cutting & Saws |
| `SAW-02` | Horizontal Bandsaw | Cutting & Saws |
| `SAW-03` | Abrasive Chop Saw | Cutting & Saws |
| `SAW-04` | 10" Compound Miter Saw | Cutting & Saws |
| `FAB-01` | 6" x 48" Belt Sander | Abrasive & Finishing |
| `FAB-02` | Tube & Pipe Notcher | Fabrication & Prep |
| `FAB-03` | Bench Grinders | Abrasive & Finishing |
| `FAB-04` | Media Blast Cabinet (Sand Blaster) | Abrasive & Finishing |
| `WLD-01` | TIG Welder Station | Welding & Thermal |
| `WLD-02` | MIG Welder Station | Welding & Thermal |
| `WLD-03` | CNC Plasma Table | Welding & Thermal |
| `WLD-04` | Hand Plasma Cutter | Welding & Thermal |
| `WJT-01` | WAZER Desktop Waterjet | Waterjet Cutting |
| `GEN-01` | Briggs & Stratton 6500W Generator | Mobile Power / Support |
| `GEN-02` | Briggs & Stratton 5500W Generator | Mobile Power / Support |

---

## 3. Application Routes & Deep-Linking

- **Live Shop Status Board (Default Route `/`)**:
  - Displays 4 KPI summary cards (**Total Tracked: 24**, **Operational 🟢**, **Degraded / Needs Tooling 🟡**, **Down / Red-Tagged 🔴**).
  - Instant search by Asset ID, machine name, or fault note, plus one-click Shop Zone and Status filter pills.
  - Responsive Bento grid for all 24 workstations. Clicking any workstation card opens the Mobile Status Updater pre-selected to that machine.
- **Mobile QR Status Updater (`/?id=<ASSET_ID>`)**:
  - Case-insensitive deep-linking (e.g., `/?id=MAC-02` or `/?id=CNC-02`) automatically opens the updater view, pre-locks the target workstation, and shows a live status banner at the top of the screen so students immediately see if a fault is already logged.
  - Supports all 7 CAR affiliations (**Baja SAE**, **Formula Buckeyes**, **Buckeye Current**, **Buckeye Solar Racing**, **Buckeye Experimental Aeronautics (BExA)**, **EcoCAR**, and **Shop Staff / Lab Supervisor**).
- **Printable QR Code Placards (`/?view=qr`)**:
  - Generates 24 high-contrast `160x160px` QR code shop labels formatted in a 3-column print grid (`8 rows × 3 columns`) with `page-break-inside: avoid` for lamination and mounting.

---

## 4. Microsoft Teams Workflows Webhook Setup Guide

1. In **Microsoft Teams**, navigate to the target **Student Projects Building** channel, click **More options (`•••`)** → **Workflows**.
2. Select **"Post to a channel when a webhook request is received"**.
3. Copy the generated **HTTP POST URL**.
4. Open the Student Projects Building Machine Status web app, click the **⚙️ (Supervisor Settings)** icon in the top-right header, paste the URL into **Microsoft Teams Workflows / Incoming Webhook URL**, and click **Save Integration Config**.
5. Click **Send Test Adaptive Card** to verify that the v1.4 Adaptive Card posts to your Teams channel with a direct deep-link action button (`/?id=<ASSET_ID>`).

### Optional Cross-Device State Sync (`status.json` via Power Automate or GitHub API)

To automatically commit status changes back to `data/status.json` in GitHub:
1. Add an **HTTP** action in your Power Automate flow (or configure the **Shared State API Endpoint** in the Supervisor Modal) that sends a `POST` request to:
   ```text
   https://api.github.com/repos/wrightwmax-sketch/Machine-status-reporting-/dispatches
   ```
2. Include headers `Accept: application/vnd.github+json` and `Authorization: Bearer <GITHUB_PAT>` with body:
   ```json
   {
     "event_type": "update_machine_status",
     "client_payload": {
       "machineId": "MAC-02",
       "statusEntry": {
         "status": "DOWN",
         "category": "Broken Tooling / Blade / Insert",
         "team": "Buckeye Experimental Aeronautics (BExA)",
         "reporter": "Alex Smith (alex.smith@email.edu)",
         "notes": "Broken 1/4-20 tap in Bridgeport #2 vise",
         "updatedAt": "2026-10-20T19:30:00.000Z"
       }
     }
   }
   ```
3. The included `.github/workflows/deploy-and-sync.yml` workflow listens for `update_machine_status`, updates `data/status.json` via `jq`, commits the change, and redeploys GitHub Pages.

---

## 5. Printing & Laminating QR Code Placards

1. Navigate to `/?view=qr` (or click **QR Placards (24)** in the top navigation bar).
2. Verify or override the **Base Production URL** (e.g., `https://wrightwmax-sketch.github.io/Machine-status-reporting-/`) and click **Update QR Links**.
3. Click **🖨️ Print All 24 Placards**.
4. In the browser print dialog:
   - Set **Layout** to **Portrait**.
   - Enable **Background graphics** so the header and high-contrast industrial footer bars print cleanly.
5. Laminate the printed sheets using 5-mil thermal pouches and mount each placard directly on its corresponding workstation.

---

## 6. Local Development & Verification

```bash
python3 -m http.server 8080
```

Then open:
- `http://localhost:8080/` — Live Shop Status Board
- `http://localhost:8080/?id=MAC-02` — Mobile Status Updater pre-locked to Manual Mill #2 (Bridgeport)
- `http://localhost:8080/?view=qr` — 24 Printable QR Code Placards
