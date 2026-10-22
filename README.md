# Student Projects Laboratory Operations, Safety (SOP/LOTO) & Preventative Maintenance (PM) Portal (`930 Kinnear Rd`)

A zero-build, static industrial web application hosted on GitHub Pages for the **Student Projects Laboratory / Student Projects Machine Shop (`930 Kinnear Rd`)**, supervised by **Max Wright (Sr. Instructional Lab Supervisor)**.

---

## 1. Core Operations & Single-QR Architecture

- **Real-Time Shop Operations & Monthly PM Hub:** Provides a live **Preventative Maintenance (PM) Matrix**, **Machine Condition / Fault Reporting System**, and **Native Local PDF SOP / LOTO Safety Repository** across all 24 primary shop assets across 6 facility zones.
- **Supported Academic & Student Programs:** Experimental Methods laboratory courses and 7 student engineering project groups:
  1. **Formula Buckeyes**
  2. **Baja Engineering**
  3. **Buckeye Current**
  4. **Advanced Vehicle Team**
  5. **Venturi**
  6. **DBR**
  7. **Buckeye Experimental Aeronautics (BExA)**
- **Single-QR "All-In-One" Machine Hub (`?asset=<ASSET_ID>`):** Scanning any machine's physical `2" × 3"` QR decal immediately opens that asset's **Unified 4-Tab Asset Hub Modal**:
  - **Tab 1 (`&tab=fault`): Condition & Fault Report** — Instant condition/fault reporting + pre-filled GitHub Issue (`unscheduled_downtime_fault.yml`).
  - **Tab 2 (`&tab=sop`): Standard Operating Procedure (SOP)** — Native repository-hosted PDF viewer (`docs/sop/{ID}-SOP.pdf`) using a dual `<object type="application/pdf">` + `<iframe>` + fallback engine, with **View Fullscreen**, **Download PDF**, and optional **Open Drive Mirror** actions, plus PPE badges (`🚫 NO GLOVES`), hazards, and Before/During/After checklists. All three Bridgeport Series I Knee Mills (`MAC-01`, `MAC-02`, `MAC-03`) share the unified Bridgeport Mill SOP (`docs/sop/MAC-01-SOP.pdf`).
  - **Tab 3 (`&tab=loto`): Lockout / Tagout (LOTO)** — Native repository-hosted PDF viewer (`docs/loto/{ID}-LOTO.pdf`) with **View Fullscreen**, **Download PDF**, and optional **Open Drive Mirror**, plus authorized personnel, notification channel (`Max Wright - Teams / Text Message`), energy sources & magnitudes, isolation locations, stored energy relief, and zero-energy verification. All three Bridgeport Series I Knee Mills (`MAC-01`, `MAC-02`, `MAC-03`) share the unified Bridgeport Mill LOTO (`docs/loto/MAC-01-LOTO.pdf`).
  - **Tab 4 (`&tab=pm`): Monthly PM Matrix** — Standardized 30-day preventative maintenance checklist, quantitative wear logging (Coolant Brix %, pH, X/Y leadscrew backlash, pneumatic PSI), and one-click GitHub Issue submission (`monthly_pm_log.yml`).

---

## 2. Day / Night Theme Switcher (`js/theme.js`)

The portal supports a dual-theme interface tailored for high-glare shop floor tablets (**Day Mode**) and low-light supervisor workstations (**Night Mode**):
- **Banner Theme Selector Control (`#theme-toggle-btn`):** Located in the top navigation banner on both `index.html` and `qr-sheets.html`.
- **Persistence (`localStorage` key `'shop_portal_theme'`):**
  - `initTheme()`: Reads `localStorage` (defaulting to `'dark'`) and applies `data-theme` and `.dark` on `<html>` before DOM paint to eliminate flash-of-unstyled-content (FOUC).
  - `setTheme(themeName)`: Sets `data-theme="light"` or `data-theme="dark"` on `<html>`, toggles `.dark`, updates `#theme-toggle-btn`, and saves to `localStorage`.
  - `toggleTheme()`: Flips between `'light'` and `'dark'`.

---

## 3. Repository File Structure

```text
student-projects-shop-portal/
├── README.md                                  # Deployment guide, QR decal workflow, and native PDF SOP/LOTO architecture
├── index.html                                 # Main dashboard, theme toggle, operational status banner, asset grid, and 4-tab Asset Modal
├── qr-sheets.html                             # Dedicated decal generator page that previews and prints 2"x3" QR labels for all 24 assets
├── css/
│   └── styles.css                             # Dual-theme (Day/Night) shop UI + @media print rules for 2"x3" QR machine decals
├── js/
│   ├── theme.js                               # Day / Night theme controller using localStorage key 'shop_portal_theme'
│   ├── app.js                                 # Deep-link router (?asset=MAC-01&tab=sop), dual PDF display engine, KPI math, CSV export
│   └── qr-generator.js                        # Printable QR decal sheet generator for all 24 shop assets
├── docs/
│   ├── sop/                                   # Repository-hosted SOP PDFs (MAC-01-SOP.pdf .. FAC-02-SOP.pdf)
│   └── loto/                                  # Repository-hosted LOTO PDFs (MAC-01-LOTO.pdf .. FAC-02-LOTO.pdf)
├── data/
│   ├── equipment_master.json                  # Unified JSON database containing PM checklists, LOTO procedures, and SOPs for all 24 assets
│   └── pm_history.json                        # Historical PM & condition log array with baseline entries
└── .github/
    ├── ISSUE_TEMPLATE/
    │   ├── monthly_pm_log.yml                 # Structured GitHub Issue Form for logging monthly PM checks
    │   └── unscheduled_downtime_fault.yml     # Structured GitHub Issue Form for student/staff machine fault reporting
    └── workflows/
        └── process_shop_submission.yml        # GitHub Action (Python) that parses submitted PM or Fault issues, updates JSONs, and closes ticket
```

---

## 4. Master Equipment Inventory (24 Assets Across 6 Zones)

| Zone | Asset ID | Equipment Tag | Workstation Name | Local SOP / LOTO PDFs |
| :--- | :--- | :--- | :--- | :--- |
| **Zone 1: Manual Machining (`MAC`)** | `MAC-01` | `001` | Bridgeport Series I Manual Knee Mill #1 | `docs/sop/MAC-01-SOP.pdf` / `docs/loto/MAC-01-LOTO.pdf` |
| **Zone 1: Manual Machining (`MAC`)** | `MAC-02` | `002` | Bridgeport Series I Manual Knee Mill #2 | `docs/sop/MAC-01-SOP.pdf` / `docs/loto/MAC-01-LOTO.pdf` (Shared) |
| **Zone 1: Manual Machining (`MAC`)** | `MAC-03` | `003` | Bridgeport Series I Manual Knee Mill #3 | `docs/sop/MAC-01-SOP.pdf` / `docs/loto/MAC-01-LOTO.pdf` (Shared) |
| **Zone 1: Manual Machining (`MAC`)** | `MAC-04` | `Shop-Lathe-01` | Sharp Manual Engine Lathe | `docs/sop/MAC-04-SOP.pdf` / `docs/loto/MAC-04-LOTO.pdf` |
| **Zone 2: CNC Machining (`CNC`)** | `CNC-01` | `01168375` | KIA 3-Axis CNC Machining Center | `docs/sop/CNC-01-SOP.pdf` / `docs/loto/CNC-01-LOTO.pdf` |
| **Zone 2: CNC Machining (`CNC`)** | `CNC-02` | `01191439` | Haas VF-2SS CNC Vertical Machining Center | `docs/sop/CNC-02-SOP.pdf` / `docs/loto/CNC-02-LOTO.pdf` |
| **Zone 2: CNC Machining (`CNC`)** | `CNC-03` | `NC090435` | Hurco CNC Turning Center | `docs/sop/CNC-03-SOP.pdf` / `docs/loto/CNC-03-LOTO.pdf` |
| **Zone 3: Welding & Thermal (`WLD`)** | `WLD-01` | `747061` | Lincoln Electric Precision TIG 275 (#1) | `docs/sop/WLD-01-SOP.pdf` / `docs/loto/WLD-01-LOTO.pdf` |
| **Zone 3: Welding & Thermal (`WLD`)** | `WLD-02` | `15-015M1` | Lincoln Electric Power MIG 255C | `docs/sop/WLD-02-SOP.pdf` / `docs/loto/WLD-02-LOTO.pdf` |
| **Zone 3: Welding & Thermal (`WLD`)** | `WLD-03` | `Shop-Plasma-01` | CNC Plasma Table & Hand Plasma | `docs/sop/WLD-03-SOP.pdf` / `docs/loto/WLD-03-LOTO.pdf` |
| **Zone 3: Welding & Thermal (`WLD`)** | `WLD-04` | `01166873` | Thermal Suite: Blue M Industrial Oven & Muffle Furnace | `docs/sop/WLD-04-SOP.pdf` / `docs/loto/WLD-04-LOTO.pdf` |
| **Zone 3: Welding & Thermal (`WLD`)** | `WLD-05` | `747062` | Lincoln Electric Precision TIG 275 (#2) | `docs/sop/WLD-05-SOP.pdf` / `docs/loto/WLD-05-LOTO.pdf` |
| **Zone 4: Cutting, Saws & Drilling (`SAW`)** | `SAW-01` | `Shop-Saw-01` | Vertical Metal Cutting Bandsaw | `docs/sop/SAW-01-SOP.pdf` / `docs/loto/SAW-01-LOTO.pdf` |
| **Zone 4: Cutting, Saws & Drilling (`SAW`)** | `SAW-02` | `Shop-Saw-02` | Horizontal Drop Bandsaw | `docs/sop/SAW-02-SOP.pdf` / `docs/loto/SAW-02-LOTO.pdf` |
| **Zone 4: Cutting, Saws & Drilling (`SAW`)** | `SAW-03` | `Shop-Saw-03` | Abrasive Chop Saw | `docs/sop/SAW-03-SOP.pdf` / `docs/loto/SAW-03-LOTO.pdf` |
| **Zone 4: Cutting, Saws & Drilling (`SAW`)** | `SAW-04` | `Shop-Drill-01` | 10" Compound Miter Saw & JET Floor Drill Press #1 | `docs/sop/SAW-04-SOP.pdf` / `docs/loto/SAW-04-LOTO.pdf` |
| **Zone 4: Cutting, Saws & Drilling (`SAW`)** | `SAW-05` | `Shop-Drill-02` | JET Industrial Floor Drill Press #2 | `docs/sop/SAW-05-SOP.pdf` / `docs/loto/SAW-05-LOTO.pdf` |
| **Zone 5: Sheet Metal & Abrasive (`FAB`)** | `FAB-01` | `Shop-Fab-01` | General International 6"x48" Belt / 12" Disc Sander | `docs/sop/FAB-01-SOP.pdf` / `docs/loto/FAB-01-LOTO.pdf` |
| **Zone 5: Sheet Metal & Abrasive (`FAB`)** | `FAB-02` | `Shop-Fab-02` | Grizzly G0767 Tube Notcher & Tennsmith HBU48-16 Hand Brake | `docs/sop/FAB-02-SOP.pdf` / `docs/loto/FAB-02-LOTO.pdf` |
| **Zone 5: Sheet Metal & Abrasive (`FAB`)** | `FAB-03` | `Shop-Fab-03` | Pedestal Bench Grinders & Deburring Station | `docs/sop/FAB-03-SOP.pdf` / `docs/loto/FAB-03-LOTO.pdf` |
| **Zone 5: Sheet Metal & Abrasive (`FAB`)** | `FAB-04` | `Shop-Fab-04` | Abrasive Blast Cabinet & Enerpac 10T Hydraulic Press | `docs/sop/FAB-04-SOP.pdf` / `docs/loto/FAB-04-LOTO.pdf` |
| **Zone 5: Sheet Metal & Abrasive (`FAB`)** | `FAB-05` | `Shop-Fab-05` | Industrial Metal Shear & Redline 20T Hydraulic Shop Press | `docs/sop/FAB-05-SOP.pdf` / `docs/loto/FAB-05-LOTO.pdf` |
| **Zone 6: Facility & Infrastructure (`FAC`)** | `FAC-01` | `Facility-01` | Safety Hub, LOTO Lock Center, HV Battery Bench & Paint Booth | `docs/sop/FAC-01-SOP.pdf` / `docs/loto/FAC-01-LOTO.pdf` |
| **Zone 6: Facility & Infrastructure (`FAC`)** | `FAC-02` | `Facility-02` | Compressed Air System & Distribution | `docs/sop/FAC-02-SOP.pdf` / `docs/loto/FAC-02-LOTO.pdf` |

---

## 5. Printing `2" × 3"` 3-in-1 QR Machine Decals

1. Open `qr-sheets.html` (or click **QR Decal Sheets** in the top navigation bar of `index.html`).
2. Verify your deployed GitHub Pages URL in the Base URL field (`https://wrightwmax-sketch.github.io/Machine-status-reporting-/`).
3. Click **Print 2"×3" Decals (`Ctrl+P`)**. The `@media print` stylesheet formats all **24** machine decals at `3" × 2"` with crisp borders, asset ID, equipment tag, QR code, and the callout:
   > **SCAN FOR: 1. SOP & PPE | 2. LOTO Procedure | 3. Report Fault / Log PM**
