// Global application state
window.AppState = {
    lastReceivedData: null,
    currentBackendSerialPort: null, // Will be updated by API responses
};

function triggerDisplayUpdate() { // This function is called by config panel scaling changes
    if (window.AppState.lastReceivedData && window.AppState.lastReceivedData.shutter_metrics) {
        updateShutterDisplay(window.AppState.lastReceivedData.shutter_metrics); // from data-updater.js
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize UI elements and interactions
    initializeTabs(); // from ui-helpers.js
    // initializeModeTabs(); // Removed
    initializeConfigPanelInteraction(); // from config-panel.js
    
    // Initialize API related handlers
    initializeApiHandlers(); // from api.js
    populateComPortsDropdown(); // from api.js
    
    // Initialize data displays
    renderResultsLogTable(); // from results-log.js
    
    // Attach listener for timestamp unit changes
    DOM.timestampUnitSelector.addEventListener('change', triggerDisplayUpdate);

    // Start Server-Sent Events
    startSSE(); // from api.js
});