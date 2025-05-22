const MAX_LOG_ENTRIES = 20;
let resultsLogData = [];
let resultsLogIdCounter = 1;

function addResultToLog() {
    let currentModeText = '---';
    if (DOM.sensorModeSelector && DOM.sensorModeSelector.options && DOM.sensorModeSelector.selectedIndex !== -1) {
        currentModeText = DOM.sensorModeSelector.options[DOM.sensorModeSelector.selectedIndex].text;
    }

    const logEntry = {
        id: resultsLogIdCounter++,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        mode: currentModeText.trim(),
        expMsS1: document.getElementById('exp_ms_s1').textContent.trim(),
        expMsS2: document.getElementById('exp_ms_s2').textContent.trim(),
        expMsS3: document.getElementById('exp_ms_s3').textContent.trim(),
        avgHz: document.getElementById('hz_avg').textContent.replace(' (Avg)','').trim(),
        c1TotalMs: document.getElementById('ct_c1_total_time').textContent.trim(),
        c2TotalMs: document.getElementById('ct_c2_total_time').textContent.trim(),
        slitWidthMm: document.getElementById('slit_width_mm').textContent.trim(),
        expVarPct: document.getElementById('exp_var_pct').textContent.trim(),
    };
    resultsLogData.unshift(logEntry);
    if (resultsLogData.length > MAX_LOG_ENTRIES) {
        resultsLogData.pop();
    }
    renderResultsLogTable();
}

function renderResultsLogTable() {
    const logTableBody = document.getElementById('resultsLogTable').getElementsByTagName('tbody')[0];
    if (!logTableBody) {
        console.error("Results log table body not found!");
        return;
    }
    logTableBody.innerHTML = '';
    resultsLogData.forEach(entry => {
        const row = logTableBody.insertRow();
        row.insertCell().textContent = entry.id;
        row.insertCell().textContent = entry.timestamp;
        row.insertCell().textContent = entry.mode;
        row.insertCell().textContent = entry.expMsS1;
        row.insertCell().textContent = entry.expMsS2;
        row.insertCell().textContent = entry.expMsS3;
        row.insertCell().textContent = entry.avgHz;
        row.insertCell().textContent = entry.c1TotalMs;
        row.insertCell().textContent = entry.c2TotalMs;
        row.insertCell().textContent = entry.slitWidthMm;
        row.insertCell().textContent = entry.expVarPct;
    });
}