// === PRESENCE / AKTIVNA MJERENJA ===
// Prati tko trenutno obavlja mjerenje i prikazuje ostalima na login ekranu

let _presenceUnsubscribe = null;
let _currentPresenceId = null;

// Postavi status "mjeri" u Firebase
async function presenceSetActive(measurer, landfillName) {
  if (!window.firebaseDB) return;
  try {
    const { collection, doc, setDoc, serverTimestamp } = window.firebaseFunctions;
    const id = measurer.replace(/\s+/g, '_') + '_' + Date.now();
    _currentPresenceId = id;
    const ref = doc(collection(window.firebaseDB, 'activeMeasurements'), id);
    await setDoc(ref, {
      measurer: measurer,
      landfill: landfillName,
      startedAt: serverTimestamp(),
      ts: Date.now()
    });
    // Cleanup on page unload
    window.addEventListener('beforeunload', presenceClear);
  } catch(e) {
    console.warn('Presence set failed:', e);
  }
}

// Ukloni status kad završi mjerenje ili napusti stranicu
async function presenceClear() {
  if (!_currentPresenceId || !window.firebaseDB) return;
  try {
    const { collection, doc, deleteDoc } = window.firebaseFunctions;
    const ref = doc(collection(window.firebaseDB, 'activeMeasurements'), _currentPresenceId);
    await deleteDoc(ref);
    _currentPresenceId = null;
  } catch(e) {
    console.warn('Presence clear failed:', e);
  }
}

// Slušaj promjene i prikaži na login ekranu
function presenceStartListening() {
  if (!window.firebaseDB) return;
  try {
    const { collection, onSnapshot } = window.firebaseFunctions;
    const col = collection(window.firebaseDB, 'activeMeasurements');
    _presenceUnsubscribe = onSnapshot(col, (snapshot) => {
      const section = document.getElementById('active-measurements-section');
      const list = document.getElementById('active-measurements-list');
      if (!section || !list) return;

      // Filtriraj stare zapise (starije od 4 sata)
      const now = Date.now();
      const active = [];
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        if (d.ts && (now - d.ts) < 4 * 60 * 60 * 1000) {
          active.push(d);
        }
      });

      if (active.length === 0) {
        section.style.display = 'none';
        return;
      }

      section.style.display = 'block';
      list.innerHTML = active.map(d => {
        const elapsed = d.ts ? Math.floor((now - d.ts) / 60000) : 0;
        const timeStr = elapsed < 1 ? 'upravo počelo' : `prije ${elapsed} min`;
        return `<div style="
          display:flex;align-items:center;gap:10px;
          background:#e8f5e9;border-left:3px solid #4caf50;
          border-radius:6px;padding:10px 12px;margin-bottom:8px;">
          <span style="font-size:20px;">🧑‍🔬</span>
          <div>
            <div style="font-weight:600;font-size:14px;color:#1b5e20;">${d.measurer}</div>
            <div style="font-size:13px;color:#388e3c;">mjeri <strong>${d.landfill}</strong></div>
            <div style="font-size:11px;color:#888;margin-top:2px;">${timeStr}</div>
          </div>
        </div>`;
      }).join('');
    });
  } catch(e) {
    console.warn('Presence listen failed:', e);
  }
}

// Pokretanje listenera kad se Firebase inicijalizira
document.addEventListener('firebaseReady', () => {
  setTimeout(presenceStartListening, 500);
});
if (window.firebaseReady) setTimeout(presenceStartListening, 500);
