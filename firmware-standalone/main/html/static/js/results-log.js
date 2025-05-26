// results-log.js

const MAX_LOG_ENTRIES = 100; // Maximum number of entries to keep in the log
window.resultsLog = []; // Store log data in memory

function addResultToLog() {
    if (!window.AppState || !window.AppState.lastReceivedData) {
        // console.log("No data available to log.");
        return;
    }
    // Ensure that AppState.lastReceivedData contains the raw data from ESP32, not the processed metrics
    const rawData = window.AppState.lastReceivedData; 

    // Extract values for the log - these should be calculated values based on rawData
    // The data-updater.js script will have populated the display fields. We read from there.
    // Or, better, re-calculate key metrics here for consistency if data-updater's display values are formatted.
    // For simplicity, let's assume data-updater has done its job and we can grab display text,
    // but it's more robust to recalculate or grab from a consistent data structure.
    // For this example, we'll grab key values from the display elements.
    // This is NOT ideal as it couples logic tightly to display formatting.
    // A better way would be for updateShutterDisplay to store calculated metrics in AppState.
    
    const logEntry = {
        timestamp: new Date().toLocaleTimeString(),
        mode: document.getElementById('sensorModeSelector').selectedOptions[0].text.substring(0,10), // Abbreviate
        exp_s1_ms: getText('exp_ms_s1', '---'),
        exp_s2_ms: getText('exp_ms_s2', '---'),
        exp_s3_ms: getText('exp_ms_s3', '---'),
        avg_hz: getText('hz_avg', '---'),
        c1_total_ms: getText('ct_c1_total_time', '---'),
        c2_total_ms: getText('ct_c2_total_time', '---'),
        slit_mm: getText('slit_width_mm', '---'),
        exp_var_pct: getText('exp_var_pct', '---')
    };

    window.resultsLog.unshift(logEntry); // Add to the beginning of the array

    // Keep the log size manageable
    if (window.resultsLog.length > MAX_LOG_ENTRIES) {
        window.resultsLog.pop(); // Remove the oldest entry
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

    window.resultsLog.forEach((entry, index) => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = window.resultsLog.length - index; // Entry number (desc)
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
    renderResultsLogTable();
    console.log("Results log cleared.");
}

// Helper to get text from an element, used by addResultToLog
// This is defined in ui-helpers.js, ensure it's loaded first or redefine here.
// For robustness, ensure it's available:
if (typeof getText === 'undefined') {
    window.getText = function(elementId, defaultValue = '---') {
        const element = document.getElementById(elementId);
        return element ? element.textContent : defaultValue;
    };
}
