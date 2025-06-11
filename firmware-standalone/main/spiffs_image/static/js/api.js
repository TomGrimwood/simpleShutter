// api.js - Handles WebSocket communication and HTTP API calls
// Depends on ui-helpers.js for updateSystemStatus (via window)

let webSocket;
const wsCallbacks = { onOpen: null, onMessage: null, onError: null, onClose: null };
let clientSideMockInterval = null; // Renamed to avoid confusion
let currentClientSideMockMode = "ALL"; // For client-side mock

// --- Configuration for Target Endpoint ---
// SET THIS TO true TO TARGET YOUR RUST SERVER
// SET THIS TO false TO TARGET ESP32 (window.location.host) OR FALLBACK TO CLIENT-SIDE JS MOCK
const USE_RUST_MOCK_SERVER = true; 

const RUST_MOCK_SERVER_BASE_URL = 'http://localhost:8080';
const RUST_MOCK_SERVER_WS_URL = 'ws://localhost:8080/ws';

// Flag to indicate if we are using the client-side JavaScript mock (not the Rust server)
let usingClientSideJsMock = false;


function connectWebSocket(callbacks) {
    if (typeof window.updateSystemStatus !== 'function') {
        console.error("connectWebSocket failed: updateSystemStatus helper not available.");
        return;
    }

    Object.assign(wsCallbacks, callbacks);

    let wsUrlToConnect;
    let targetDescription;

    if (USE_RUST_MOCK_SERVER) {
        wsUrlToConnect = RUST_MOCK_SERVER_WS_URL;
        targetDescription = "Rust Mock Server";
        usingClientSideJsMock = false; // Explicitly not using client-side JS mock
        console.log(`Configured to target Rust Mock Server WebSocket: ${wsUrlToConnect}`);
    } else {
        // Original logic for ESP32 or client-side JS mock
        wsUrlToConnect = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
        targetDescription = "ESP32 Device";
        
        // Check conditions for falling back to client-side JS mock
        if (typeof WebSocket === 'undefined' || window.location.protocol === 'file:' || 
            (window.location.hostname === '127.0.0.1' && window.location.port !== '8080')) { // Avoid client mock if viewing Rust server UI from 127.0.0.1:8080
            
            console.warn("WebSocket not supported, running from file://, or on a local dev server (not the Rust mock). Using client-side JavaScript mock for WebSocket and HTTP APIs.");
            window.updateSystemStatus("Using Client-Side JS Mock (no backend connection).");
            usingClientSideJsMock = true;
            initializeClientSideMockWebSocket(); // Initialize the client-side JS mock
            if (wsCallbacks.onOpen) wsCallbacks.onOpen({type: 'open_client_side_js_mock'});
            return; // Exit, as we are now in client-side mock mode
        }
    }
    
    console.log(`Attempting WebSocket connection to ${targetDescription}: ${wsUrlToConnect}`);
    window.updateSystemStatus(`Attempting WebSocket connection to ${targetDescription}...`);

    try {
        webSocket = new WebSocket(wsUrlToConnect);

        webSocket.onopen = (event) => {
            console.log(`WebSocket open to ${targetDescription}:`, wsUrlToConnect, event);
            if(wsCallbacks.onOpen) wsCallbacks.onOpen(event);
        };

        webSocket.onmessage = (event) => {
            // console.log("WS msg from " + targetDescription + ":", event.data); 
            if(wsCallbacks.onMessage) wsCallbacks.onMessage(event.data);
        };

        webSocket.onerror = (event) => {
            console.error(`WebSocket error with ${targetDescription}:`, event);
            if(wsCallbacks.onError) wsCallbacks.onError(event);
            // If USE_RUST_MOCK_SERVER is true and connection fails, do not fall back to client-side mock.
            // The user intends to test the Rust server.
        };

        webSocket.onclose = (event) => {
            console.log(`WebSocket closed with ${targetDescription}. Code: ${event.code}, Reason: ${event.reason || 'N/A'}`, event);
            if(wsCallbacks.onClose) wsCallbacks.onClose(event);
        };

    } catch (error) {
        console.error(`WebSocket creation failed for ${targetDescription}:`, error);
        window.updateSystemStatus(`WebSocket creation failed for ${targetDescription}. Check console.`);
        // If USE_RUST_MOCK_SERVER is true and creation fails, do not fall back.
    }
}

// Client-Side JavaScript Mock WebSocket (only used if USE_RUST_MOCK_SERVER is false and other conditions met)
function initializeClientSideMockWebSocket() {
    webSocket = {
        readyState: 1, // Simulate OPEN state
        send: (data) => {
            console.log("Client-Side JS Mock WS Send:", data);
            try {
                const cmd = JSON.parse(data);
                if (cmd.command === "setmode") {
                    currentClientSideMockMode = ["ALL", "OUTER", "INNER"][cmd.mode] || "ALL";
                    setTimeout(() => generateClientSideMockData(currentClientSideMockMode), 200);
                } else if (cmd.command === "reset") {
                    if (window.stagedResults) window.stagedResults = [];
                    if (typeof renderStagingTable === 'function') renderStagingTable();
                    setTimeout(() => generateClientSideMockData("ALL"), 500);
                }
            } catch(e){
                console.error("Client-Side JS Mock WS parse error", e);
            }
        },
        close: () => {
            webSocket.readyState = 3; // Simulate CLOSED state
            clearInterval(clientSideMockInterval);
            console.log("Client-Side JS Mock WS Close");
            if(wsCallbacks.onClose) wsCallbacks.onClose({code: 1000, reason: "Client-side mock close", type: 'close_client_side_js_mock'});
        },
        url: "mock:client-side-js-shutter-diag" // Mock URL
    };

    const generateClientSideMockData = (mode) => {
        const data = { /* ... (same mock data generation logic as before) ... */ 
            mode: mode.toUpperCase(), s1_open_us: null, s1_close_us: null,
            s2_open_us: null, s2_close_us: null, s3_open_us: null, s3_close_us: null, error: null
        };
        const baseOpen = Date.now() % 100000; const baseExpTime = 5000;
        const travelTime = 1000; const variance = 200;
        const m = data.mode;
        if (m === "ALL" || m === "OUTER") { data.s1_open_us = baseOpen + ~~(Math.random() * variance); data.s1_close_us = data.s1_open_us + baseExpTime + ~~(Math.random() * variance - variance/2); }
        if (m === "ALL") { data.s2_open_us = (data.s1_open_us || baseOpen) + travelTime + ~~(Math.random() * variance); data.s2_close_us = data.s2_open_us + baseExpTime + ~~(Math.random() * variance - variance/2); }
        if (m === "INNER") { data.s2_open_us = baseOpen + ~~(Math.random() * variance); data.s2_close_us = data.s2_open_us + baseExpTime + ~~(Math.random() * variance - variance/2); }
        if (m === "ALL" || m === "OUTER") { let prevOpen = (m === "ALL" && data.s2_open_us) ? data.s2_open_us : (data.s1_open_us || baseOpen); data.s3_open_us = prevOpen + travelTime + ~~(Math.random() * variance); data.s3_close_us = data.s3_open_us + baseExpTime + ~~(Math.random() * variance - variance/2); }
        if (data.s1_open_us > 0 && data.s1_close_us <= data.s1_open_us) data.s1_close_us = data.s1_open_us + baseExpTime;
        if (data.s2_open_us > 0 && data.s2_close_us <= data.s2_open_us) data.s2_close_us = data.s2_open_us + baseExpTime;
        if (data.s3_open_us > 0 && data.s3_close_us <= data.s3_open_us) data.s3_close_us = data.s3_open_us + baseExpTime;
        if (Math.random() < 0.05) { data.error = "Simulated JS Mock Device Error"; window.updateSystemStatus("Mock device error: " + data.error); }
        if (wsCallbacks.onMessage) wsCallbacks.onMessage(JSON.stringify(data));
    };

    clearInterval(clientSideMockInterval);
    clientSideMockInterval = setInterval(() => generateClientSideMockData(currentClientSideMockMode), 2000);
}

// --- API Command Functions ---
// These functions determine whether to use client-side mock, Rust mock, or target the ESP32.

async function sendCommandViaWebSocket(commandPayload) {
    if (usingClientSideJsMock && webSocket && typeof webSocket.send === 'function') {
        webSocket.send(JSON.stringify(commandPayload)); // Client-side mock handles its own send
        return { success: true, message: "Command sent to Client-Side JS Mock." };
    }
    
    if (webSocket && webSocket.readyState === 1) { // WebSocket.OPEN
        try {
            webSocket.send(JSON.stringify(commandPayload));
            const target = USE_RUST_MOCK_SERVER ? "Rust Mock Server" : "ESP32 Device";
            console.log(`Sent command via WebSocket to ${target}:`, commandPayload);
            return { success: true, message: `Command sent to ${target}.` };
        } catch (error) {
            console.error("Error sending command via WebSocket:", error);
            return { success: false, message: error.message || "Failed to send command via WebSocket." };
        }
    }
    
    console.warn("WebSocket not open for sending command:", commandPayload);
    return { success: false, message: "WebSocket connection not open." };
}

async function setEspMode(modeId) {
    return await sendCommandViaWebSocket({ command: "setmode", mode: parseInt(modeId) });
}

async function resetEspSystem() {
    if (usingClientSideJsMock) { // Special handling for client-side mock reset if needed
        if (window.stagedResults) window.stagedResults = [];
        if (typeof renderStagingTable === 'function') renderStagingTable();
    }
    return await sendCommandViaWebSocket({ command: "reset" });
}

// --- HTTP API Call Functions ---

async function fetchFromApi(path, options = {}) {
    let apiUrl;
    let targetDescription;

    if (USE_RUST_MOCK_SERVER) {
        apiUrl = `${RUST_MOCK_SERVER_BASE_URL}${path}`;
        targetDescription = "Rust Mock Server";
    } else {
        apiUrl = path; // Relative path for ESP32
        targetDescription = "ESP32 Device";
    }
    
    console.log(`Fetching from ${targetDescription}: ${options.method || 'GET'} ${apiUrl}`);

    try {
        const response = await fetch(apiUrl, options);
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Could not retrieve error text.");
            throw new Error(`HTTP error! Status: ${response.status} - ${errorText} from ${targetDescription} (${apiUrl})`);
        }
        // Check if response is JSON or text
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            return { success: true, data: await response.json() };
        } else {
            return { success: true, message: await response.text() };
        }
    } catch (error) {
        console.error(`Error during fetch from ${targetDescription} (${apiUrl}):`, error);
        window.updateSystemStatus(`API Error with ${targetDescription}: ${error.message.substring(0,100)}...`);
        return { success: false, message: error.message };
    }
}


async function getWifiStatus() {
    if (usingClientSideJsMock) {
        console.log("Client-Side JS Mocking getWifiStatus...");
        return new Promise(resolve => setTimeout(() => resolve({ success: true, data: { mode: 'AP', isConnected: true, ssid: 'ClientMock_AP', ipAddress: '192.168.4.1', rssi: 0 } }), 300));
    }
    return await fetchFromApi('/api/wifi/status');
}

async function setWifiCredentials(ssid, password, forceAp) {
    if (usingClientSideJsMock) {
        console.log(`Client-Side JS Mocking setWifiCredentials - SSID: ${ssid}`);
        return new Promise(resolve => setTimeout(() => resolve({ success: true, message: "Client-side JS mock WiFi settings saved." }), 500));
    }
    return await fetchFromApi('/api/wifi/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid, password, force_ap: forceAp }) // Ensure key is force_ap for Rust server
    });
}

async function forgetWifi() {
    if (usingClientSideJsMock) {
        console.log("Client-Side JS Mocking forgetWifi...");
        return new Promise(resolve => setTimeout(() => resolve({ success: true, message: "Client-side JS mock WiFi credentials forgotten." }), 500));
    }
    return await fetchFromApi('/api/wifi/forget', { method: 'POST' });
}

async function rebootEsp() {
    if (usingClientSideJsMock) {
        console.log("Client-Side JS Mocking rebootEsp...");
        return new Promise(resolve => setTimeout(() => {
            console.log("Client-Side JS Mock: Device reboot simulation complete.");
            resolve({ success: true, message: "Client-Side JS Mock: Device is rebooting." });
        }, 1000));
    }
    return await fetchFromApi('/api/reboot', { method: 'POST' });
}

function initializeApiHandlers() {
    console.log("API functions initialized.");
    if (USE_RUST_MOCK_SERVER) {
        console.info(`%c---> TARGETING RUST MOCK SERVER at ${RUST_MOCK_SERVER_BASE_URL} (WS: ${RUST_MOCK_SERVER_WS_URL}) <---`, "color: yellow; font-weight: bold;");
        window.updateSystemStatus(`Targeting Rust Mock Server.`);
    } else if (usingClientSideJsMock) {
        console.info("%c---> USING CLIENT-SIDE JAVASCRIPT MOCK APIs <---", "color: orange; font-weight: bold;");
         window.updateSystemStatus(`Using Client-Side JS Mock APIs.`);
    } else {
        console.info("%c---> TARGETING ESP32 DEVICE (default behavior) <---", "color: cyan; font-weight: bold;");
        window.updateSystemStatus(`Targeting ESP32 Device.`);
    }
}