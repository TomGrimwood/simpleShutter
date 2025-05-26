// Global application state
window.AppState = {
    lastReceivedData: null, // Will store raw data from ESP32's /api/getdata
    // currentBackendSerialPort: null, // No longer needed
    isFetching: false, // Simple flag to prevent overlapping fetches
};

// Wrapper to fetch data and update UI
async function fetchDataWrapper() {
    if (AppState.isFetching) {
        // console.log("Fetch already in progress. Skipping.");
        return;
    }
    AppState.isFetching = true;
    // console.log("fetchDataWrapper called"); // For debugging
    updateSystemStatus("Fetching data..."); // from ui-helpers.js or data-updater.js if moved

    try {
        const rawData = await getEspData(); // from api.js
        AppState.lastReceivedData = rawData;
        updateShutterDisplay(rawData); // from data-updater.js
        updateEspModeDisplay(rawData.mode); // from data-updater.js, pass the mode string
        updateEsp32Status(true, "Connected", Date.now()); // Mark as connected, update timestamp
    } catch (error) {
        console.error("Error in fetchDataWrapper:", error);
        updateEsp32Status(false, `Error: ${error.message}`, Date.now());
        // Optionally clear parts of the display or show 'N/A'
    } finally {
        AppState.isFetching = false;
    }
}

// Wrapper for mode change
async function applyModeChangeWrapper() {
    const modeSelect = DOM.sensorModeSelector; // from ui-helpers.js
    const selectedMode = parseInt(modeSelect.value, 10);
    updateSystemStatus(`Setting mode to ${modeSelect.options[modeSelect.selectedIndex].text}...`);

    try {
        const result = await setEspMode(selectedMode); // from api.js
        if (result.success) {
            updateSystemStatus(`Mode successfully set to ${result.mode_set}. Fetching new data...`);
            updateEspModeDisplay(result.mode_set); // Update display immediately
            await fetchDataWrapper(); // Refresh data after mode change
        } else {
            updateSystemStatus(`Failed to set mode: ${result.message || 'Unknown error'}`);
        }
    } catch (error) {
        console.error("Error applying mode change:", error);
        updateSystemStatus(`Error setting mode: ${error.message}`);
    }
}

// Wrapper for reset
async function manualResetWrapper() {
    updateSystemStatus("Sending reset command...");
    try {
        const result = await resetEspSystem(); // from api.js
        if (result.success) {
            updateSystemStatus("System reset successfully. Fetching new data...");
            // Clear local log and potentially other transient UI states if desired
            if (window.clearResultsLog) { // Check if results-log.js function is available
                clearResultsLog();
            }
            AppState.lastReceivedData = null; // Clear last data
            await fetchDataWrapper(); // Refresh data after reset
        } else {
            updateSystemStatus("Failed to reset system.");
        }
    } catch (error) {
        console.error("Error resetting system:", error);
        updateSystemStatus(`Error resetting: ${error.message}`);
    }
}


// This function is called by config panel scaling changes (e.g., totalSensorDistanceConfig)
// or timestamp unit changes.
function triggerDisplayUpdate() {
    // console.log("triggerDisplayUpdate called due to config/unit change");
    if (window.AppState.lastReceivedData) {
        // If we have previous data, re-render it with new scaling/units
        updateShutterDisplay(window.AppState.lastReceivedData);
    } else {
        // Otherwise, fetch fresh data, which will then be rendered
        fetchDataWrapper();
    }
}


document.addEventListener('DOMContentLoaded', function() {
    // Initialize UI elements and interactions
    initializeTabs(); // from ui-helpers.js
    initializeConfigPanelInteraction(); // from config-panel.js (attaches listeners to config inputs)
    
    // Initialize API related handlers (api.js now just provides functions, no listeners)
    // initializeApiHandlers(); // from api.js - this function is now minimal in adapted api.js

    // Setup button/select listeners here
    if (DOM.sensorModeSelector) {
        DOM.sensorModeSelector.addEventListener('change', applyModeChangeWrapper);
    }
    // Assuming index.html has buttons with these IDs, or change to use DOM elements from ui-helpers.js
    const resetButton = document.getElementById('manualResetButton'); // Assuming new ID for reset
    if (resetButton) { // Check if element exists
         resetButton.addEventListener('click', manualResetWrapper);
    } else { // Fallback or find by other means if ID is different
        // Look for a button that might call a global `manualReset()` if defined in HTML
        // For the provided HTML, it's <button onclick="manualReset()">, so manualResetWrapper needs to be global or assigned.
    }
    
    const refreshButton = document.getElementById('refreshDataButton'); // Assuming new ID for refresh
     if (refreshButton) {
        refreshButton.addEventListener('click', fetchDataWrapper);
    }


    // Initialize data displays
    renderResultsLogTable(); // from results-log.js
    
    // Attach listener for timestamp unit changes
    if (DOM.timestampUnitSelector) {
        DOM.timestampUnitSelector.addEventListener('change', triggerDisplayUpdate);
    }

    // Initial data fetch and start periodic polling
    updateEsp32Status(false, "Initializing...", Date.now()); // Initial status
    updateEspModeDisplay("UNKNOWN"); // Initial mode display
    fetchDataWrapper(); 
    setInterval(fetchDataWrapper, 5000); // Auto-refresh data every 5 seconds

    // Check if global functions are needed for HTML onclick attributes
    // If index.html uses onclick="applyModeChange()", etc. make them global
    window.applyModeChange = applyModeChangeWrapper; // Make global for HTML onclick
    window.manualReset = manualResetWrapper;       // Make global for HTML onclick
    window.refreshData = fetchDataWrapper;       // Make global for HTML onclick
});

// Ensure updateSystemStatus is available (might be better in ui-helpers.js)
// For now, make sure it's defined or move its definition here/ui-helpers.js
// It's used by fetchDataWrapper, applyModeChangeWrapper, manualResetWrapper.
// Assuming data-updater.js defines it globally or it's moved to ui-helpers.js
// For safety, define a basic one here if not already present.
if (typeof updateSystemStatus === 'undefined') {
    window.updateSystemStatus = function(message) {
        const statusEl = document.getElementById('systemStatus'); // Fallback ID
        if (statusEl) statusEl.textContent = message;
        console.log("Status (main.js fallback):", message);
    };
}
if (typeof updateEspModeDisplay === 'undefined') {
    window.updateEspModeDisplay = function(modeStringFromServer) {
         const modeDisplayEl = DOM.sensorModeSelector; // This is a select element.
         if (modeDisplayEl) {
            let modeValueToSelect = "0";
            if (modeStringFromServer) {
                switch (modeStringFromServer.toUpperCase()) {
                    case "ALL": modeValueToSelect = "0"; break;
                    case "OUTER": modeValueToSelect = "1"; break;
                    case "INNER": modeValueToSelect = "2"; break;
                }
            }
            if (modeDisplayEl.value !== modeValueToSelect) modeDisplayEl.value = modeValueToSelect;
         }
        console.log("Mode Display (main.js fallback):", modeStringFromServer);
    };
}
if (typeof updateEsp32Status === 'undefined') { // Already in data-updater.js
    window.updateEsp32Status = function(isConnected, message, lastSeenTimestamp) {
        console.log("ESP32 Status (main.js fallback):", isConnected, message, lastSeenTimestamp);
    };
}
