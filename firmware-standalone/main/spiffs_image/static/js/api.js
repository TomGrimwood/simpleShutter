// api.js - Handles WebSocket communication and mock data
// Depends on ui-helpers.js for updateSystemStatus (via window)

let webSocket;
const wsCallbacks = { onOpen: null, onMessage: null, onError: null, onClose: null };
let mockInterval = null;
let currentMockMode = "ALL"; // Start mock in ALL mode

// NEW: Flag to indicate if we are in a full mock environment (both WS and HTTP APIs)
let isMockMode = false;

function connectWebSocket(callbacks) {
    // Ensure updateSystemStatus is available from ui-helpers.js via the global scope
    if (typeof window.updateSystemStatus !== 'function') {
        console.error("connectWebSocket failed: updateSystemStatus helper not available.");
        // Cannot proceed without basic status updates
        return;
    }

    Object.assign(wsCallbacks, callbacks);
    // Determine WebSocket URL based on the current window's protocol and host
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    
    console.log("Attempting WS connection:", wsUrl);
    window.updateSystemStatus("Attempting WS connection...");

    // Check if WebSocket is available or if running locally from a file
    // MODIFIED: Also check if hostname is localhost, which implies http.server is used
    if (typeof WebSocket === 'undefined' || window.location.protocol === 'file:' || window.location.hostname === '127.0.0.1') {
        console.warn("WebSocket not supported, running from file://, or on localhost. Using mock WebSocket and HTTP APIs.");
        window.updateSystemStatus("Using Mock WebSocket (no backend connection).");
        isMockMode = true; // Set mock mode flag
        mockWebSocket();
        if (wsCallbacks.onOpen) wsCallbacks.onOpen({type: 'open_mock'}); // Trigger mock open event
        return;
    }

    try {
        webSocket = new WebSocket(wsUrl);

        webSocket.onopen = (e) => {
            console.log("WS open:", wsUrl);
            if(wsCallbacks.onOpen) wsCallbacks.onOpen(e);
        };

        webSocket.onmessage = (e) => {
            // console.log("WS msg:", e.data); // Uncomment for detailed message logging
            if(wsCallbacks.onMessage) wsCallbacks.onMessage(e.data);
        };

        webSocket.onerror = (e) => {
            console.error("WS error:", e);
            if(wsCallbacks.onError) wsCallbacks.onError(e);
        };

        webSocket.onclose = (e) => {
            console.log("WS closed.", e);
            if(wsCallbacks.onClose) wsCallbacks.onClose(e);
        };

    } catch (e) {
        console.error("WS creation failed:", e);
        window.updateSystemStatus("WS creation failed.");
        // Fallback to mock WebSocket if native WebSocket creation fails
        isMockMode = true; // Set mock mode flag
        mockWebSocket();
        if (wsCallbacks.onOpen) wsCallbacks.onOpen({type: 'open_mock_fallback'});
    }
}

function mockWebSocket() {
    webSocket = {
        // Simulate readyState: 0 (CONNECTING), 1 (OPEN), 2 (CLOSING), 3 (CLOSED)
        readyState: 1,
        send: (data) => {
            console.log("Mock WS Send:", data);
            try {
                const cmd = JSON.parse(data);
                if (cmd.command === "setmode") {
                    currentMockMode = ["ALL", "OUTER", "INNER"][cmd.mode] || "ALL";
                    // Simulate delay before sending mock data for the new mode
                    setTimeout(()=>generateMockData(currentMockMode), 200);
                } else if (cmd.command === "reset") {
                    // Simulate a reset - maybe clear data and send an initial state
                    if (window.stagedResults) window.stagedResults = []; // Assuming stagedResults is global
                    if (typeof renderStagingTable === 'function') renderStagingTable(); // Assuming renderStagingTable is global
                    setTimeout(()=>generateMockData("ALL"), 500); // Reset to ALL after a delay
                }
            } catch(e){
                console.error("Mock WS parse error", e);
            }
        },
        close: () => {
            webSocket.readyState = 3;
            clearInterval(mockInterval); // Stop sending mock data
            console.log("Mock WS Close");
            // Simulate close event
            if(wsCallbacks.onClose) wsCallbacks.onClose({code: 1000, reason: "Mock close"});
        },
        // Add a mock URL property for consistency
        url: "mock:precision-shutter-diag"
    };

    // Start sending mock data periodically
    const generateMockData = (mode) => {
        const data = {
            mode: mode.toUpperCase(),
            s1_open_us: null, s1_close_us: null,
            s2_open_us: null, s2_close_us: null,
            s3_open_us: null, s3_close_us: null,
            error: null // Simulate no device errors in mock data
        };

        const baseOpen = Date.now() % 100000; // Simulate a changing start time
        const baseExpTime = 5000; // Base exposure time in microseconds
        const travelTime = 1000; // Base travel time between sensors in microseconds
        const variance = 200; // Variance for adding randomness

        // Add mock data based on mode
        const m = data.mode;
        if (m === "ALL" || m === "OUTER") {
            data.s1_open_us = baseOpen + ~~(Math.random() * variance);
            data.s1_close_us = data.s1_open_us + baseExpTime + ~~(Math.random() * variance - variance/2);
        }
        if (m === "ALL") {
            // S2 opens after S1 open + travel time
            data.s2_open_us = (data.s1_open_us || baseOpen) + travelTime + ~~(Math.random() * variance);
            data.s2_close_us = data.s2_open_us + baseExpTime + ~~(Math.random() * variance - variance/2);
        }
         if (m === "INNER") {
            data.s2_open_us = baseOpen + ~~(Math.random() * variance);
            data.s2_close_us = data.s2_open_us + baseExpTime + ~~(Math.random() * variance - variance/2);
        }
        if (m === "ALL" || m === "OUTER") {
             // S3 opens after S2 open + travel time (if ALL), or S1 open + total travel (if OUTER)
            let prevOpen = (m === "ALL" && data.s2_open_us) ? data.s2_open_us : (data.s1_open_us || baseOpen);
            data.s3_open_us = prevOpen + travelTime + ~~(Math.random() * variance);
            data.s3_close_us = data.s3_open_us + baseExpTime + ~~(Math.random() * variance - variance/2);
        }

        // Ensure close times are after open times, adjust slightly if not
        if (data.s1_open_us > 0 && data.s1_close_us <= data.s1_open_us) data.s1_close_us = data.s1_open_us + baseExpTime;
        if (data.s2_open_us > 0 && data.s2_close_us <= data.s2_open_us) data.s2_close_us = data.s2_open_us + baseExpTime;
        if (data.s3_open_us > 0 && data.s3_close_us <= data.s3_open_us) data.s3_close_us = data.s3_open_us + baseExpTime;


        // Simulate timing errors occasionally
        if (Math.random() < 0.05) { // 5% chance of an error
            const errorType = Math.floor(Math.random() * 3);
            if (errorType === 0 && data.s1_open_us > 0 && data.s2_open_us > 0) { // Simulate S2 open before S1
                 let temp = data.s1_open_us; data.s1_open_us = data.s2_open_us - 50; data.s2_open_us = temp;
                 data.error = "Simulated S2 open before S1 error";
            } else if (errorType === 1 && data.s1_close_us > 0 && data.s2_close_us > 0) { // Simulate S2 close before S1
                 let temp = data.s1_close_us; data.s1_close_us = data.s2_close_us - 50; data.s2_close_us = temp;
                  data.error = "Simulated S2 close before S1 error";
            } else if (errorType === 2) { // Simulate missing data
                 const sensorToRemove = Math.floor(Math.random() * 3) + 1;
                 if (sensorToRemove === 1) { data.s1_open_us = null; data.s1_close_us = null; data.error = "Simulated S1 data missing"; }
                 if (sensorToRemove === 2) { data.s2_open_us = null; data.s2_close_us = null; data.error = "Simulated S2 data missing"; }
                 if (sensorToRemove === 3) { data.s3_open_us = null; data.s3_close_us = null; data.error = "Simulated S3 data missing"; }
            }
             window.updateSystemStatus("Mock device error: " + data.error);
        }


        // Send the generated data
        if (wsCallbacks.onMessage) wsCallbacks.onMessage(JSON.stringify(data));
    };

    // Clear any existing mock interval and set a new one
    clearInterval(mockInterval);
    // CHANGE THIS LINE FOR MOCK DATA INTERVAL
    mockInterval = setInterval(()=>generateMockData(currentMockMode), 2000); // Send data every 2 seconds
}

async function setEspMode(modeId) {
    if(isMockMode) {
        console.log(`Mocking setEspMode to mode: ${modeId}`);
        currentMockMode = ["ALL", "OUTER", "INNER"][modeId] || "ALL"; // Update mock mode
        // Simulate immediate response
        setTimeout(() => generateMockData(currentMockMode), 100); // Trigger a mock data update
        return {success:true, message: "Mock mode set successfully."};
    }
    // Original logic for real device:
    if(webSocket && webSocket.readyState === 1) {
        try {
             webSocket.send(JSON.stringify({command:"setmode", mode:parseInt(modeId)}));
             return {success:true};
        } catch (e) {
            console.error("Error sending setmode command:", e);
            return {success:false, message: e.message || "Failed to send command."};
        }
    }
    console.warn("WS not open for setEspMode");
    return {success:false, message:"WebSocket connection not open."};
}

async function resetEspSystem() {
    if(isMockMode) {
        console.log("Mocking resetEspSystem...");
        if (window.stagedResults) window.stagedResults = []; // Simulate clearing staged results
        if (typeof renderStagingTable === 'function') renderStagingTable(); // Re-render staging
        // Simulate immediate response and then a data update
        setTimeout(() => generateMockData("ALL"), 500);
        return {success:true, message: "Mock reset successful."};
    }
    // Original logic for real device:
    if(webSocket && webSocket.readyState === 1) {
         try {
             webSocket.send(JSON.stringify({command:"reset"}));
             return {success:true};
        } catch (e) {
            console.error("Error sending reset command:", e);
            return {success:false, message: e.message || "Failed to send command."};
        }
    }
    console.warn("WS not open for resetEspSystem");
    return {success:false, message:"WebSocket connection not open."};
}

// NEW: Mock implementations for WiFi Configuration API calls
async function getWifiStatus() {
    if(isMockMode) {
        console.log("Mocking getWifiStatus...");
        return new Promise(resolve => {
            setTimeout(() => {
                const mockData = {
                    mode: Math.random() > 0.6 ? 'STA' : 'AP', // More likely STA
                    isConnected: Math.random() > 0.1, // 90% chance of being connected
                    ssid: 'Mock_WiFi_Network',
                    ipAddress: '192.168.1.101',
                    rssi: -50 - Math.floor(Math.random() * 20) // -50 to -70 dBm
                };
                if (!mockData.isConnected) {
                    mockData.ssid = 'N/A';
                    mockData.ipAddress = '0.0.0.0';
                    mockData.rssi = 0;
                }
                if (mockData.mode === 'AP') {
                    mockData.ssid = 'ESP32_Shutter_AP';
                    mockData.ipAddress = '192.168.4.1';
                    mockData.isConnected = true; // AP is always "connected" to itself
                }
                resolve({ success: true, data: mockData });
            }, 300); // Simulate a slight delay for API calls
        });
    }
    // Original fetch logic for actual device:
    try {
        const response = await fetch('/api/wifi/status');
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return { success: true, data: await response.json() };
    } catch (error) {
        console.error("Error fetching WiFi status:", error);
        return { success: false, message: error.message };
    }
}

async function setWifiCredentials(ssid, password, forceAp) {
    if(isMockMode) {
        console.log(`Mocking setWifiCredentials - SSID: ${ssid}, Password: ${password ? '*****' : '[empty]'}, Force AP: ${forceAp}`);
        return new Promise(resolve => {
            setTimeout(() => {
                // Simulate success or failure
                if (ssid === 'fail') { // Example: type "fail" in SSID to simulate error
                    resolve({ success: false, message: "Mock: Failed to save due to simulated error." });
                } else {
                    resolve({ success: true, message: "Mock: WiFi settings saved and reboot triggered." });
                }
            }, 500);
        });
    }
    // Original fetch logic for actual device:
    try {
        const response = await fetch('/api/wifi/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssid, password, forceAp })
        });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return { success: true, message: await response.text() };
    } catch (error) {
        console.error("Error setting WiFi credentials:", error);
        return { success: false, message: error.message };
    }
}

async function forgetWifi() {
    if(isMockMode) {
        console.log("Mocking forgetWifi...");
        return new Promise(resolve => {
            setTimeout(() => {
                resolve({ success: true, message: "Mock: WiFi credentials forgotten and reboot triggered." });
            }, 500);
        });
    }
    // Original fetch logic for actual device:
    try {
        const response = await fetch('/api/wifi/forget', { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return { success: true, message: await response.text() };
    } catch (error) {
        console.error("Error forgetting WiFi credentials:", error);
        return { success: false, message: error.message };
    }
}

// REMOVED revertToStaMode from the main app, so its mock is no longer needed
// async function revertToStaMode() { /* ... */ }


// NEW: Mock for Device Reboot API call
async function rebootEsp() {
    if(isMockMode) {
        console.log("Mocking rebootEsp...");
        return new Promise(resolve => {
            setTimeout(() => {
                console.log("Mock: Device reboot simulation complete.");
                resolve({ success: true, message: "Mock: Device is rebooting." });
            }, 1000); // Simulate a longer reboot time
        });
    }
    // Original fetch logic for actual device:
    try {
        const response = await fetch('/api/reboot', { method: 'POST' });
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return { success: true, message: await response.text() };
    } catch (error) {
        console.error("Error rebooting ESP:", error);
        return { success: false, message: error.message };
    }
}

// This function doesn't do much in the original code, but serves as an initialization point
function initializeApiHandlers() {
    console.log("API functions (connectWebSocket, setEspMode, resetEspSystem, getWifiStatus, setWifiCredentials, forgetWifi, rebootEsp) are available.");
}