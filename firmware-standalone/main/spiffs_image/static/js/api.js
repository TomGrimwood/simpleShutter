// api.js - ESP32 specific, largely unchanged

// Function to fetch data from the ESP32
async function getEspData() {
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

function initializeApiHandlers() {
    // This function is minimal as api.js primarily provides functions for other modules.
    // No direct DOM listeners are set up here.
    console.log("API functions (api.js) are available.");
}