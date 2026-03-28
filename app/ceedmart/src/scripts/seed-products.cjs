/**
 * Ceedmart Product Seed Script
 *
 * Seeds Medusa DB with products from all 5 inventory tabs:
 *   1. Gadgets (Chromebooks, Laptops, Monitors, PCs, Phones, Tablets)
 *   2. CCTV Cameras
 *   3. Solar Panels
 *   4. Solar Batteries
 *   5. Power Stations
 *
 * Data is embedded as CSV — no XLSX dependency needed.
 *
 * Usage:
 *   node app/ceedmart/src/scripts/seed-products.cjs
 */

const pg = require("pg")
const crypto = require("crypto")

const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/ceedmart"

// These will be looked up from the DB at runtime
let SALES_CHANNEL_ID = null
let REGION_ID = null
let SHIPPING_PROFILE_ID = null
const CURRENCY_CODE = "ngn"

// ---------------------------------------------------------------------------
// ID generators (match Medusa prefix conventions)
// ---------------------------------------------------------------------------
function uid() {
  return crypto.randomBytes(12).toString("base64url").replace(/[_-]/g, "x")
}
const catId = () => `pcat_${uid()}`
const prodId = () => `prod_${uid()}`
const varId = () => `variant_${uid()}`
const optId = () => `opt_${uid()}`
const optValId = () => `optval_${uid()}`
const priceSetId = () => `priceset_${uid()}`
const priceId = () => `price_${uid()}`
const invItemId = () => `iitem_${uid()}`
const invLevelId = () => `ilev_${uid()}`
const linkId = () => `link_${uid()}`
const tagId = () => `ptag_${uid()}`
const typeId = () => `ptyp_${uid()}`
const colId = () => `pcol_${uid()}`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseWeight(w) {
  if (!w) return null
  const s = String(w).replace(/[^0-9.]/g, "")
  const n = parseFloat(s)
  return isNaN(n) ? null : Math.round(n)
}

function parsePrice(p) {
  if (!p) return null
  const s = String(p).replace(/[^0-9.]/g, "")
  const n = parseFloat(s)
  return isNaN(n) ? null : Math.round(n)
}

function slugify(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100)
}

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields with commas and newlines)
// ---------------------------------------------------------------------------
function parseCSV(csv) {
  const rows = []
  let headers = null
  let current = ""
  let inQuotes = false
  const lines = []

  // Split into logical lines (respecting quoted newlines)
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && i + 1 < csv.length && csv[i + 1] === "\n") i++
      if (current.trim()) lines.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  if (current.trim()) lines.push(current)

  if (lines.length === 0) return []
  headers = parseCSVLine(lines[0])

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const row = {}
    for (let j = 0; j < headers.length; j++) {
      const val = (values[j] || "").trim()
      row[headers[j].trim()] = val || null
    }
    rows.push(row)
  }
  return rows
}

function parseCSVLine(line) {
  const result = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ",") {
        result.push(current.trim())
        current = ""
      } else {
        current += ch
      }
    }
  }
  result.push(current.trim())
  return result
}

// ===========================================================================
// EMBEDDED DATA — All 5 tabs from the Ceedmart inventory spreadsheet
// ===========================================================================

const GADGETS_CSV = `Availability,Category,Item ID,Brand,Model,SIM Type,Processor,RAM (GB),SSD (GB / TB),HDD (GB / TB),Graphics Card,Graphics Memory,Screen Size,Resolution,Clock Speed (GHz),Operating System,Weight (lb),Reseller Price,Retail Price,Stock Quantity,Form Factor,Power Supply,Camera,Battery Capacity,Type (Inkjet/Laser),Print Speed,Connectivity,Paper Size,Duplex Printing,RAID Support,Network Interfaces,Refresh Rate,Panel Type,Connectivity Ports
Out of stock,Chromebook,,Dell,Chrome 1,,,Intel Celeron 4000,4,32GB,,Intel UHD 600,,11.6,1366 x 768,2.6,Chrome OS,2.8,"70,000","80,000",23,Grey,Yes,Yes,,,,,,,,,,
Out of stock,Chromebook,,Samsung,,,,4,,,Intel UHD 600,,11.6,1366 x 768,2.6,Chrome OS,2.4,"70,000","80,000",11,Silver,,,,,,,,,,,,,
Out of stock,Chromebook,,HP,,,,4,,,Intel UHD 600,,11.6,1366 x 768,2.6,Chrome OS,2.6,"70,000","80,000",7,Grey,,,,,,,,,,,,,
Out of stock,Chromebook,,Dell,Chrome 2 5190,,,4,,,Intel UHD 600,,11.6,1366 x 768,2.6,Chrome OS,2.8,"70,000","80,000",5,Grey,,,,,,,,,,,,,
Out of stock,Laptop,,Dell,Latitude E5470,,Core i5 7th gen,8,256GB,,Intel HD 620,128MB,14,1920 x 1080,2.7,Windows 11 Pro,3.6,"210,000","250,000",2,Black,Yes,Yes,,,,,,,,,,
Out of stock,Laptop,,Dell,Latitude E5470,,Core i7 6th gen,8,256GB,,Intel HD 620,128MB,14,1920 x 1080,2.8,Windows 11 Pro,3.6,"230,000","270,000",1,Black,Yes,Yes,,,,,,,,,,
Out of stock,Laptop,,Dell,Latitude E5470,,,16,256GB,,,,14,1920 x 1080,2.7,Windows 11 Pro,3.6,"220,000","250,000",1,Black,Yes,Yes,,,,,,,,,,
Out of stock,Laptop,,Dell,Precision 3561,,Core i7 11th gen,64,1.2TB,,NVIDIA T600,4GB,15.6,1920 x 1080,2.5,Windows 11 Pro,4.6,"900,000","1,000,000",1,Silver,Yes,Yes,,,,,,,,,,
Out of stock,Laptop,,Lenovo,Thinkpad E595,,AMD Ryzen 5,8,256GB,,AMD Radeon Vega 8,,15.6,1920 x 1080,2.1,Windows 11 Pro,4.6,"240,000","280,000",1,Black,Yes,Yes,,,,,,,,,,
Out of stock,Laptop,,Apple,MacBook Pro,,M1 Max,32,512GB,,Integrated 32-Core,,16,3456 x 2234,3.2,MacOS Sequoia,4.7,"1,750,000","1,900,000",1,Silver,Yes,Yes,,,,,,,,,,
Out of stock,Laptop,,Apple,MacBook Pro,,M1 Pro,16,512GB,,Integrated 16-Core,,16,3456 x 2234,3.2,MacOS Sequoia,4.7,"1,350,000","1,450,000",2,Silver,Yes,Yes,,,,,,,,,,
Out of stock,Laptop,,Apple,MacBook Air,,M1 Pro,8,256GB,,Integrated 8-Core,,13.3,2560 x 1600,3.2,MacOS Ventura,4.7,"700,000","750,000",1,Silver,Yes,Yes,,,,,,,,,,
Out of stock,All-in-one,,Dell,Optiplex 7470 AIO,,Core i7 9th Gen,16,512GB,,Integrated UHD 630,128MB,23.8,1920 x 1080,3,Windows 11 Pro,13.3,"800,000","900,000",1,Black,Yes,No,,,,,,,,,,
Out of stock,All-in-one,,Dell,Optiplex 7470 AIO,,Core i7 9th Gen,16,512GB,,,,23.8,1920 x 1080,3,Windows 11 Pro,13.3,"800,000","900,000",2,Black,Yes,No,,,,,,,,,,
Out of stock,Monitor,,Dell,Dell 22 Monitor,,,,,,,,22,1920 x 1080,,,8.36,"70,000","80,000",1,Black,Yes,,,,,,,,,,,
Out of stock,Monitor,,Dell,Dell 24 Monitor,,,,,,,,24,1920 x 1080,,,8.8,"100,000","120,000",1,Black,Yes,,,,,,,,,,,
Out of stock,Monitor,,HP,HP 23.8 Monitor,,,,,,,,24,1920 x 1080,,,10.25,"100,000","120,000",1,Black,Yes,,,,,,,,,,,
Out of stock,PC Towers,,Dell,Precision Tower 5810,,Xeon E5-1650 v4,32,1.2TB,,NVIDIA GTX 1070,8GB,,,3.6,Windows 11 Pro,30,"500,000","600,000",1,Black,Yes,,,,,,,,,,,
Out of stock,PC Towers,,Dell,XPS 8930,,Core i7 8th Gen,16,256GB,512GB,NVIDIA GTX 1050 Ti,4GB,,,3.2,Windows 11 Pro,22.3,"600,000","700,000",2,Black,Yes,,,,,,,,,,,
Out of stock,PC Towers,,Dell,Precision Tower 3420,,Core i7 7th Gen,32,512GB,,,,,,3.6,Windows 11 Pro,11.8,"350,000","400,000",1,Black,Yes,,,,,,,,,,,
Out of stock,PC Towers,,Dell,XPS 8900,,Core i7 6th Gen,16,512GB,,NVIDIA GTX 1660,6GB,,1366 x 768,3.4,Windows 11 Home,25.8,"500,000","600,000",1,Black,Yes,,,,,,,,,,,
Out of stock,iPhone,,Apple,iPhone 16 Pro,ESIM,,8,256GB,,,,6.3,2622 x 1206,,iOS,1,"1,400,000","1,500,000",3,"Silver, Grey",Yes,Yes,92%,,,,,,,,,,
Out of stock,iPhone,,Apple,iPhone 16 Pro,ESIM,,8,512GB,,,,6.3,2622 x 1206,,iOS,1,"1,600,000","1,700,000",1,Gold,Yes,Yes,93%,,,,,,,,,,
Out of stock,iPhone,,Apple,iPhone 16 Pro Max,ESIM,,8,256GB,,,,6.9,2868 x 1320,,iOS,1,"1,500,000","1,600,000",1,Gold,Yes,Yes,93%,,,,,,,,,,
Out of stock,iPhone,,Apple,iPhone 16 Pro Max,ESIM,,8,512GB,,,,6.9,2868 x 1320,,iOS,1,"1,700,000","1,800,000",1,Black,Yes,Yes,100%,,,,,,,,,,
Out of stock,iPhone,,Apple,iPhone 13 Pro,"ESIM, NanoSIM",,8,256GB,,,,6.1,2532 x 1170,,iOS,1,"700,000","750,000",1,Gold,Yes,Yes,83%,,,,,,,,,,
Out of stock,iPad,,Apple,iPad Air 4th Gen,,,8,128GB,,,,10.9,2360 x 1640,,iOS,1,"420,000","500,000",1,Silver,Yes,Yes,,,,,,,,,,
Out of stock,iPhone,,Apple,iPhone 12,NanoSIM,,4,128GB,,,,6.1,2532 x 1170,,iOS,1,"325,000","350,000",3,Black,Yes,Yes,,,,,,,,,,
In stock,Laptop,,Lenovo,Thinkpad E15 Gen 2,,Core i7 11th Gen,32,512GB,,Intel XE Graphics,128MB,15,1920 x 1080,,Windows 11 Pro,3.75,,,2,Black,Yes,Yes,,,,,,,,,,
In stock,Laptop,,Lenovo,Thinkpad X1 Gen 9,,Core i7 11th Gen,16,512GB,,Intel XE Graphics,128MB,14,1920 x 1080,3,Windows 11 Pro,3,,,1,Black,Yes,Yes,,,,,,,,,,
In stock,Laptop,,Lenovo,Ideapad 5,,AMD Ryzen 7,16,512GB,,AMD Radeon Graphics,512MB,14,1920 x 1080,2,Windows 11 Pro,3,,,1,Grey,Yes,Yes,,,,,,,,,,
In stock,Laptop,,Lenovo,Yoga 7 2 in 1,,AMD Ryzen 7,16,1TB,,AMD Radeon 780M,2GB,14,1920 x 1080,3.3,Windows 11 Pro,3,,,14,Silver,Yes,Yes,,,,,,,,,,
In stock,Thin Client,,Dell,Optiplex 3040,,Core i5,8,256GB,,,,,,,Windows 11 Pro,2.82,,,,Black,,Yes,,,,,,,,,,,`

const CCTV_CSV = `NAME,MODEL,CAMERA TYPE,PRICE,POWER TYPE,CONNECTIVITY,STORAGE TYPE,RESOLUTION,LENS,USE CASE,NIGHT VISION
Hikvision,DS-2CD1043G0-I,"Bullet, fixed lens, network/IP camera",,PoE/12V,Ethernet,NVR,4MP,4mm fixed lens,Outdoor,EXIR IR
Hikvision,7200 series,Turbo HD/ Analog,,12V DC,Ethernet/BNC,NVR,1080p,none,indoor,none
Dahua (ECO series),IR Bullet network camera,IR Bullet IP camera,,PoE/12V DC,Ethernet,NVR,,Fixed (2.8mm/3.6mm),Outdoor,IR
Dahua,Smart dual light PT network camera,PTZ IP,,PoE/12V DC,Ethernet,NVR,4mp,motorized zoom,Outdoor,Dual
Dahua (ECO series),Smart Dual Light network camera,Network / IP Camera,,PoE / 12V DC,Ethernet,NVR/ MicroSD,2MP or 4MP,Fixed (2.8mm / 3.6mm),Outdoor,Dual Light (IR + White LED)
Dahua,HDCVI IR Bullet Camera,IR Bullet Camera (Analog / HDCVI),,12V DC,BNC (coaxial cable)/ DC power cable,DVR,5MP,Fixed lens,Outdoor,IR
UNV Uniview,,Analog Bullet Camera,,12V DC,BNC / Coaxial Cable,DVR,2MP,2.8mm Fixed Lens,Indoor/outdoor,IR
Zeevision,V380,Wi-Fi Smart IP Camera,,USB/5V DC,Wireless Wi-Fi (2.4 GHz),MicroSD / Cloud,1080p,Fixed (~2.8 mm),Indoor,IR
HikVision,Two-Way Audio Fixed Network Camera,Fixed IP Camera,,PoE / 12V DC,Ethernet,NVR / MicroSD,,Fixed (2.8mm / 4mm),Outdoor/indoor,IR
UNV (Uniview),ColorHunter Camera,IP Network Camera,,PoE / 12V DC,Ethernet,NVR / (MicroSD optional),,Fixed (2.8mm / 3.6mm),Outdoor/indoor,ColorHunter Full-color night vision
HikVision,DS-2CE76KOT-LPFS,HD-TVI / Analog Hybrid Bullet Camera,,12V DC,BNC (Coaxial) + Power Cable,DVR,8MP,2.8 mm Fixed,Outdoor,IR + White Light
HikVision,DS-2CE16DOT-LPFS,Turbo HD Analog Bullet,,12V DC,BNC / Coax,DVR,2MP,Fixed (2.8mm),Indoor,IR + White Light
Hilook,THC-T120-PIC,Fixed turret (analog HD),,12 V DC,Analog HD output (TVI),DVR/NVR,2MP,2.8 mm or 3.6 mm fixed lens,Indoor,IR`

const SOLAR_PANELS_CSV = `BRAND AND MODEL,POWER RATING,OPEN CIRCUIT VOLTAGE,ISC,VOLTAGE,AMPERE,EFFICIENCY,TEMPERATURE COEFFICIENT,WEIGHT,WARRANTY,CERTIFICATION
RT6C-M-250-275W,"250W,255W,260W,265W,270W,275W","37.1V,37.2V,37.4,38.1V,38.6V,38.8V","8.74A,8.89A,9.02A,9.03A,9.07A,9.20A","30.02V,30.11V,30.27V,30.85V,31.26V,31.40V","8.33A,8.47A,8.59A,8.59A,8.64,8.76A","15.37,15.67,15.98,16.29,16.60,16.90",-0.32,19KG,,
RT6C-M-280-305W,"280W,285W,290W,295W,300W,305W","39.03V,39.12V,39.21V,39.3V,38.85V,40.53V",,"31.70V,32.0V,32.30V,32.60V,32.90V,32.95V","8.85A,8.91A,8.98A,9.05A,9.12A,9.27A","17.21,17.52,17.83,18.13,18.44,18.74",-0.32,19KG,,
RT9H-M-DG,"725W,730W,735W,740W,745W,750W",,,,"17.47A,17.51A,17.55A,17.58,17.62,17.65","23.34,23.50,23.66,23.82,23.98,24.14",-0.25,38.5KG,15 YEAR/30 YEAR POWER,IEC 61215/61730
RT6D-M,"190W,195W,200W,205W,210W","44.5V,44.5V,44.5V,45.1V,45.4V","5.52A,5.66A,5.81A,5.88A,5.98A","36.5V,36.6V,36.7V,36.8V,37V","5.21A,5.33A,5.45A,5.58A,5.68A","14.88,15.27,15.67,16.06,16.45",-0.32,13KG,,
MULTI-CUT CELLS MONO,"30W,40W,50W,60W,80W","19.8V,22.1V,24.6V,17.2V,22.1V","2.06A,2.44A,2.75A,4.71A,4.88A","16V,18V,20V,14V,18V","1.88A,2.22A,2.5A,4.29A,4.44A",,-35,3KG,,
RT8L-M,"570W,575W,580W,585W,590W","53.30,53.44,53.59,53.73,53.87","13.65,13.72,13.79,13.86,13.93","44.68,44.82,44.97,45.11,45.25","12.76,12.83,12.90,12.97,13.04","20.39,20.57,20.75,20.93,21.11",-0.25,31.5KG,,
RT6E-150M,150W,22.7V,8.58A,18.4V,8.16A,15.16,-0.32,11.5KG,,
RTM120M,120W,24.30V,6.30A,20.41V,5.88A,15.43,-0.32,6.8KG,,
RTM-100M,100W,21.95V,5.37A,17.90V,5.59A,15.44,-0.32,7KG,,
RT6C-P,"250W,255W,260W,265W,270W,275W,280W,285W","37.3,37.5,37.7,37.8,37.9,38.1,38.2,38.3","8.81,8.88,8.95,9.01,9.76,9.32,9.40,9.49","29.9,30.1,30.3,30.3,30.7,31.1,31.4,31.6","8.36,8.47,8.58,8.69,8.79,8.84,8.92,9.02","15.40,15.70,16.01,16.32,16.60,16.80,17.10",-0.32,19KG,,
RT6S-M,"345W,350W,355W,360W,365W,370W","46.25,46.41,46.85,47.12,48.2,48.5","9.58,9.67,9.72,9.78,9.84,9.93","38.3,38.64,38.98,39.31,39.7,39.9","9.01,9.06,9.11,9.16,9.20,9.28","17.78,18.04,18.30,18.55,18.81,19.07",-0.32,22KG,,
RT6E-150P,150W,22.3V,8.82A,17.91V,8.38A,15.29,-0.32,11.5KG,,
RT6S-P,"300W,305W,310W,315W,320W","45.3,45.51,45.71,45.81,45.9","8.66,8.82,8.87,8.97,9.08","36.5,36.5,36.87,37.06,37.3","8.22,8.36,8.50,8.58,8.61","15.46,15.71,15.97,16.23,16.49",-0.32,22KG,,
RTM-100P,100W,21.58V,6.04A,17.40V,5.75A,15.44,-0.32,7KG,,
MULTIPLE CUT CELLS POLY,"3W,5W,10W,20W,30W,40W,50W,60W,80W",,,,,,,,,
RT6E170M,170W,24.5V,8.94A,20.44V,8.32A,18.67,-0.32,9.5KG,,
RT9H-M-BD,"670W,675W,680W,685W,690W","46.10,46.30,46.50,46.70,46.90","18.62,18.67,18.72,18.77,18.82","38.20,38.40,38.60,38.80,39.00","17.54,17.58,17.62,17.66,17.70","21.57,21.73,21.89,33.05,22.21",-0.25,33.6KG,,
RT8V-M FULL BLACK,"410W,415W","37.32,37.45","13.95,14.02","31.45,31.61","13.04,13.13","21.00,21.35",-0.32,22KG,,
RT200M 12BB,200W,22.55V,11.45A,18.86V,10.61A,19.57,-0.32,11.2KG,,`

const SOLAR_BATTERIES_CSV = `BRAND AND MODEL,CAPACITY,BATTERY TYPE,BATTERY CHEMISTRY,DEPTH OF DISCHARGE,WEIGHT,MAX CHARGE RATE,WARRANTY,CERTIFICATION,VOLTAGE
YF-LFP-4.8KWH,4.8KWH,LITHIUM,LIFEPO4,90%,,100A,6 YEARS,"CE,IEC62619",48V
YF-LFP-256100,2560WH,LITHIUM,LIFEPO4,90%,20.8KG,100A,3 YEARS,"CE,IEC62619",25.6V
YF-LFP-12875,960WH,LITHIUM,LIFEPO4,80%,7.7KG,35A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-5KWH-24V,5KWH,LITHIUM,LIFEPO4,95%,51KG,110A@5S,6 YEARS,"CE,IEC62619",25.6V
YF-LFP-5KWH,5KWH,LITHIUM,LIFEPO4,90%,58.5KG,110A@5S,6 YEARS,"CE,IEC62619",48V
YF-LFP-28.8KWH,28.8KWH,LITHIUM,LIFEPO4,90%,,100A,6 YEARS,"CE,IEC62619",48V
YF-LFP-128.85KWH,192WH,LITHIUM,LIFEPO4,80%,1.4KG,8A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-10.5KWH,10.5KWH,LITHIUM,LIFEPO4,90%,96.2KG,110A@5S,6 YEARS,"CE,IEC62619",48V
YF-LFP-67.2KWH,67.2KWH,LITHIUM,LIFEPO4,90%,,100A,6 YEARS,"CE,IEC62619",48V
YF-LFP-12830KH,384WH,LITHIUM,LIFEPO4,80%,2.8KG,15A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-15KWH,15KWH,LITHIUM,LIFEPO4,90%,122.1KG,160A@5S,6 YEARS,"CE,IEC62619",48V
YF-LFP-16KWH,16KWH,LITHIUM,LIFEPO4,90%,120KG,160A@5S,6 YEARS,"CE,IEC62619",48V
YF-LFP-12845KWH,576WH,LITHIUM,LIFEPO4,80%,4.3KG,23A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-5KWH,5KWH,LITHIUM,LIFEPO4,95%,58KG,110@5S,6 YEARS,"CE,IEC62619",48V
YF-LFP-12860,768WH,LITHIUM,LIFEPO4,80%,5.6KG,30A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-10.5KWH,10.5KWH,LITHIUM,LIFEPO4,95%,96KG,110@5S,6 YEARS,"CE,IEC62619",48V
YF-LFP-21.5KWH,21.5KWH,LITHIUM,LIFEPO4,90%,197KG,210@5S,6 YEARS,"CE,IEC62619",51.2V
YF-LFP-12875,960WH,LITHIUM,LIFEPO4,80%,7.7KG,35A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-30KWH,30KWH,LITHIUM,LIFEPO4,90%,256KG,210A@5S,6 YEARS,"CE,IEC62619",51.2V
YF-LFP-15KWH,15KWH,LITHIUM,LIFEPO4,95%,122KG,160A@5S,6 YEARS,"CE,IEC62619",48V
YF-LFP-128100,1280WH,LITHIUM,LIFEPO4,80%,9.9KG,50A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-128120,1536WH,LITHIUM,LIFEPO4,80%,11.5KG,60A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-128150,1920WH,LITHIUM,LIFEPO4,80%,15KG,75A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-128200,2560WH,LITHIUM,LIFEPO4,90%,20.8KG,100A,3 YEARS,"CE,IEC62619",12.8V
YF-LFP-128314,4190WH,LITHIUM,LIFEPO4,90%,25.3KG,200A,3 YEARS,"CE,IEC62619",12.8V
HS-LD15KW-A2,15.6KWH,ENERGY STORAGE,LIFEPO4,,117.5KG,100A,5 YEARS,,61.2V
HS-LD4000W,4019.2WH,HOUSEHOLD ENERGY STORAGE,LIFEPO4,,26.5KG,75A,5 YEARS,,12.8V
HS-LD8000W,8038.4WH,HOUSEHOLD ENERGY STORAGE,LIFEPO4,,26.5KG,75A,5 YEARS,,25.6V`

const POWER_STATIONS_CSV = `MODEL,BATTERY CHEMISTRY,CAPACITY,AC INPUT,SOLAR INPUT,AC OUTPUT,CHARGING OPTIONS,WEIGHT,WARRANTY,LIFTING POWER
ELITE 400,LIFEPO4,3840WH,1800W,1000W,2600W,AC/SOLAR/CAR/GEN/LEAD ACID,39 KG,5 YEARS,3900W
ELITE 200V2,LIFEPO4,2073.6WH,1800W,1000W,2600W,PASS-THROUGH CHARGING,24.2KG,5 YEARS,3900W
ELITE 100 V2,LIFEPO4,1024WH,1200W,100W,1800W,AC/PV/CAR/GEN/AC/PV,11.5KG,5 YEARS,2700W
ELITE 30 V2,LIFEPO4,288WH,980W,200W,600W,AC/PV/CAR/GEN/AC/PV,4.3KG,5 YEARS,1500W
ELITE 10,LIFEPO4,128WH,150W/350W,100W,200W,AC/SOLAR/AC/SOLAR/CAR,1.8KG,3 YEARS,400W
AC200L,LIFEPO4,2048WH,2400WH,1200WH,2400WH,PASS THROUGH CHARGING,28.3KG,5 YEARS,3600W
AC180P,LIFEPO4,1440WH,1440W,500W,1880W,AC/SOLAR/CAR/GENERATOR,17KG,5 YEARS,PORTABLE
AC180,LIFEPO4,1152WH,1440W,500W,1880W,AC/SOLAR/CAR/GENERATOR,17KG,5 YEARS,PORTABLE
AC50B,LIFEPO4,448WH,,,700W,AC/SOLAR/CAR/GENERATOR/B80 OR DUAL AC,14.8LBS,5 YEARS,1000W
AC2A,LIFEPO4,204WH,270W,200W,300W,SOLAR/AC/LEAD ACID BATTERY/CAR,10.1LBS,5 YEARS,PORTABLE
EB3A,LIFEPO4,268WH,350W,200W,600W,SOLAR/AC/LEAD ACID BATTERY/CAR,7.9LBS,5 YEARS,PORTABLE
EB55,LIFEPO4,537WH,200W,200W,700W,SOLAR/AC/LEAD ACID BATTERY/CAR,16.5LBS,5 YEARS,PORTABLE
AC70,LIFEPO4,768WH,950W,500W,1000WH,SOLAR/AC/CAR,22.5LBS,5 YEARS,PORTABLE
EB70S,LIFEPO4,716WH,200W,500W,800W,SOLAR/AC/CAR,21.4LBS,5 YEARS,PORTABLE
AC60,LIFEPO4,403WH,600W,200W,600W,SOLAR/AC/CAR,20.1LBS,5 YEARS,PORTABLE`

// ---------------------------------------------------------------------------
// Read data from each tab
// ---------------------------------------------------------------------------
function readGadgets() {
  const rows = parseCSV(GADGETS_CSV)
  return rows.filter((r) => r.Brand && r.Brand.trim() && r.Model && r.Model.trim())
}

function readCCTV() {
  const rows = parseCSV(CCTV_CSV)
  return rows.filter((r) => (r.NAME && r.NAME.trim()) || (r.MODEL && r.MODEL.trim()))
}

function readSolarPanels() {
  const rows = parseCSV(SOLAR_PANELS_CSV)
  return rows.filter((r) => r["BRAND AND MODEL"] && r["BRAND AND MODEL"].trim())
}

function readSolarBatteries() {
  const rows = parseCSV(SOLAR_BATTERIES_CSV)
  return rows.filter((r) => r["BRAND AND MODEL"] && r["BRAND AND MODEL"].trim())
}

function readPowerStations() {
  const rows = parseCSV(POWER_STATIONS_CSV)
  return rows.filter((r) => r.MODEL && r.MODEL.trim())
}

// ---------------------------------------------------------------------------
// Build category tree
// ---------------------------------------------------------------------------
function buildCategories(gadgetRows) {
  const gadgetSubcats = [...new Set(gadgetRows.map((r) => r.Category).filter(Boolean))]

  const topCats = [
    { name: "Gadgets", handle: "gadgets", children: gadgetSubcats },
    { name: "CCTV Cameras", handle: "cctv-cameras", children: [] },
    { name: "Solar Energy", handle: "solar-energy", children: ["Solar Panels", "Solar Batteries"] },
    { name: "Power Solutions", handle: "power-solutions", children: ["Power Stations"] },
  ]

  const categories = []
  const catMap = {}

  for (const tc of topCats) {
    const id = catId()
    categories.push({
      id,
      name: tc.name,
      handle: tc.handle,
      parent_category_id: null,
      mpath: `${id}.`,
      is_active: true,
      is_internal: false,
      rank: categories.length,
    })
    catMap[tc.name] = id

    for (const child of tc.children) {
      const cid = catId()
      const childHandle = slugify(child)
      categories.push({
        id: cid,
        name: child,
        handle: childHandle,
        parent_category_id: id,
        mpath: `${id}.${cid}.`,
        is_active: true,
        is_internal: false,
        rank: categories.length,
      })
      catMap[child] = cid
    }
  }

  return { categories, catMap }
}

// ---------------------------------------------------------------------------
// Build product types & collections
// ---------------------------------------------------------------------------
function buildTypesAndCollections() {
  const types = [
    { id: typeId(), value: "Electronics" },
    { id: typeId(), value: "Mobile" },
    { id: typeId(), value: "Security" },
    { id: typeId(), value: "Solar" },
    { id: typeId(), value: "Power" },
  ]
  const typeMap = {}
  for (const t of types) typeMap[t.value] = t.id

  const collections = [
    { id: colId(), title: "Computers & Laptops", handle: "computers-laptops" },
    { id: colId(), title: "Mobile Devices", handle: "mobile-devices" },
    { id: colId(), title: "Monitors & Displays", handle: "monitors-displays" },
    { id: colId(), title: "Desktops & Towers", handle: "desktops-towers" },
    { id: colId(), title: "CCTV & Security", handle: "cctv-security" },
    { id: colId(), title: "Solar Energy", handle: "solar-energy" },
    { id: colId(), title: "Power Solutions", handle: "power-solutions" },
  ]
  const colMap = {}
  for (const c of collections) colMap[c.title] = c.id

  return { types, typeMap, collections, colMap }
}

// ---------------------------------------------------------------------------
// Build products from all 5 tabs
// ---------------------------------------------------------------------------
function buildProducts(catMap, typeMap, colMap) {
  const products = []
  const variants = []
  const options = []
  const optionValues = []
  const variantOptions = []
  const priceSets = []
  const prices = []
  const inventoryItems = []
  const inventoryLevels = []
  const variantPriceSets = []
  const variantInventoryItems = []
  const productCategories = []
  const productSalesChannels = []
  const productShippingProfiles = []

  const usedHandles = new Set()
  function uniqueHandle(base) {
    let h = slugify(base)
    if (!h) h = "product"
    let candidate = h
    let counter = 1
    while (usedHandles.has(candidate)) {
      candidate = `${h}-${counter++}`
    }
    usedHandles.add(candidate)
    return candidate
  }

  function addProduct({ title, handle, subtitle, description, weight, metadata, categoryNames, typeName, collectionTitle, status }) {
    const pid = prodId()
    const h = uniqueHandle(handle || title)

    products.push({
      id: pid,
      title,
      handle: h,
      subtitle: subtitle || null,
      description: description || null,
      is_giftcard: false,
      status: status || "published",
      weight: weight || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      collection_id: collectionTitle ? colMap[collectionTitle] || null : null,
      type_id: typeName ? typeMap[typeName] || null : null,
      discountable: true,
      origin_country: "NG",
    })

    for (const cn of categoryNames || []) {
      if (catMap[cn]) {
        productCategories.push({ product_id: pid, product_category_id: catMap[cn] })
      }
    }

    productSalesChannels.push({
      id: linkId(),
      product_id: pid,
      sales_channel_id: SALES_CHANNEL_ID,
    })

    productShippingProfiles.push({
      id: linkId(),
      product_id: pid,
      shipping_profile_id: SHIPPING_PROFILE_ID,
    })

    return pid
  }

  function addVariant({ productId, title, sku, weight, resellerPrice, retailPrice, stockQty, metadata }) {
    const vid = varId()

    variants.push({
      id: vid,
      title: title || "Default",
      sku: sku || null,
      product_id: productId,
      weight: parseWeight(weight),
      manage_inventory: true,
      allow_backorder: false,
      variant_rank: 0,
      metadata: metadata ? JSON.stringify(metadata) : null,
    })

    const psid = priceSetId()
    priceSets.push({ id: psid })
    variantPriceSets.push({ id: linkId(), variant_id: vid, price_set_id: psid })

    if (retailPrice && !isNaN(retailPrice)) {
      const amt = Math.round(Number(retailPrice))
      prices.push({
        id: priceId(),
        price_set_id: psid,
        currency_code: CURRENCY_CODE,
        amount: amt,
        raw_amount: JSON.stringify({ value: String(amt), precision: 20 }),
        title: "Retail",
      })
    }

    if (resellerPrice && !isNaN(resellerPrice)) {
      const amt = Math.round(Number(resellerPrice))
      prices.push({
        id: priceId(),
        price_set_id: psid,
        currency_code: CURRENCY_CODE,
        amount: amt,
        raw_amount: JSON.stringify({ value: String(amt), precision: 20 }),
        title: "Reseller",
      })
    }

    if (stockQty !== null && stockQty !== undefined && !isNaN(stockQty)) {
      const iiid = invItemId()
      const ilid = invLevelId()
      const qty = Math.max(0, Math.round(Number(stockQty)))

      inventoryItems.push({
        id: iiid,
        sku: sku || null,
        title: title || "Default",
        requires_shipping: true,
        weight: parseWeight(weight),
      })

      inventoryLevels.push({
        id: ilid,
        inventory_item_id: iiid,
        location_id: "sloc_ceedmart_default",
        stocked_quantity: qty,
        reserved_quantity: 0,
        incoming_quantity: 0,
        raw_stocked_quantity: JSON.stringify({ value: String(qty), precision: 20 }),
        raw_reserved_quantity: JSON.stringify({ value: "0", precision: 20 }),
        raw_incoming_quantity: JSON.stringify({ value: "0", precision: 20 }),
      })

      variantInventoryItems.push({
        id: linkId(),
        variant_id: vid,
        inventory_item_id: iiid,
        required_quantity: 1,
      })
    }

    return vid
  }

  function addOption(productId, optTitle, optValue) {
    let opt = options.find((o) => o.product_id === productId && o.title === optTitle)
    if (!opt) {
      opt = { id: optId(), title: optTitle, product_id: productId }
      options.push(opt)
    }
    let ov = optionValues.find((v) => v.option_id === opt.id && v.value === optValue)
    if (!ov) {
      ov = { id: optValId(), value: optValue, option_id: opt.id }
      optionValues.push(ov)
    }
    return ov.id
  }

  function linkVariantOption(variantId, optionValueId) {
    variantOptions.push({ variant_id: variantId, option_value_id: optionValueId })
  }

  // -----------------------------------------------------------------------
  // 1. GADGETS
  // -----------------------------------------------------------------------
  const gadgets = readGadgets()
  console.log(`  Gadgets: ${gadgets.length} rows`)
  for (const row of gadgets) {
    const brand = (row.Brand || "").trim()
    const model = (row.Model || "").trim()
    const category = (row.Category || "").trim()
    const title = model ? `${brand} ${model}` : brand
    if (!title) continue

    const metadata = {}
    if (row.Processor) metadata.processor = row.Processor
    if (row["RAM (GB)"]) metadata.ram_gb = row["RAM (GB)"]
    if (row["SSD (GB / TB)"]) metadata.ssd = row["SSD (GB / TB)"]
    if (row["HDD (GB / TB)"]) metadata.hdd = row["HDD (GB / TB)"]
    if (row["Graphics Card"]) metadata.graphics_card = row["Graphics Card"]
    if (row["Graphics Memory"]) metadata.graphics_memory = row["Graphics Memory"]
    if (row["Screen Size"]) metadata.screen_size = row["Screen Size"]
    if (row.Resolution) metadata.resolution = row.Resolution
    if (row["Clock Speed (GHz)"]) metadata.clock_speed_ghz = row["Clock Speed (GHz)"]
    if (row["Operating System"]) metadata.os = row["Operating System"]
    if (row["SIM Type"]) metadata.sim_type = row["SIM Type"]
    if (row["Power Supply"]) metadata.power_supply = row["Power Supply"]
    if (row.Camera) metadata.camera = row.Camera
    if (row["Battery Capacity"]) metadata.battery_capacity = row["Battery Capacity"]
    if (row["Type (Inkjet/Laser)"]) metadata.printer_type = row["Type (Inkjet/Laser)"]
    if (row["Print Speed"]) metadata.print_speed = row["Print Speed"]
    if (row.Connectivity) metadata.connectivity = row.Connectivity
    if (row["Paper Size"]) metadata.paper_size = row["Paper Size"]
    if (row["Duplex Printing"]) metadata.duplex_printing = row["Duplex Printing"]
    if (row["RAID Support"]) metadata.raid_support = row["RAID Support"]
    if (row["Network Interfaces"]) metadata.network_interfaces = row["Network Interfaces"]
    if (row["Refresh Rate"]) metadata.refresh_rate = row["Refresh Rate"]
    if (row["Panel Type"]) metadata.panel_type = row["Panel Type"]
    if (row["Connectivity Ports"]) metadata.connectivity_ports = row["Connectivity Ports"]
    if (row.Availability) metadata.availability = row.Availability
    if (brand) metadata.brand = brand

    const catNames = ["Gadgets"]
    if (category && catMap[category]) catNames.push(category)

    // Map category -> type and collection
    let typeName = "Electronics"
    let collectionTitle = "Computers & Laptops"
    if (category === "iPhone" || category === "iPad") {
      typeName = "Mobile"
      collectionTitle = "Mobile Devices"
    } else if (category === "Monitor") {
      collectionTitle = "Monitors & Displays"
    } else if (category === "All-in-one" || category === "PC Towers") {
      collectionTitle = "Desktops & Towers"
    }

    const description = buildGadgetDescription(row, title)

    const pid = addProduct({
      title,
      handle: title,
      subtitle: category || null,
      description,
      weight: row["Weight (lb)"] ? String(row["Weight (lb)"]) : null,
      metadata,
      categoryNames: catNames,
      typeName,
      collectionTitle,
      status: "published",
    })

    const optValIdDefault = addOption(pid, "Spec", "Default")

    const vid = addVariant({
      productId: pid,
      title: "Default",
      sku: row["Item ID"] || null,
      weight: row["Weight (lb)"],
      resellerPrice: parsePrice(row["Reseller Price"]),
      retailPrice: parsePrice(row["Retail Price"]),
      stockQty: row["Stock Quantity"],
    })

    linkVariantOption(vid, optValIdDefault)

    const color = (row["Form Factor"] || "").trim()
    if (color && ["Grey", "Silver", "Black", "White", "Gold", "Blue", "Red", "Pink", "Green"].some(
      (c) => color.toLowerCase().includes(c.toLowerCase())
    )) {
      const colorOptValId = addOption(pid, "Color", color)
      linkVariantOption(vid, colorOptValId)
    }
  }

  // -----------------------------------------------------------------------
  // 2. CCTV CAMERAS
  // -----------------------------------------------------------------------
  const cctvRows = readCCTV()
  console.log(`  CCTV Cameras: ${cctvRows.length} rows`)
  for (const row of cctvRows) {
    const brand = (row.NAME || "").trim()
    const model = (row.MODEL || "").trim()
    const title = model ? `${brand} ${model}` : brand
    if (!title) continue

    const metadata = {}
    if (row["CAMERA TYPE"]) metadata.camera_type = row["CAMERA TYPE"]
    if (row["POWER TYPE"]) metadata.power_type = row["POWER TYPE"]
    if (row.CONNECTIVITY) metadata.connectivity = row.CONNECTIVITY
    if (row["STORAGE TYPE"]) metadata.storage_type = row["STORAGE TYPE"]
    if (row.RESOLUTION) metadata.resolution = row.RESOLUTION
    if (row.LENS) metadata.lens = row.LENS
    if (row["USE CASE"]) metadata.use_case = row["USE CASE"]
    if (row["NIGHT VISION"]) metadata.night_vision = row["NIGHT VISION"]
    if (brand) metadata.brand = brand

    const description = buildCCTVDescription(row, title)

    const pid = addProduct({
      title,
      handle: title,
      subtitle: row["CAMERA TYPE"] || "CCTV Camera",
      description,
      metadata,
      categoryNames: ["CCTV Cameras"],
      typeName: "Security",
      collectionTitle: "CCTV & Security",
      status: "published",
    })

    const optValId = addOption(pid, "Spec", "Default")
    const vid = addVariant({
      productId: pid,
      title: "Default",
      resellerPrice: null,
      retailPrice: parsePrice(row.PRICE),
      stockQty: null,
    })
    linkVariantOption(vid, optValId)
  }

  // -----------------------------------------------------------------------
  // 3. SOLAR PANELS
  // -----------------------------------------------------------------------
  const solarPanels = readSolarPanels()
  console.log(`  Solar Panels: ${solarPanels.length} rows`)
  for (const row of solarPanels) {
    const title = (row["BRAND AND MODEL"] || "").trim()
    if (!title) continue

    const metadata = {}
    if (row["POWER RATING"]) metadata.power_rating = row["POWER RATING"]
    if (row["OPEN CIRCUIT VOLTAGE"]) metadata.open_circuit_voltage = row["OPEN CIRCUIT VOLTAGE"]
    if (row.ISC) metadata.isc = row.ISC
    if (row.VOLTAGE) metadata.voltage = row.VOLTAGE
    if (row.AMPERE) metadata.ampere = row.AMPERE
    if (row.EFFICIENCY) metadata.efficiency = row.EFFICIENCY
    if (row["TEMPERATURE COEFFICIENT"]) metadata.temp_coefficient = row["TEMPERATURE COEFFICIENT"]
    if (row.WARRANTY) metadata.warranty = row.WARRANTY
    if (row.CERTIFICATION) metadata.certification = row.CERTIFICATION

    const description = buildSolarPanelDescription(row, title)

    const pid = addProduct({
      title: `Solar Panel - ${title}`,
      handle: `solar-panel-${title}`,
      subtitle: row["POWER RATING"] || "Solar Panel",
      description,
      weight: row.WEIGHT ? String(row.WEIGHT) : null,
      metadata,
      categoryNames: ["Solar Energy", "Solar Panels"],
      typeName: "Solar",
      collectionTitle: "Solar Energy",
      status: "published",
    })

    const optValId = addOption(pid, "Spec", "Default")
    const vid = addVariant({
      productId: pid,
      title: "Default",
      weight: row.WEIGHT,
    })
    linkVariantOption(vid, optValId)
  }

  // -----------------------------------------------------------------------
  // 4. SOLAR BATTERIES
  // -----------------------------------------------------------------------
  const solarBatteries = readSolarBatteries()
  console.log(`  Solar Batteries: ${solarBatteries.length} rows`)
  for (const row of solarBatteries) {
    const title = (row["BRAND AND MODEL"] || "").trim()
    if (!title) continue

    const metadata = {}
    if (row.CAPACITY) metadata.capacity = row.CAPACITY
    if (row["BATTERY TYPE"]) metadata.battery_type = row["BATTERY TYPE"]
    if (row["BATTERY CHEMISTRY"]) metadata.battery_chemistry = row["BATTERY CHEMISTRY"]
    if (row["DEPTH OF DISCHARGE"]) metadata.dod = row["DEPTH OF DISCHARGE"]
    if (row["MAX CHARGE RATE"]) metadata.max_charge_rate = row["MAX CHARGE RATE"]
    if (row.WARRANTY) metadata.warranty = row.WARRANTY
    if (row.CERTIFICATION) metadata.certification = row.CERTIFICATION
    if (row.VOLTAGE) metadata.voltage = row.VOLTAGE

    const description = buildSolarBatteryDescription(row, title)

    const pid = addProduct({
      title: `Solar Battery - ${title}`,
      handle: `solar-battery-${title}`,
      subtitle: row.CAPACITY || "Solar Battery",
      description,
      weight: row.WEIGHT ? String(row.WEIGHT) : null,
      metadata,
      categoryNames: ["Solar Energy", "Solar Batteries"],
      typeName: "Solar",
      collectionTitle: "Solar Energy",
      status: "published",
    })

    const optValId = addOption(pid, "Spec", "Default")
    const vid = addVariant({
      productId: pid,
      title: "Default",
      weight: row.WEIGHT,
    })
    linkVariantOption(vid, optValId)
  }

  // -----------------------------------------------------------------------
  // 5. POWER STATIONS
  // -----------------------------------------------------------------------
  const powerStations = readPowerStations()
  console.log(`  Power Stations: ${powerStations.length} rows`)
  for (const row of powerStations) {
    const title = (row.MODEL || "").trim()
    if (!title) continue

    const metadata = {}
    if (row["BATTERY CHEMISTRY"]) metadata.battery_chemistry = row["BATTERY CHEMISTRY"]
    if (row.CAPACITY) metadata.capacity = row.CAPACITY
    if (row["AC INPUT"]) metadata.ac_input = row["AC INPUT"]
    if (row["SOLAR INPUT"]) metadata.solar_input = row["SOLAR INPUT"]
    if (row["AC OUTPUT"]) metadata.ac_output = row["AC OUTPUT"]
    if (row["CHARGING OPTIONS"]) metadata.charging_options = row["CHARGING OPTIONS"]
    if (row.WARRANTY) metadata.warranty = row.WARRANTY
    if (row["LIFTING POWER"]) metadata.lifting_power = row["LIFTING POWER"]

    const description = buildPowerStationDescription(row, title)

    const pid = addProduct({
      title: `Power Station - ${title}`,
      handle: `power-station-${title}`,
      subtitle: row.CAPACITY || "Power Station",
      description,
      weight: row.WEIGHT ? String(row.WEIGHT) : null,
      metadata,
      categoryNames: ["Power Solutions", "Power Stations"],
      typeName: "Power",
      collectionTitle: "Power Solutions",
      status: "published",
    })

    const optValId = addOption(pid, "Spec", "Default")
    const vid = addVariant({
      productId: pid,
      title: "Default",
      weight: row.WEIGHT,
    })
    linkVariantOption(vid, optValId)
  }

  return {
    products,
    variants,
    options,
    optionValues,
    variantOptions,
    priceSets,
    prices,
    inventoryItems,
    inventoryLevels,
    variantPriceSets,
    variantInventoryItems,
    productCategories,
    productSalesChannels,
    productShippingProfiles,
  }
}

// ---------------------------------------------------------------------------
// Description builders
// ---------------------------------------------------------------------------
function buildGadgetDescription(row, title) {
  const parts = [title]
  if (row.Processor) parts.push(`Processor: ${row.Processor}`)
  if (row["RAM (GB)"]) parts.push(`RAM: ${row["RAM (GB)"]}GB`)
  if (row["SSD (GB / TB)"]) parts.push(`SSD: ${row["SSD (GB / TB)"]}`)
  if (row["HDD (GB / TB)"]) parts.push(`HDD: ${row["HDD (GB / TB)"]}`)
  if (row["Graphics Card"]) parts.push(`Graphics: ${row["Graphics Card"]}`)
  if (row["Screen Size"]) parts.push(`Screen: ${row["Screen Size"]}"`)
  if (row.Resolution) parts.push(`Resolution: ${row.Resolution}`)
  if (row["Operating System"]) parts.push(`OS: ${row["Operating System"]}`)
  if (row["SIM Type"]) parts.push(`SIM: ${row["SIM Type"]}`)
  if (row["Battery Capacity"]) parts.push(`Battery: ${row["Battery Capacity"]}`)
  return parts.join(". ")
}

function buildCCTVDescription(row, title) {
  const parts = [title]
  if (row["CAMERA TYPE"]) parts.push(`Type: ${row["CAMERA TYPE"]}`)
  if (row.RESOLUTION) parts.push(`Resolution: ${row.RESOLUTION}`)
  if (row.LENS) parts.push(`Lens: ${row.LENS}`)
  if (row["USE CASE"]) parts.push(`Use: ${row["USE CASE"]}`)
  if (row["NIGHT VISION"]) parts.push(`Night Vision: ${row["NIGHT VISION"]}`)
  return parts.join(". ")
}

function buildSolarPanelDescription(row, title) {
  const parts = [`Solar Panel ${title}`]
  if (row["POWER RATING"]) parts.push(`Power: ${row["POWER RATING"]}`)
  if (row.EFFICIENCY) parts.push(`Efficiency: ${row.EFFICIENCY}`)
  if (row.WARRANTY) parts.push(`Warranty: ${row.WARRANTY}`)
  return parts.join(". ")
}

function buildSolarBatteryDescription(row, title) {
  const parts = [`Solar Battery ${title}`]
  if (row.CAPACITY) parts.push(`Capacity: ${row.CAPACITY}`)
  if (row["BATTERY CHEMISTRY"]) parts.push(`Chemistry: ${row["BATTERY CHEMISTRY"]}`)
  if (row.VOLTAGE) parts.push(`Voltage: ${row.VOLTAGE}`)
  if (row.WARRANTY) parts.push(`Warranty: ${row.WARRANTY}`)
  return parts.join(". ")
}

function buildPowerStationDescription(row, title) {
  const parts = [`Power Station ${title}`]
  if (row.CAPACITY) parts.push(`Capacity: ${row.CAPACITY}`)
  if (row["AC OUTPUT"]) parts.push(`AC Output: ${row["AC OUTPUT"]}`)
  if (row["CHARGING OPTIONS"]) parts.push(`Charging: ${row["CHARGING OPTIONS"]}`)
  if (row.WARRANTY) parts.push(`Warranty: ${row.WARRANTY}`)
  return parts.join(". ")
}

// ---------------------------------------------------------------------------
// Database insertion
// ---------------------------------------------------------------------------
async function seedDatabase(data, categories, types, collections) {
  const pool = new pg.Pool({ connectionString: DB_URL })
  const client = await pool.connect()

  try {
    await client.query("BEGIN")

    // 0. Look up IDs from the DB
    const scRow = await client.query("SELECT id FROM sales_channel WHERE deleted_at IS NULL LIMIT 1")
    if (scRow.rows.length) SALES_CHANNEL_ID = scRow.rows[0].id
    else throw new Error("No sales channel found. Run 'npx medusa db:migrate' first.")

    const spRow = await client.query("SELECT id FROM shipping_profile WHERE deleted_at IS NULL LIMIT 1")
    if (spRow.rows.length) SHIPPING_PROFILE_ID = spRow.rows[0].id
    else throw new Error("No shipping profile found. Run 'npx medusa db:migrate' first.")

    const regRow = await client.query("SELECT id FROM region WHERE deleted_at IS NULL LIMIT 1")
    if (regRow.rows.length) REGION_ID = regRow.rows[0].id
    else console.log("  Warning: No region found, skipping region assignment")

    console.log(`  Sales Channel: ${SALES_CHANNEL_ID}`)
    console.log(`  Shipping Profile: ${SHIPPING_PROFILE_ID}`)
    console.log(`  Region: ${REGION_ID || "none"}`)

    // 1. Stock location
    await client.query(`
      INSERT INTO stock_location (id, name, created_at, updated_at)
      VALUES ('sloc_ceedmart_default', 'Ceedmart Warehouse', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `)
    console.log("  Stock location ready")

    // 2. Product types
    for (const t of types) {
      await client.query(
        `INSERT INTO product_type (id, value, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [t.id, t.value]
      )
    }
    console.log(`  ${types.length} product types created`)

    // 3. Product collections
    for (const c of collections) {
      await client.query(
        `INSERT INTO product_collection (id, title, handle, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [c.id, c.title, c.handle]
      )
    }
    console.log(`  ${collections.length} collections created`)

    // 4. Categories
    for (const cat of categories) {
      await client.query(
        `INSERT INTO product_category (id, name, handle, mpath, is_active, is_internal, rank, parent_category_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [cat.id, cat.name, cat.handle, cat.mpath, cat.is_active, cat.is_internal, cat.rank, cat.parent_category_id]
      )
    }
    console.log(`  ${categories.length} categories created`)

    // 5. Products
    for (const p of data.products) {
      await client.query(
        `INSERT INTO product (id, title, handle, subtitle, description, is_giftcard, status, weight, metadata, collection_id, type_id, discountable, origin_country, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
        [p.id, p.title, p.handle, p.subtitle, p.description, p.is_giftcard, p.status, p.weight, p.metadata, p.collection_id, p.type_id, p.discountable, p.origin_country]
      )
    }
    console.log(`  ${data.products.length} products created`)

    // 6. Product options
    for (const o of data.options) {
      await client.query(
        `INSERT INTO product_option (id, title, product_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        [o.id, o.title, o.product_id]
      )
    }
    console.log(`  ${data.options.length} options created`)

    // 7. Option values
    for (const ov of data.optionValues) {
      await client.query(
        `INSERT INTO product_option_value (id, value, option_id, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        [ov.id, ov.value, ov.option_id]
      )
    }
    console.log(`  ${data.optionValues.length} option values created`)

    // 8. Variants
    for (const v of data.variants) {
      await client.query(
        `INSERT INTO product_variant (id, title, sku, product_id, weight, manage_inventory, allow_backorder, variant_rank, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [v.id, v.title, v.sku, v.product_id, v.weight, v.manage_inventory, v.allow_backorder, v.variant_rank, v.metadata]
      )
    }
    console.log(`  ${data.variants.length} variants created`)

    // 9. Variant-option links
    for (const vo of data.variantOptions) {
      await client.query(
        `INSERT INTO product_variant_option (variant_id, option_value_id) VALUES ($1, $2)`,
        [vo.variant_id, vo.option_value_id]
      )
    }
    console.log(`  ${data.variantOptions.length} variant-option links created`)

    // 10. Price sets
    for (const ps of data.priceSets) {
      await client.query(
        `INSERT INTO price_set (id, created_at, updated_at) VALUES ($1, NOW(), NOW())`,
        [ps.id]
      )
    }
    console.log(`  ${data.priceSets.length} price sets created`)

    // 11. Prices
    for (const pr of data.prices) {
      await client.query(
        `INSERT INTO price (id, price_set_id, currency_code, amount, raw_amount, title, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [pr.id, pr.price_set_id, pr.currency_code, pr.amount, pr.raw_amount, pr.title]
      )
    }
    console.log(`  ${data.prices.length} prices created`)

    // 12. Variant-price-set links
    for (const vps of data.variantPriceSets) {
      await client.query(
        `INSERT INTO product_variant_price_set (id, variant_id, price_set_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [vps.id, vps.variant_id, vps.price_set_id]
      )
    }
    console.log(`  ${data.variantPriceSets.length} variant-price links created`)

    // 13. Inventory items
    for (const ii of data.inventoryItems) {
      await client.query(
        `INSERT INTO inventory_item (id, sku, title, requires_shipping, weight, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [ii.id, ii.sku, ii.title, ii.requires_shipping, ii.weight]
      )
    }
    console.log(`  ${data.inventoryItems.length} inventory items created`)

    // 14. Inventory levels
    for (const il of data.inventoryLevels) {
      await client.query(
        `INSERT INTO inventory_level (id, inventory_item_id, location_id, stocked_quantity, reserved_quantity, incoming_quantity, raw_stocked_quantity, raw_reserved_quantity, raw_incoming_quantity, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [il.id, il.inventory_item_id, il.location_id, il.stocked_quantity, il.reserved_quantity, il.incoming_quantity, il.raw_stocked_quantity, il.raw_reserved_quantity, il.raw_incoming_quantity]
      )
    }
    console.log(`  ${data.inventoryLevels.length} inventory levels created`)

    // 15. Variant-inventory links
    for (const vii of data.variantInventoryItems) {
      await client.query(
        `INSERT INTO product_variant_inventory_item (id, variant_id, inventory_item_id, required_quantity, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [vii.id, vii.variant_id, vii.inventory_item_id, vii.required_quantity]
      )
    }
    console.log(`  ${data.variantInventoryItems.length} variant-inventory links created`)

    // 16. Product-category links
    for (const pc of data.productCategories) {
      await client.query(
        `INSERT INTO product_category_product (product_id, product_category_id) VALUES ($1, $2)`,
        [pc.product_id, pc.product_category_id]
      )
    }
    console.log(`  ${data.productCategories.length} product-category links created`)

    // 17. Product-sales-channel links
    for (const psc of data.productSalesChannels) {
      await client.query(
        `INSERT INTO product_sales_channel (id, product_id, sales_channel_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [psc.id, psc.product_id, psc.sales_channel_id]
      )
    }
    console.log(`  ${data.productSalesChannels.length} product-sales-channel links created`)

    // 18. Product-shipping-profile links
    for (const psp of data.productShippingProfiles) {
      await client.query(
        `INSERT INTO product_shipping_profile (id, product_id, shipping_profile_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [psp.id, psp.product_id, psp.shipping_profile_id]
      )
    }
    console.log(`  ${data.productShippingProfiles.length} product-shipping links created`)

    await client.query("COMMIT")
    console.log("\n  Transaction committed successfully!")
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("\n  ROLLBACK - Error:", err.message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== Ceedmart Product Seeder (All Tabs) ===\n")

  console.log("Building categories...")
  const gadgets = readGadgets()
  const { categories, catMap } = buildCategories(gadgets)

  console.log("Building types and collections...")
  const { types, typeMap, collections, colMap } = buildTypesAndCollections()

  console.log("Building products from all 5 tabs...")
  const data = buildProducts(catMap, typeMap, colMap)

  console.log(`\n--- Summary ---`)
  console.log(`  Categories:        ${categories.length}`)
  console.log(`  Product Types:     ${types.length}`)
  console.log(`  Collections:       ${collections.length}`)
  console.log(`  Products:          ${data.products.length}`)
  console.log(`  Variants:          ${data.variants.length}`)
  console.log(`  Options:           ${data.options.length}`)
  console.log(`  Option Values:     ${data.optionValues.length}`)
  console.log(`  Price Sets:        ${data.priceSets.length}`)
  console.log(`  Prices:            ${data.prices.length}`)
  console.log(`  Inventory Items:   ${data.inventoryItems.length}`)
  console.log(`  Inventory Levels:  ${data.inventoryLevels.length}`)
  console.log(`  Category Links:    ${data.productCategories.length}`)
  console.log(`  Sales Ch. Links:   ${data.productSalesChannels.length}`)
  console.log(`  Shipping Links:    ${data.productShippingProfiles.length}`)

  console.log(`\nSeeding database...`)
  await seedDatabase(data, categories, types, collections)

  console.log("\n=== Seeding Complete ===")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
