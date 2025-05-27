// main.js - WebSocket integration

// Global application state
window.AppState = {
    lastReceivedData: null,
    // isFetching: false, // No longer needed for polling
    webSocket: null,
    webSocketConnected: false,
    webSocketRetryInterval: 5000, // 5 seconds
};

function processIncomingData(jsonData) {
    try {
        const rawData = JSON.parse(jsonData);
        AppState.lastReceivedData = rawData;
        if (typeof updateShutterDisplay === 'function') updateShutterDisplay(rawData);
        if (typeof updateEspModeDisplay === 'function') updateEspModeDisplay(rawData.mode); // Ensure mode dropdown is synced
        if (typeof updateEsp32Status === 'function') updateEsp32Status(true, "Connected (Live)", Date.now());
        if (typeof updateSystemStatus === 'function') updateSystemStatus("Live data updated.");
    } catch (error) {
        console.error("Error processing incoming WebSocket data:", error, "Data:", jsonData);
        if (typeof updateSystemStatus === 'function') updateSystemStatus("Error processing live data.");
    }
}

function connectWebSocket() {
    // Ensure only one connection attempt/instance at a time
    if (AppState.webSocket && (AppState.webSocket.readyState === WebSocket.OPEN || AppState.webSocket.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket already open or connecting.");
        return;
    }

    // Use `ws:` or `wss:` based on current page protocol (though ESP32 likely serves HTTP)
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = wsProtocol + "//" + window.location.host + "/ws";
    
    AppState.webSocket = new WebSocket(wsUrl);
    if (typeof updateSystemStatus === 'function') updateSystemStatus("Connecting to ESP32 via WebSocket...");
    if (typeof updateEsp32Status === 'function') updateEsp32Status(false, "Connecting...", null);


    AppState.webSocket.onopen = function(event) {
        console.log("WebSocket connection established.");
        AppState.webSocketConnected = true;
        if (typeof updateEsp32Status === 'function') updateEsp32Status(true, "Connected (Live)", Date.now());
        if (typeof updateSystemStatus === 'function') updateSystemStatus("Live connection active.");
        // Server should send initial data upon connection.
    };

    AppState.webSocket.onmessage = function(event) {
        // console.log("WebSocket message received:", event.data);
        processIncomingData(event.data);
    };

    AppState.webSocket.onclose = function(event) {
        console.log("WebSocket connection closed.", event.code, event.reason);
        AppState.webSocketConnected = false;
        if (typeof updateEsp32Status === 'function') updateEsp32Status(false, "Disconnected", Date.now());
        if (typeof updateSystemStatus === 'function') updateSystemStatus(`Disconnected. Will retry in ${AppState.webSocketRetryInterval/1000}s.`);
        
        // Attempt to reconnect after a delay
        setTimeout(connectWebSocket, AppState.webSocketRetryInterval);
    };

    AppState.webSocket.onerror = function(error) {
        console.error("WebSocket error:", error);
        AppState.webSocketConnected = false;
        // onclose will usually be called after an error, so reconnection logic is there.
        if (typeof updateEsp32Status === 'function') updateEsp32Status(false, "Connection Error", Date.now());
        if (typeof updateSystemStatus === 'function') updateSystemStatus("Connection error.");
    };
}


// Wrapper for mode change
async function applyModeChangeWrapper() {
    const modeSelect = DOM.sensorModeSelector;
    if (!modeSelect) {
        console.error("Sensor mode selector not found.");
        if (typeof updateSystemStatus === 'function') updateSystemStatus("Internal UI error.");
        return;
    }
    const selectedModeValue = parseInt(modeSelect.value, 10);
    const selectedModeText = modeSelect.options[modeSelect.selectedIndex].text;
    
    if (typeof updateSystemStatus === 'function') updateSystemStatus(`Setting mode to ${selectedModeText}...`);

    // Optimistic UI Update
    let serverModeString = "UNKNOWN";
    if (selectedModeValue === 0) serverModeString = "ALL";
    else if (selectedModeValue === 1) serverModeString = "OUTER";
    else if (selectedModeValue === 2) serverModeString = "INNER";
    
    if (typeof updateShutterDisplay === 'function') {
        // Create a minimal rawData object for optimistic update
        const optimisticData = { 
            mode: serverModeString,
            s1_open_us: null, s1_close_us: null,
            s2_open_us: null, s2_close_us: null,
            s3_open_us: null, s3_close_us: null,
        };
        updateShutterDisplay(optimisticData); 
    }


    try {
        const result = await setEspMode(selectedModeValue); // from api.js
        if (result.success) {
            // Server will push new data via WebSocket automatically.
            // The updateEspModeDisplay is useful to ensure the dropdown reflects server confirmation.
            if (typeof updateEspModeDisplay === 'function') updateEspModeDisplay(result.mode_set);
            if (typeof updateSystemStatus === 'function') updateSystemStatus(`Mode set to ${result.mode_set}. Awaiting live data...`);
            // No explicit fetchDataWrapper() needed, WebSocket push will handle data update.
        } else {
            if (typeof updateSystemStatus === 'function') updateSystemStatus(`Mode set failed: ${result.message || 'Unknown error'}`);
            // Revert optimistic UI if mode set failed? Or wait for next WS data to correct.
            // For now, rely on next WS data or user re-selection.
        }
    } catch (error) {
        console.error("Error applying mode change:", error);
        if (typeof updateSystemStatus === 'function') updateSystemStatus(`Mode set error: ${error.message.substring(0,100)}`);
    }
}

// Wrapper for reset
async function manualResetWrapper() {
    if (typeof updateSystemStatus === 'function') updateSystemStatus("Sending reset command...");
     if (typeof updateShutterDisplay === 'function') { // Optimistic clear
        const optimisticData = { 
            mode: AppState.lastReceivedData ? AppState.lastReceivedData.mode : "ALL", // Keep current mode or default
            s1_open_us: null, s1_close_us: null,
            s2_open_us: null, s2_close_us: null,
            s3_open_us: null, s3_close_us: null,
        };
        updateShutterDisplay(optimisticData);
    }

    try {
        const result = await resetEspSystem(); // from api.js
        if (result.success) {
            if (typeof updateSystemStatus === 'function') updateSystemStatus("System reset. Awaiting live data...");
            if (typeof clearResultsLog === 'function') {
                clearResultsLog(); // Clear client-side log
            }
            // AppState.lastReceivedData = null; // Let WebSocket update this
            // No explicit fetchDataWrapper() needed.
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
        // If no data yet, WS should provide it. If WS not connected, it will try.
        if (!AppState.webSocketConnected) {
            connectWebSocket();
        }
        // No explicit fetch, rely on WS.
    }
}
window.triggerDisplayUpdate = triggerDisplayUpdate; // Make global for config-panel.js

document.addEventListener('DOMContentLoaded', function() {
    if (typeof initializeTabs === 'function') initializeTabs();
    if (typeof initializeConfigPanelInteraction === 'function') initializeConfigPanelInteraction();
    if (typeof initializeApiHandlers === 'function') initializeApiHandlers(); 

    if (DOM.sensorModeSelector) {
        DOM.sensorModeSelector.addEventListener('change', applyModeChangeWrapper);
    }
    
    const resetButton = document.getElementById('manualResetButton');
    if (resetButton) {
        resetButton.addEventListener('click', manualResetWrapper);
    } else {
        console.warn("Manual Reset Button not found in HTML.");
    }
    
    // Refresh button is no longer meaningful with WebSockets, can be removed from HTML
    const refreshButton = document.getElementById('refreshDataButton');
    if (refreshButton) {
        refreshButton.style.display = 'none'; // Hide it
        // refreshButton.addEventListener('click', fetchDataWrapper); // Old behavior
    }


    if (typeof renderResultsLogTable === 'function') renderResultsLogTable(); 
    
    if (DOM.timestampUnitSelector) {
        DOM.timestampUnitSelector.addEventListener('change', triggerDisplayUpdate);
    }

    if (typeof updateEsp32Status === 'function') updateEsp32Status(false, "Initializing...", null);
    if (typeof updateEspModeDisplay === 'function') updateEspModeDisplay("UNKNOWN"); // Set initial dropdown state
    
    connectWebSocket(); // Initial connection attempt

    // Expose functions to global scope if HTML uses onclick="...".
    window.applyModeChange = applyModeChangeWrapper; // Already set by event listener
    window.manualReset = manualResetWrapper; // Already set by event listener
    // window.refreshData = fetchDataWrapper; // fetchDataWrapper removed
});