// main.js - Refined, fallbacks removed

// Global application state
window.AppState = {
    lastReceivedData: null,
    isFetching: false,
};

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
            // Data will be pushed by the server via WebSocket after mode change
            // No explicit fetch needed here anymore.
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
            AppState.lastReceivedData = null; // Clear local cache, wait for new WS data
            // Data will be pushed by the server via WebSocket after reset
            // No explicit fetch needed here anymore.
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
        // No data yet, WebSocket should provide it.
        if (typeof updateSystemStatus === 'function') updateSystemStatus("No data to re-render. Waiting for WebSocket.");
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
    const resetButton = document.getElementById('manualResetButton');
    if (resetButton) resetButton.addEventListener('click', manualResetWrapper);

    if (typeof renderResultsLogTable === 'function') renderResultsLogTable(); // Initialize empty log table
    
    if (DOM.timestampUnitSelector) {
        DOM.timestampUnitSelector.addEventListener('change', triggerDisplayUpdate);
    }

    if (typeof updateEsp32Status === 'function') updateEsp32Status(false, "Initializing...", null);
    if (typeof updateEspModeDisplay === 'function') updateEspModeDisplay("UNKNOWN");
    
    // Callbacks for WebSocket from api.js
    const webSocketHandlers = {
        onOpen: () => {
            if (typeof updateEsp32Status === 'function') updateEsp32Status(true, "Connected (WS)", Date.now());
            if (typeof updateSystemStatus === 'function') updateSystemStatus("WebSocket connected. Waiting for data...");
            // Initial data should be sent by server on connect.
        },
        onMessage: (jsonData) => {
            try {
                const rawData = JSON.parse(jsonData);
                AppState.lastReceivedData = rawData; // Update global state
                if (typeof updateShutterDisplay === 'function') updateShutterDisplay(rawData);
                if (typeof updateEspModeDisplay === 'function') updateEspModeDisplay(rawData.mode);
                if (typeof updateEsp32Status === 'function') updateEsp32Status(true, "Connected (WS)", Date.now());
                if (typeof updateSystemStatus === 'function') updateSystemStatus("Data received via WebSocket.");
            } catch (error) {
                console.error("Error processing WebSocket message:", error, "Data:", jsonData);
                if (typeof updateSystemStatus === 'function') updateSystemStatus("WS data error. See console.");
            }
        },
        onError: (error) => {
            console.error("WebSocket connection error:", error);
            if (typeof updateEsp32Status === 'function') updateEsp32Status(false, "WS Error", Date.now());
            if (typeof updateSystemStatus === 'function') updateSystemStatus("WebSocket error. See console.");
        },
        onClose: (event) => {
            if (typeof updateEsp32Status === 'function') updateEsp32Status(false, `WS Closed (Code: ${event.code})`, Date.now());
            if (typeof updateSystemStatus === 'function') updateSystemStatus(`WebSocket closed. Will attempt to reconnect...`);
             // Attempt to reconnect
            setTimeout(() => {
                if (typeof updateSystemStatus === 'function') updateSystemStatus("Attempting WebSocket reconnection...");
                if (typeof connectWebSocket === 'function') connectWebSocket(webSocketHandlers);
            }, 5000); // Reconnect after 5 seconds
        }
    };

    if (typeof connectWebSocket === 'function') {
        connectWebSocket(webSocketHandlers); // Establish WebSocket connection
    }

    // Expose functions to global scope if HTML uses onclick="...".
    window.applyModeChange = applyModeChangeWrapper;
    window.manualReset = manualResetWrapper;
});