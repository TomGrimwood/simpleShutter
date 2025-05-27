// api.js - ESP32 specific, largely unchanged

let webSocket;
const wsCallbacks = {
    onOpen: null,
    onMessage: null,
    onError: null,
    onClose: null,
};

function connectWebSocket(callbacks) {
    if (callbacks) {
        wsCallbacks.onOpen = callbacks.onOpen;
        wsCallbacks.onMessage = callbacks.onMessage;
        wsCallbacks.onError = callbacks.onError;
        wsCallbacks.onClose = callbacks.onClose;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log("Attempting to connect to WebSocket:", wsUrl);
    webSocket = new WebSocket(wsUrl);

    webSocket.onopen = (event) => {
        console.log("WebSocket connection established to " + wsUrl);
        if (wsCallbacks.onOpen) wsCallbacks.onOpen(event);
    };

    webSocket.onmessage = (event) => {
        if (wsCallbacks.onMessage) wsCallbacks.onMessage(event.data);
    };

    webSocket.onerror = (event) => {
        console.error("WebSocket error:", event);
        if (wsCallbacks.onError) wsCallbacks.onError(event);
    };

    webSocket.onclose = (event) => {
        console.log(`WebSocket connection closed. Code: ${event.code}, Reason: "${event.reason}", Clean: ${event.wasClean}`);
        if (wsCallbacks.onClose) wsCallbacks.onClose(event);
    };
}

// Function to set the ESP32 measurement mode
async function setEspMode(modeId) {
    const response = await fetch('/api/setmode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: parseInt(modeId) })
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error setting mode: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    return await response.json();
}

// Function to reset the ESP32 sensor system
async function resetEspSystem() {
    const response = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error resetting system: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    return await response.json();
}

// Function to send data (if needed, though primary flow is server-to-client for shutter data)
function sendWebSocketMessage(message) {
    if (webSocket && webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(message);
    } else {
        console.warn("WebSocket not open. Cannot send message.");
    }
}
function initializeApiHandlers() {
    // This function is minimal as api.js primarily provides functions for other modules.
    // No direct DOM listeners are set up here.
    console.log("API functions (api.js) are available.");
}