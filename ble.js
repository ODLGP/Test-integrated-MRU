// === MRU BLE MODULE ===
// Web Bluetooth integracija za MRU Optima Biogas
// Service UUID: 49535343-fe7d-4ae5-8fa9-9fafd205e455 (ISSC Serial Port)
// TX char (notify): 49535343-1e4d-4bd9-ba61-23c647249616
// RX char (write):  49535343-8841-43f4-a8d4-ecbe34729bb3

const MRU_SERVICE_UUID  = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
const MRU_TX_UUID       = '49535343-1e4d-4bd9-ba61-23c647249616'; // uređaj → mobitel
const MRU_RX_UUID       = '49535343-8841-43f4-a8d4-ecbe34729bb3'; // mobitel → uređaj

window.mruBLE = {
  device: null,
  server: null,
  txChar: null,
  rxChar: null,
  connected: false,
  buffer: '',
  lastValues: { ch4: null, co2: null, o2: null, h2s: null, h2: null, temp: null },
  onValuesUpdate: null, // callback kad stignu novi podaci
};

// Spoji se na MRU uređaj
async function mruConnect() {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth nije podržan u ovom browseru. Koristi Chrome.');
    return false;
  }
  try {
    mruUpdateStatus('Tražim uređaj...', 'searching');
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'MRU' },
        { namePrefix: 'Optima' },
        { services: [MRU_SERVICE_UUID] }
      ],
      optionalServices: [MRU_SERVICE_UUID]
    });

    window.mruBLE.device = device;
    device.addEventListener('gattserverdisconnected', mruOnDisconnected);

    mruUpdateStatus('Spajam...', 'connecting');
    const server = await device.gatt.connect();
    window.mruBLE.server = server;

    const service = await server.getPrimaryService(MRU_SERVICE_UUID);

    // TX - primamo podatke od uređaja
    try {
      window.mruBLE.txChar = await service.getCharacteristic(MRU_TX_UUID);
      await window.mruBLE.txChar.startNotifications();
      window.mruBLE.txChar.addEventListener('characteristicvaluechanged', mruOnData);
      console.log('Subscribed to TX:', MRU_TX_UUID);
    } catch(e) {
      console.warn('TX char failed:', e);
    }

    // Treća karakteristika - također NOTIFY
    try {
      const char3 = await service.getCharacteristic('49535343-4c8a-39b3-2f49-511cff073b7e');
      await char3.startNotifications();
      char3.addEventListener('characteristicvaluechanged', mruOnData);
      console.log('Subscribed to char3');
    } catch(e) {
      console.warn('Char3 failed:', e);
    }

    window.mruBLE.connected = true;
    mruUpdateStatus('Spojeno ✓ ' + (device.name || 'MRU'), 'connected');

    // Pošalji wake-up komandu na WRITE char da pokrene streaming
    try {
      const rxChar = await service.getCharacteristic('49535343-8841-43f4-a8d4-ecbe34729bb3');
      // Probaj različite wake-up komande
      const cmds = [
        new Uint8Array([0x01]),           // start
        new Uint8Array([0x53]),           // 'S'
        new Uint8Array([0x0D, 0x0A]),     // CR+LF
        new Uint8Array([0x01, 0x00]),
      ];
      for (const cmd of cmds) {
        try { await rxChar.writeValue(cmd); await new Promise(r => setTimeout(r, 300)); } catch(e) {}
      }
      console.log('Wake-up commands sent');
    } catch(e) {
      console.warn('Wake-up failed:', e);
    }

    return true;

  } catch(e) {
    if (e.name !== 'NotFoundError') {
      console.error('BLE connect error:', e);
      mruUpdateStatus('Greška: ' + e.message, 'error');
    } else {
      mruUpdateStatus('Nije odabran uređaj', 'idle');
    }
    return false;
  }
}

// Odspoji
async function mruDisconnect() {
  if (window.mruBLE.device && window.mruBLE.device.gatt.connected) {
    window.mruBLE.device.gatt.disconnect();
  }
  window.mruBLE.connected = false;
  mruUpdateStatus('Odspojeno', 'idle');
}

// Kad se uređaj odspoji
function mruOnDisconnected() {
  window.mruBLE.connected = false;
  mruUpdateStatus('Veza prekinuta', 'error');
}

// Parsiranje podataka s uređaja
function mruOnData(event) {
  const value = event.target.value;
  // Debug - pokaži raw bytes i tekst u konzoli
  const rawBytes = Array.from(new Uint8Array(value.buffer)).map(b => b.toString(16).padStart(2,'0')).join(' ');
  const decoder = new TextDecoder('utf-8');
  const chunk = decoder.decode(value);
  console.log('MRU RAW HEX:', rawBytes);
  console.log('MRU RAW TEXT:', JSON.stringify(chunk));
  // Vidljivi debug na ekranu mobitela
  var dbg = document.getElementById('ble-debug');
  if (dbg) {
    dbg.style.display = 'block';
    dbg.textContent = 'HEX: ' + rawBytes + '\nTEXT: ' + JSON.stringify(chunk);
  }
  window.mruBLE.buffer += chunk;

  // Pokušaj parsirati svaki kompletan redak
  const lines = window.mruBLE.buffer.split('\n');
  window.mruBLE.buffer = lines.pop(); // zadnji nepotpuni redak ostaje u bufferu

  for (const line of lines) {
    const parsed = mruParseLine(line.trim());
    if (parsed) {
      Object.assign(window.mruBLE.lastValues, parsed);
      if (typeof window.mruBLE.onValuesUpdate === 'function') {
        window.mruBLE.onValuesUpdate(window.mruBLE.lastValues);
      }
      mruUpdateLiveDisplay(window.mruBLE.lastValues);
    }
  }
}

// Parser za MRU serijski format
// MRU šalje podatke u formatu: "CH4=45.23;CO2=32.11;O2=1.05;H2S=12;H2=0;T=24.5"
// ili CSV format ovisno o firmware verziji
function mruParseLine(line) {
  if (!line || line.length < 3) return null;
  const result = {};
  let found = false;

  // Format 1: KEY=VALUE;KEY=VALUE
  if (line.includes('=')) {
    const pairs = line.split(';');
    for (const pair of pairs) {
      const [key, val] = pair.split('=');
      if (!key || !val) continue;
      const k = key.trim().toUpperCase();
      const v = parseFloat(val.trim());
      if (isNaN(v)) continue;
      if (k === 'CH4' || k === 'CH_4')  { result.ch4 = v; found = true; }
      if (k === 'CO2' || k === 'CO_2')  { result.co2 = v; found = true; }
      if (k === 'O2')                    { result.o2  = v; found = true; }
      if (k === 'H2S' || k === 'H_2S')  { result.h2s = v; found = true; }
      if (k === 'H2'  || k === 'H_2')   { result.h2  = v; found = true; }
      if (k === 'T' || k === 'TEMP' || k === 'TG') { result.temp = v; found = true; }
    }
  }

  // Format 2: CSV vrijednosti u poznatom redoslijedu
  // ch4, co2, o2, h2s, h2, temp
  if (!found && line.includes(',')) {
    const parts = line.split(',').map(p => parseFloat(p.trim()));
    if (parts.length >= 3 && !parts.some(isNaN)) {
      result.ch4  = parts[0] ?? null;
      result.co2  = parts[1] ?? null;
      result.o2   = parts[2] ?? null;
      result.h2s  = parts[3] ?? null;
      result.h2   = parts[4] ?? null;
      result.temp = parts[5] ?? null;
      found = true;
    }
  }

  return found ? result : null;
}

// Ažuriraj live prikaz u formi odušnika
function mruUpdateLiveDisplay(vals) {
  const fields = [
    { id: 'ble-live-ch4',  val: vals.ch4,  unit: '%',   label: 'CH₄' },
    { id: 'ble-live-co2',  val: vals.co2,  unit: '%',   label: 'CO₂' },
    { id: 'ble-live-o2',   val: vals.o2,   unit: '%',   label: 'O₂'  },
    { id: 'ble-live-h2s',  val: vals.h2s,  unit: 'ppm', label: 'H₂S' },
    { id: 'ble-live-h2',   val: vals.h2,   unit: 'ppm', label: 'H₂'  },
    { id: 'ble-live-temp', val: vals.temp, unit: '°C',  label: 'Temp'},
  ];
  fields.forEach(f => {
    const el = document.getElementById(f.id);
    if (el) {
      el.textContent = f.val !== null ? f.val.toFixed(f.unit === 'ppm' ? 0 : 2) + ' ' + f.unit : '---';
      el.classList.toggle('ble-live-active', f.val !== null);
    }
  });
}

// Upiši live vrijednosti u polja forme
function mruInsertValues() {
  const v = window.mruBLE.lastValues;
  if (v.ch4  !== null) document.getElementById('ch4').value  = v.ch4.toFixed(2);
  if (v.co2  !== null) document.getElementById('co2').value  = v.co2.toFixed(2);
  if (v.o2   !== null) document.getElementById('o2').value   = v.o2.toFixed(2);
  if (v.h2s  !== null) document.getElementById('h2s').value  = Math.round(v.h2s);
  if (v.h2   !== null) document.getElementById('h2').value   = Math.round(v.h2);
  if (v.temp !== null) document.getElementById('vent-temp').value = v.temp.toFixed(1);

  // Postavi status na "izmjeren"
  const measuredRadio = document.querySelector('input[name="vent-status"][value="measured"]');
  if (measuredRadio) measuredRadio.checked = true;

  // Vibracija kao potvrda
  if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
}

// Status indikator
function mruUpdateStatus(msg, state) {
  const el = document.getElementById('ble-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'ble-status ble-' + state;
}

// Auto-show BLE panel when vent form opens (MutationObserver)
document.addEventListener('DOMContentLoaded', function() {
  // Dodaj debug div u BLE panel
  var panel = document.getElementById('ble-live-panel');
  if (panel) {
    var dbg = document.createElement('div');
    dbg.id = 'ble-debug';
    dbg.style.cssText = 'display:none;margin-top:10px;padding:8px;background:#fff3cd;border-radius:6px;font-size:11px;font-family:monospace;word-break:break-all;white-space:pre-wrap;color:#333;border:1px solid #ffc107;';
    dbg.textContent = 'Čekam podatke...';
    panel.appendChild(dbg);
  }
  var ventForm = document.getElementById('vent-form');
  if (!ventForm) return;
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.attributeName === 'style') {
        var visible = ventForm.style.display !== 'none' && ventForm.style.display !== '';
        var panel = document.getElementById('ble-live-panel');
        if (panel) {
          panel.style.display = (visible && window.mru4uMode === 'yes') ? 'block' : 'none';
        }
        // Show/hide disconnect btn based on connection state
        var discBtn = document.getElementById('ble-disconnect-btn');
        if (discBtn) discBtn.style.display = window.mruBLE.connected ? 'inline-flex' : 'none';
      }
    });
  });
  observer.observe(ventForm, { attributes: true });
});
