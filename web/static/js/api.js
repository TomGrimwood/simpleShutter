let eventSource = null;
// AppState.currentBackendSerialPort and AppState.lastReceivedData will be managed in main.js

function startSSE() {
    if (eventSource) { eventSource.close(); }
    eventSource = new EventSource("/stream");

    eventSource.onopen = function() {
        DOM.errorDisplay.innerHTML = ''; // Clear previous errors
    };

    eventSource.onmessage = function(event) {
        if (event.data === ": heartbeat" || event.data.startsWith(":")) { return; }
        try {
            var jsonData = JSON.parse(event.data);
            if (jsonData.shutter_metrics) {
                window.AppState.lastReceivedData = jsonData; // Store in global state
                updateShutterDisplay(jsonData.shutter_metrics); // from data-updater.js
            }
            if (jsonData.esp32_connection) {
                updateEsp32Status(jsonData.esp32_connection); // from data-updater.js
            }
            if (jsonData.esp32_mode_status) {
                updateEspModeDisplay(jsonData.esp32_mode_status); // from data-updater.js
            }
            if (jsonData.error) {
                DOM.errorDisplay.innerHTML = '<p class="error-message">SERVER STREAM ERROR: ' + jsonData.error + '</p>';
            } else if (jsonData.shutter_metrics && (!jsonData.shutter_metrics.errors || jsonData.shutter_metrics.errors.length === 0)) {
                // Clear server error if a valid message without calculation errors comes through
                if (DOM.errorDisplay.innerHTML.includes("SERVER STREAM ERROR")) {
                    DOM.errorDisplay.innerHTML = '';
                }
            }
        } catch (e) {
            console.error("Error parsing JSON from SSE:", e, "Raw data:", event.data);
            DOM.errorDisplay.innerHTML = '<p class="error-message">CLIENT ERROR: Malformed data from server. Check console.</p>';
        }
    };

    eventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        var espStatusEl = document.getElementById('esp32-connection-status');
        espStatusEl.textContent = "Comms Error";
        espStatusEl.className = 'data-value esp32-disconnected';
        // If current-mode-display was used for text, it would be:
        // document.getElementById('current-mode-display').textContent = '---';
        // Since it's a select now, we might reset it or let updateEspModeDisplay handle from next valid message
        if (DOM.sensorModeSelector) DOM.sensorModeSelector.value = "0"; // Reset to "All Sensors" on comms error
        
        document.getElementById('last-update').textContent = 'Error';
        eventSource.close();
        setTimeout(startSSE, 5000); // Attempt to reconnect
    };
}

function populateComPortsDropdown() {
    fetch('/get_com_ports')
        .then(response => response.json())
        .then(data => {
            DOM.comPortSelector.innerHTML = ''; // Clear existing options
            const initialAssumedPort = window.AppState.currentBackendSerialPort || "null";
            let finalPortToSelect = initialAssumedPort;

            if (data.ports && data.ports.length > 0) {
                DOM.comPortSelector.add(new Option("Select Port...", "null"));
                data.ports.forEach(port => {
                    let option = new Option(port, port);
                    DOM.comPortSelector.add(option);
                });

                const backendPortIsValidAndAvailable = initialAssumedPort !== "null" && data.ports.includes(initialAssumedPort);
                if (!backendPortIsValidAndAvailable && data.ports.length > 0) { // If backend port not in list, pick first
                    finalPortToSelect = data.ports[0];
                }
            } else {
                DOM.comPortSelector.add(new Option("No COM ports found", "null"));
                if (initialAssumedPort !== "null") { // If backend port was set, but no ports found now
                    finalPortToSelect = "null";
                }
            }
            
            DOM.comPortSelector.value = finalPortToSelect;

            // If the determined port is different from what the backend THINKS is active, dispatch change
            if (finalPortToSelect !== initialAssumedPort) {
                console.log(`Port selection automatically changed from '${initialAssumedPort}' to '${finalPortToSelect}'. Requesting port set.`);
                DOM.comPortSelector.dispatchEvent(new Event('change'));
            }
        })
        .catch(error => {
            console.error('Error fetching COM ports:', error);
            DOM.comPortSelector.innerHTML = '';
            DOM.comPortSelector.add(new Option("Error loading ports", "null"));
            // If error and backend thought a port was active, try to set to null
            const initialAssumedPortOnError = window.AppState.currentBackendSerialPort || "null";
            if (initialAssumedPortOnError !== "null") {
                DOM.comPortSelector.value = "null"; 
                DOM.comPortSelector.dispatchEvent(new Event('change')); 
            }
        });
}

function setComPort(port) {
    var espStatusEl = document.getElementById('esp32-connection-status');
    if (port === "null" || port === null) {
        if (window.AppState.currentBackendSerialPort && window.AppState.currentBackendSerialPort !== "null") {
            espStatusEl.textContent = "Disconnecting...";
        } else {
            espStatusEl.textContent = "Select COM Port";
        }
    } else {
        espStatusEl.textContent = "Switching to " + port + "...";
    }
    espStatusEl.className = 'data-value esp32-unknown';

    fetch('/set_com_port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: (port === "null" ? null : port) })
    })
    .then(response => response.json())
    .then(data => {
        console.log('Set COM port response:', data);
        // Backend will eventually send an esp32_connection update via SSE,
        // which will call updateEsp32Status and truly reflect the state.
        // This is just an immediate feedback for the user.
        if (data.status === 'error') {
             espStatusEl.textContent = data.message || "Error setting COM port.";
             espStatusEl.className = 'data-value esp32-disconnected';
        } else if (data.status === 'success' && data.message) {
            // espStatusEl.textContent = data.message; // Might be "Port set to COMx" or similar
        }
    })
    .catch(error => {
        console.error('Error setting COM port:', error);
        espStatusEl.textContent = "Port change error (client)";
        espStatusEl.className = 'data-value esp32-disconnected';
    });
}

function setEspMode(modeId) {
    fetch('/set_mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: parseInt(modeId) })
    })
    .then(response => response.json())
    .then(data => {
        console.log('Set mode response:', data);
        if (data.status === 'error') {
            console.error("Error setting ESP32 mode via backend:", data.message);
            // Optionally show an error to the user, e.g., in DOM.errorDisplay
            // DOM.errorDisplay.innerHTML = '<p class="error-message">SERVER ERROR: ' + data.message + '</p>';
        } else {
            // Success, ESP32 will confirm mode change via SSE (esp32_mode_status event)
            // The sensorModeSelector will update via that SSE event calling updateEspModeDisplay.
        }
    })
    .catch(error => {
        console.error('Error setting ESP32 mode (network/fetch):', error);
        // DOM.errorDisplay.innerHTML = '<p class="error-message">CLIENT ERROR: Could not send mode change. Check network.</p>';
    });
}

function initializeApiHandlers() {
    DOM.comPortSelector.addEventListener('change', function() {
        setComPort(this.value);
    });

    // Add event listener for the new sensor mode selector
    if (DOM.sensorModeSelector) {
        DOM.sensorModeSelector.addEventListener('change', function() {
            setEspMode(this.value);
        });
    }
}