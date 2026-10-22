# CAR Student Projects Shop Operations, Safety (SOP/LOTO) & Preventative Maintenance (PM) Portal (`930 Kinnear Rd`)

A zero-build, static industrial web application hosted on GitHub Pages for the **CAR Student Projects Shop (`930 Kinnear Rd`)**, supervised by **Max Wright (Sr. Instructional Lab Supervisor)**.

---

## 1. Core Mission & March 2027 Standardization Architecture

- **March 2027 Milestone:** Standardize and execute a unified **Preventative Maintenance (PM) Matrix**, **Machine Condition / Fault Reporting Pipeline**, and **Digital SOP / LOTO Safety Repository** across all 18 primary shop machine tools and infrastructure zones by **March 2027**.
- **Supported Academic & Student Programs:** Experimental Methods courses and 7 student engineering teams:
  1. **Baja SAE**
  2. **Formula SAE**
  3. **Buckeye Current**
  4. **EcoCAR**
  5. **Venturi**
  6. **DBR**
  7. **Buckeye Experimental Aeronautics (BExA)**
- **Single-QR "All-In-One" Machine Hub (`?asset=<ASSET_ID>`):** Scanning any machine's physical `2" × 3"` QR decal immediately opens that asset's **Unified 4-Tab Asset Hub Modal**:
  - **Tab 1 (`&tab=fault`): Report Condition / Fault** — Instant condition/fault reporting + pre-filled GitHub Issue (`unscheduled_downtime_fault.yml`).
  - **Tab 2 (`&tab=sop`): Standard Operating Procedure (SOP)** — Required PPE badges (including prominent red `🚫 NO GLOVES` warnings on rotating spindle/blade/belt equipment), hazards, Before/During/After use checklists, and emergency protocols.
  - **Tab 3 (`&tab=loto`): Lockout / Tagout (LOTO)** — Authorized personnel, notification channel (`Max Wright - Teams / Text Message`), normal shutdown controls, energy sources & magnitudes, isolation device locations, stored energy relief (e.g., 5-min capacitor bleed, Argon/C25 line purge, `<167°F` Blue M oven cool-down), and zero-energy verification.
  - **Tab 4 (`&tab=pm`): Monthly PM Checklist** — Standardized monthly preventative maintenance checklist, quantitative wear logging (Coolant Brix %, X/Y Backlash `0.000"`, Tool Rest Gap `<= 1/16"`, Regulator PSI), and 1-click GitHub Issue (`monthly_pm_log.yml`) + JSON export.

---

## 2. Repository File Structure

```text
shop-pm-portal/
├── README.md                                  # Deployment guide, QR decal workflow, and March 2027 PM/LOTO/SOP architecture
├── index.html                                 # Main dashboard, KPI banner, zone filters, and 4-tab Unified Asset Modal
├── css/
│   └── styles.css                             # High-contrast shop UI + @media print rules for 2"x3" QR machine decals
├── js/
│   ├── app.js                                 # Deep-link router (?asset=MAC-01&tab=sop), 4-tab modal renderer, KPI math, CSV export
│   └── qr-generator.js                        # Printable QR decal sheet generator for all shop assets
├── data/
│   ├── equipment_master.json                  # Unified JSON database containing PM checklists, LOTO procedures, and SOPs for all assets
│   └── pm_history.json                        # Historical PM & condition log array with baseline entries
└── .github/
    ├── ISSUE_TEMPLATE/
    │   ├── monthly_pm_log.yml                 # Structured GitHub Issue Form for logging monthly PM checks
    │   └── unscheduled_downtime_fault.yml     # Structured GitHub Issue Form for student/staff machine fault reporting
    └── workflows/
        └── process_shop_submission.yml        # GitHub Action (Python) that parses submitted PM or Fault issues, updates `equipment_master.json` status/dates and `pm_history.json`, commits to `main`, and closes the ticket
```

---

## 3. Master Equipment Registry (`data/equipment_master.json`)

| Asset ID | OSU Equipment ID | Workstation / Asset Name | Shop Zone |
| :--- | :--- | :--- | :--- |
| `MAC-01` | `001` | Bridgeport Series I Manual Knee Mill #1 | Zone 1: Manual Machining (`MAC`) |
| `MAC-02` | `002` | Bridgeport Series I Manual Knee Mill #2 | Zone 1: Manual Machining (`MAC`) |
| `MAC-03` | `003` | Bridgeport Series I Manual Knee Mill #3 | Zone 1: Manual Machining (`MAC`) |
| `MAC-04` | `SHARP-LATHE-01` | Sharp Manual Engine Lathe | Zone 1: Manual Machining (`MAC`) |
| `CNC-01` | `01168375` | KIA 3-Axis CNC Vertical Machining Center | Zone 2: CNC Machining (`CNC`) |
| `CNC-02` | `01191439` | Haas VF-2SS CNC Vertical Machining Center | Zone 2: CNC Machining (`CNC`) |
| `CNC-03` | `HURCO-CNC-01` | Hurco CNC Turning Center / Lathe | Zone 2: CNC Machining (`CNC`) |
| `WLD-01` | `TIG-275-01` | Lincoln Precision TIG 275 Welder | Zone 3: Welding & Thermal Processing (`WLD`) |
| `WLD-02` | `NC090435` | Lincoln Power MIG 255C Welder | Zone 3: Welding & Thermal Processing (`WLD`) |
| `WLD-03` | `PLASMA-CNC-01` | CNC Plasma Table & Hand Plasma Station | Zone 3: Welding & Thermal Processing (`WLD`) |
| `WLD-04` | `THERM-BM-MF` | Thermal Processing Suite: Blue M Industrial Oven & Muffle Furnace | Zone 3: Welding & Thermal Processing (`WLD`) |
| `SAW-01` | `VSAW-01` | Vertical Metal Cutting Bandsaw | Zone 4: Cutting, Saws & Drilling (`SAW`) |
| `SAW-02` | `747061` | Horizontal Wet/Dry Drop Bandsaw | Zone 4: Cutting, Saws & Drilling (`SAW`) |
| `SAW-03` | `CHOP-01` | Abrasive Chop Saw | Zone 4: Cutting, Saws & Drilling (`SAW`) |
| `SAW-04` | `MITER-JET-DP` | 10" Bevel Compound Miter Saw & JET Industrial Drill Presses | Zone 4: Cutting, Saws & Drilling (`SAW`) |
| `FAB-01` | `15-015M1` | General International 15-015M1 6"x48" Belt / 12" Disc Sander | Zone 5: Fabrication, Sheet Metal & Abrasive (`FAB`) |
| `FAB-02` | `01166873` | Grizzly G0767 4"x79" Tube Notcher, Tennsmith HBU48-16 Hand Brake & Industrial Shear | Zone 5: Fabrication, Sheet Metal & Abrasive (`FAB`) |
| `FAB-03` | `GRIND-PED-01` | Pedestal Bench Top Grinders & De-burring Station | Zone 5: Fabrication, Sheet Metal & Abrasive (`FAB`) |
| `FAB-04` | `BLAST-PRESS-10T20T` | Abrasive Blast Cabinet & Hydraulic Shop Presses (Enerpac IPH1234 10-Ton & Redline 20-Ton) | Zone 5: Fabrication, Sheet Metal & Abrasive (`FAB`) |
| `FAC-01` | `FAC-SAFETY-01` | General Shop Safety, LOTO Station, Battery Activity Zone & Paint/Prep Booth | Zone 6: Facility & Infrastructure (`FAC`) |
| `FAC-02` | `FAC-AIR-02` | Shop Compressed Air System & Distribution Drops | Zone 6: Facility & Infrastructure (`FAC`) |

---

## 4. Deep-Linking & Printable `2" × 3"` QR Decal Workflow

- **Asset Hub Modal Deep-Links:**
  - `?asset=MAC-01` — Opens Bridgeport #1 Unified Modal (defaults to Tab 1: Report Condition / Fault)
  - `?asset=CNC-02&tab=sop` — Opens Haas VF-2SS directly to Tab 2: Standard Operating Procedure (SOP)
  - `?asset=WLD-04&tab=loto` — Opens Blue M Oven & Muffle Furnace directly to Tab 3: LOTO Procedure
  - `?asset=FAB-01&tab=pm` — Opens General International 6"×48" Sander directly to Tab 4: Monthly PM Checklist
- **Printing `2" × 3"` 3-in-1 Machine Decals:**
  1. Click **🏷️ 2"×3" QR Decals** in the top navigation bar (or visit `?view=qr`).
  2. Verify the **Production Base URL** and click **Regenerate QR Codes**.
  3. Click **🖨️ Print 2"×3" QR Decal Sheet** (enable **Background graphics** in the browser print dialog).
