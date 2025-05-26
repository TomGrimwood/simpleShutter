// AppState.currentBackendSerialPort and AppState.lastReceivedData will be managed in main.js
// No EventSource or SSE logic needed for ESP32 direct API interaction.

// Function to fetch data from the ESP32
async function getEspData() {
    // console.log("getEspData called"); // Optional: for debugging
    const response = await fetch('/api/getdata');
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error fetching data: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    return await response.json();
}

// Function to set the ESP32 measurement mode
async function setEspMode(modeId) {
    // console.log(`setEspMode called with modeId: ${modeId}`); // Optional: for debugging
    const response = await fetch('/api/setmode', { // Changed from /set_mode
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
    // console.log("resetEspSystem called"); // Optional: for debugging
    const response = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' } // Body not strictly needed but good practice
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error resetting system: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    return await response.json();
}

function initializeApiHandlers() {
    // COM port selector is removed from HTML, so no listener needed for it.
    // DOM.comPortSelector.addEventListener('change', function() {
    //     setComPort(this.value); // This function is removed
    // });

    // Event listener for the sensor mode selector (defined in ui-helpers.js -> DOM.sensorModeSelector)
    // This is typically handled in main.js or by directly calling from HTML onclick attribute.
    // For now, ensure this function is available if main.js calls it.
    // If the button/select in HTML calls a global function (e.g. applyModeChange in the new index.html),
    // that global function will then call setEspMode.
    // So, direct DOM manipulation here for sensorModeSelector might be redundant if main.js handles it.
    // Let's assume main.js or HTML attributes will call global functions that then use these API functions.
    console.log("API Handlers (within api.js) initialized - primarily providing functions for other modules.");
}

// Expose functions to global scope if they are called directly from HTML attributes
// or if other scripts expect them to be global.
// Otherwise, they can be imported/used by main.js or other controlling scripts.
// For this adaptation, we assume main.js will orchestrate calls.
