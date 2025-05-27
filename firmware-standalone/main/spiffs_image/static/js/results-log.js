// results-log.js - Refined

const MAX_LOG_ENTRIES = 100;
window.resultsLog = []; // Store log data in memory (as in original)
let resultsLogIdCounter = 1; // Added from reference for unique ID

function addResultToLog() {
    if (!window.AppState || !window.AppState.lastReceivedData) {
        return;
    }

    let currentModeText = '---';
    if (DOM.sensorModeSelector && DOM.sensorModeSelector.options && DOM.sensorModeSelector.selectedIndex !== -1) {
        currentModeText = DOM.sensorModeSelector.options[DOM.sensorModeSelector.selectedIndex].text.substring(0,10); // Abbreviate
    }

    const newLogEntry = {
        // id will be assigned later if entry is added
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        mode: currentModeText,
        exp_s1_ms: getText('exp_ms_s1', '---'),
        exp_s2_ms: getText('exp_ms_s2', '---'),
        exp_s3_ms: getText('exp_ms_s3', '---'),
        avg_hz: getText('hz_avg', '---'),
        c1_total_ms: getText('ct_c1_total_time', '---'),
        c2_total_ms: getText('ct_c2_total_time', '---'),
        slit_mm: getText('slit_width_mm', '---'),
        exp_var_pct: getText('exp_var_pct', '---') // getText will trim and handle "---"
    };

    // Check if the new data is identical to the last logged entry's data fields
    if (window.resultsLog.length > 0) {
        const lastLoggedEntry = window.resultsLog[0];
        // Compare all relevant data fields. 'id' and 'timestamp' are expected to differ.
        if (newLogEntry.mode === lastLoggedEntry.mode &&
            newLogEntry.exp_s1_ms === lastLoggedEntry.exp_s1_ms &&
            newLogEntry.exp_s2_ms === lastLoggedEntry.exp_s2_ms &&
            newLogEntry.exp_s3_ms === lastLoggedEntry.exp_s3_ms &&
            newLogEntry.avg_hz === lastLoggedEntry.avg_hz &&
            newLogEntry.c1_total_ms === lastLoggedEntry.c1_total_ms &&
            newLogEntry.c2_total_ms === lastLoggedEntry.c2_total_ms &&
            newLogEntry.slit_mm === lastLoggedEntry.slit_mm &&
            newLogEntry.exp_var_pct === lastLoggedEntry.exp_var_pct)
        {
            // console.log("New data identical to last log entry. Skipping log addition.");
            return; // Do not add the duplicate entry
        }
    }
    
    // If we reach here, the entry is new or different, so add it.
    // Assign a unique ID to the new entry before adding it.
    newLogEntry.id = resultsLogIdCounter++;

    window.resultsLog.unshift(newLogEntry);

    if (window.resultsLog.length > MAX_LOG_ENTRIES) {
        window.resultsLog.pop();
    }

    renderResultsLogTable();
}

function renderResultsLogTable() {
    const tableBody = document.getElementById('resultsLogTable')?.getElementsByTagName('tbody')[0];
    if (!tableBody) {
        console.error("Results log table body not found!");
        return;
    }

    tableBody.innerHTML = ''; // Clear existing rows

    window.resultsLog.forEach(entry => { // No index needed if using entry.id
        const row = tableBody.insertRow();
        row.insertCell().textContent = entry.id; // Display unique ID
        row.insertCell().textContent = entry.timestamp;
        row.insertCell().textContent = entry.mode;
        row.insertCell().textContent = entry.exp_s1_ms;
        row.insertCell().textContent = entry.exp_s2_ms;
        row.insertCell().textContent = entry.exp_s3_ms;
        row.insertCell().textContent = entry.avg_hz;
        row.insertCell().textContent = entry.c1_total_ms;
        row.insertCell().textContent = entry.c2_total_ms;
        row.insertCell().textContent = entry.slit_mm;
        row.insertCell().textContent = entry.exp_var_pct;
    });
}

function clearResultsLog() {
    window.resultsLog = [];
    resultsLogIdCounter = 1; // Reset counter
    renderResultsLogTable();
    console.log("Results log cleared.");
}
window.clearResultsLog = clearResultsLog; // Expose to global for button onclick
