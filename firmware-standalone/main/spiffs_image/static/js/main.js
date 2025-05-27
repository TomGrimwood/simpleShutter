// main.js - Refined, fallbacks removed

// Global application state
window.AppState = {
    lastReceivedData: null,
    isFetching: false,
};

// Wrapper to fetch data and update UI
async function fetchDataWrapper() {
    if (AppState.isFetching) {
        return;
    }
    AppState.isFetching = true;
    if (typeof updateSystemStatus === 'function') updateSystemStatus("Fetching data...");

    try {
        const rawData = await getEspData(); // from api.js
        AppState.lastReceivedData = rawData;
        if (typeof updateShutterDisplay === 'function') updateShutterDisplay(rawData);
        if (typeof updateEspModeDisplay === 'function') updateEspModeDisplay(rawData.mode);
        if (typeof updateEsp32Status === 'function') updateEsp32Status(true, "Connected", Date.now());
    } catch (error) {
        console.error("Error in fetchDataWrapper:", error);
        if (typeof updateEsp32Status === 'function') updateEsp32Status(false, `Error: ${error.message.substring(0,100)}`, Date.now());
        if (typeof updateSystemStatus === 'function') updateSystemStatus("Fetch error. See console.");
    } finally {
        AppState.isFetching = false;
    }
}

// Wrapper for mode change
async function applyModeChangeWrapper() {
    const modeSelect = DOM.sensorModeSelector;
    if (!modeSelect) {
        console.error("Sensor mode selector not found.");
        if (typeof updateSystemStatus === 'function') updateSystemStatus("Internal UI error.");
        return;
    }
    const selectedMode = parseInt(modeSelect.value, 10);
    if (typeof updateSystemStatus === 'function') updateSystemStatus(`Setting mode to ${modeSelect.options[modeSelect.selectedIndex].text}...`);

    try {
        const result = await setEspMode(selectedMode); // from api.js
        if (result.success) {
            if (typeof updateSystemStatus === 'function') updateSystemStatus(`Mode set: ${result.mode_set}. Fetching...`);
            if (typeof updateEspModeDisplay === 'function') updateEspModeDisplay(result.mode_set);
            await fetchDataWrapper();
        } else {
            if (typeof updateSystemStatus === 'function') updateSystemStatus(`Mode set failed: ${result.message || 'Unknown error'}`);
        }
    } catch (error) {
        console.error("Error applying mode change:", error);
        if (typeof updateSystemStatus === 'function') updateSystemStatus(`Mode set error: ${error.message.substring(0,100)}`);
    }
}

// Wrapper for reset
async function manualResetWrapper() {
    if (typeof updateSystemStatus === 'function') updateSystemStatus("Sending reset command...");
    try {
        const result = await resetEspSystem(); // from api.js
        if (result.success) {
            if (typeof updateSystemStatus === 'function') updateSystemStatus("System reset. Fetching...");
            if (typeof clearResultsLog === 'function') {
                clearResultsLog();
            }
            AppState.lastReceivedData = null;
            await fetchDataWrapper();
        } else {
            if (typeof updateSystemStatus === 'function') updateSystemStatus("Reset failed.");
        }
    } catch (error) {
        console.error("Error resetting system:", error);
        if (typeof updateSystemStatus === 'function') updateSystemStatus(`Reset error: ${error.message.substring(0,100)}`);
    }
}

// Called by config panel or timestamp unit changes
function triggerDisplayUpdate() {
    if (window.AppState.lastReceivedData) {
        if (typeof updateSystemStatus === 'function') updateSystemStatus("Config change, re-rendering...");
        if (typeof updateShutterDisplay === 'function') updateShutterDisplay(window.AppState.lastReceivedData);
    } else {
        fetchDataWrapper(); // Fetch fresh data if none exists
    }
}
window.triggerDisplayUpdate = triggerDisplayUpdate; // Make global for config-panel.js

document.addEventListener('DOMContentLoaded', function() {
    if (typeof initializeTabs === 'function') initializeTabs();
    if (typeof initializeConfigPanelInteraction === 'function') initializeConfigPanelInteraction();
    if (typeof initializeApiHandlers === 'function') initializeApiHandlers(); // Minimal, just logs

    if (DOM.sensorModeSelector) {
        DOM.sensorModeSelector.addEventListener('change', applyModeChangeWrapper);
    }
    
    // Example: Add buttons to HTML if you want to use these directly
    // <button id="manualResetButton">Reset ESP32</button>
    // <button id="refreshDataButton">Refresh Data</button>
    const resetButton = document.getElementById('manualResetButton');
    if (resetButton) resetButton.addEventListener('click', manualResetWrapper);
    
    const refreshButton = document.getElementById('refreshDataButton');
    if (refreshButton) refreshButton.addEventListener('click', fetchDataWrapper);

    if (typeof renderResultsLogTable === 'function') renderResultsLogTable(); // Initialize empty log table
    
    if (DOM.timestampUnitSelector) {
        DOM.timestampUnitSelector.addEventListener('change', triggerDisplayUpdate);
    }

    if (typeof updateEsp32Status === 'function') updateEsp32Status(false, "Initializing...", null);
    if (typeof updateEspModeDisplay === 'function') updateEspModeDisplay("UNKNOWN");
    
    fetchDataWrapper(); // Initial data fetch
    setInterval(fetchDataWrapper, 5000); // Auto-refresh data every 5 seconds

    // Expose functions to global scope if HTML uses onclick="...".
    // The provided HTML does for clearResultsLog.
    window.applyModeChange = applyModeChangeWrapper;
    window.manualReset = manualResetWrapper;
    window.refreshData = fetchDataWrapper;
});