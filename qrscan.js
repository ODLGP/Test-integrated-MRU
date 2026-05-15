// === MRU QR SCANNER ===
// Skenira QR kod s ekrana MRU uređaja i popunjava polja forme
// Format: ID;vrijednost;ID;vrijednost...
// Mapiranje ID-ova:
//   38  -> CH4 (%)
//   22  -> CO2 (%)
//   20  -> O2  (%)
//   62  -> H2  (ppm)
//   34  -> H2S (ppm)
//   54  -> Temp (°C)

const MRU_QR_MAP = {
  '38':  { field: 'ch4',       decimals: 2 },
  '22':  { field: 'co2',       decimals: 2 },
  '20':  { field: 'o2',        decimals: 2 },
  '62':  { field: 'h2',        decimals: 0 },
  '34':  { field: 'h2s',       decimals: 0 },
  '54':  { field: 'vent-temp', decimals: 1 },
};

let _qrStream = null;
let _qrAnimFrame = null;
let _qrWorking = false;

// Parsira MRU QR string i vraća objekt s vrijednostima
function mruParseQR(text) {
  const result = {};
  // Provjeri je li MRU format
  if (!text.includes('MRU') && !text.includes(';38;') && !text.includes(';22;')) {
    // Pokušaj svejedno parsirati
    if (!text.includes(';')) return result;
  }
  const parts = text.split(';');
  for (let i = 0; i < parts.length - 1; i++) {
    const id = parts[i].trim();
    const val = parts[i + 1].trim();
    // Provjeri je li ID točno broj koji tražimo (ne dio većeg broja)
    if (MRU_QR_MAP[id] !== undefined) {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        result[MRU_QR_MAP[id].field] = num;
      }
    }
  }
  return result;
}

// Popuni polja forme s parsiranim vrijednostima
function mruFillFromQR(values) {
  let filled = 0;
  for (const [fieldId, val] of Object.entries(values)) {
    const el = document.getElementById(fieldId);
    if (el) {
      const map = Object.values(MRU_QR_MAP).find(m => m.field === fieldId);
      el.value = map ? val.toFixed(map.decimals) : val;
      filled++;
    }
  }
  return filled;
}

// Otvori QR skener modal
function openQRScanner() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Kamera nije dostupna u ovom browseru.');
    return;
  }

  // Kreiraj modal ako ne postoji
  let modal = document.getElementById('qr-scanner-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'qr-scanner-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="color:white;font-size:16px;font-weight:600;margin-bottom:15px;">📷 Usmjeri kameru prema QR kodu na MRU uređaju</div>
      <div style="position:relative;width:300px;height:300px;">
        <video id="qr-video" style="width:300px;height:300px;object-fit:cover;border-radius:12px;" playsinline autoplay muted></video>
        <canvas id="qr-canvas" style="display:none;"></canvas>
        <!-- Okvir za skeniranje -->
        <div style="position:absolute;top:0;left:0;right:0;bottom:0;border:3px solid #2196f3;border-radius:12px;pointer-events:none;"></div>
        <div style="position:absolute;top:10px;left:10px;width:30px;height:30px;border-top:4px solid #2196f3;border-left:4px solid #2196f3;border-radius:4px 0 0 0;"></div>
        <div style="position:absolute;top:10px;right:10px;width:30px;height:30px;border-top:4px solid #2196f3;border-right:4px solid #2196f3;border-radius:0 4px 0 0;"></div>
        <div style="position:absolute;bottom:10px;left:10px;width:30px;height:30px;border-bottom:4px solid #2196f3;border-left:4px solid #2196f3;border-radius:0 0 0 4px;"></div>
        <div style="position:absolute;bottom:10px;right:10px;width:30px;height:30px;border-bottom:4px solid #2196f3;border-right:4px solid #2196f3;border-radius:0 0 4px 0;"></div>
      </div>
      <div id="qr-status" style="color:#aaa;font-size:14px;margin-top:15px;text-align:center;padding:0 20px;">Tražim QR kod...</div>
      <button onclick="closeQRScanner()" style="margin-top:20px;background:#e53935;color:white;border:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">Odustani</button>
    `;
    document.body.appendChild(modal);
  }

  modal.style.display = 'flex';
  document.getElementById('qr-status').textContent = 'Pokrećem kameru...';

  // Pokreni kameru - preferira stražnju
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
  }).then(stream => {
    _qrStream = stream;
    const video = document.getElementById('qr-video');
    video.srcObject = stream;
    video.play();
    video.onloadedmetadata = () => {
      document.getElementById('qr-status').textContent = 'Tražim QR kod...';
      _qrWorking = true;
      scanQRFrame();
    };
  }).catch(err => {
    document.getElementById('qr-status').textContent = 'Greška kamere: ' + err.message;
  });
}

// Skeniraj frame po frame
function scanQRFrame() {
  if (!_qrWorking) return;

  const video = document.getElementById('qr-video');
  const canvas = document.getElementById('qr-canvas');
  if (!video || !canvas || video.readyState < 2) {
    _qrAnimFrame = requestAnimationFrame(scanQRFrame);
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Koristi BarcodeDetector API ako je dostupan (Chrome Android)
  if ('BarcodeDetector' in window) {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    detector.detect(canvas).then(barcodes => {
      if (barcodes.length > 0) {
        const text = barcodes[0].rawValue;
        handleQRResult(text);
      } else {
        _qrAnimFrame = requestAnimationFrame(scanQRFrame);
      }
    }).catch(() => {
      _qrAnimFrame = requestAnimationFrame(scanQRFrame);
    });
  } else {
    // BarcodeDetector nije dostupan
    document.getElementById('qr-status').textContent = 'QR skeniranje nije podržano u ovom browseru. Koristi Chrome na Androidu.';
  }
}

function handleQRResult(text) {
  _qrWorking = false;
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

  // Debug - pokaži raw tekst
  document.getElementById('qr-status').textContent = 'RAW: ' + text.substring(0, 80);

  const values = mruParseQR(text);
  const count = Object.keys(values).length;

  if (count === 0) {
    document.getElementById('qr-status').textContent = '❌ Nije MRU QR kod. Pokušaj ponovo.';
    setTimeout(() => {
      _qrWorking = true;
      scanQRFrame();
    }, 1500);
    return;
  }

  // Popuni polja
  mruFillFromQR(values);

  // Postavi status na izmjeren
  const measuredRadio = document.querySelector('input[name="vent-status"][value="measured"]');
  if (measuredRadio) measuredRadio.checked = true;

  document.getElementById('qr-status').innerHTML = `✅ Učitano ${count} vrijednosti!`;

  setTimeout(() => closeQRScanner(), 800);
}

function closeQRScanner() {
  _qrWorking = false;
  if (_qrAnimFrame) cancelAnimationFrame(_qrAnimFrame);
  if (_qrStream) {
    _qrStream.getTracks().forEach(t => t.stop());
    _qrStream = null;
  }
  const modal = document.getElementById('qr-scanner-modal');
  if (modal) modal.style.display = 'none';
}
