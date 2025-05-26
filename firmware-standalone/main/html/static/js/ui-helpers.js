// ui-helpers.js

// Centralized DOM element references
const DOM = {
    configPanel: document.getElementById('configPanel'),
    toggleConfigButton: document.getElementById('toggleConfigButton'),
    comPortSelector: document.getElementById('comPortSelector'), // Will be null as it's removed from HTML
    sensorModeSelector: document.getElementById('sensorModeSelector'), // Added
    totalSensorDistanceConfigInput: document.getElementById('totalSensorDistanceConfig'),
    calibrationTargetDistanceConfigInput: document.getElementById('calibrationTargetDistanceConfig'),
    timeScalingFactorDisplay: document.getElementById('timeScalingFactorDisplay'),
    timestampUnitSelector: document.getElementById('timestampUnitSelector'),
    errorDisplay: document.getElementById('error-display'),
    // Add more common elements here if needed

    // Main Table Data Cells (example, add all relevant ones)
    exp_ms_s1: document.getElementById('exp_ms_s1'),
    exp_compare_s1s2: document.getElementById('exp_compare_s1s2'),
    exp_ms_s2: document.getElementById('exp_ms_s2'),
    exp_compare_s2s3: document.getElementById('exp_compare_s2s3'),
    exp_ms_s3: document.getElementById('exp_ms_s3'),
    exp_ms_avg: document.getElementById('exp_ms_avg'),
    hz_s1: document.getElementById('hz_s1'),
    hz_s2: document.getElementById('hz_s2'),
    hz_s3: document.getElementById('hz_s3'),
    hz_avg: document.getElementById('hz_avg'),
    
    ct_c1_s1s2_time: document.getElementById('ct_c1_s1s2_time'),
    ct_c1_intra_pct_var: document.getElementById('ct_c1_intra_pct_var'),
    ct_c1_s2s3_time: document.getElementById('ct_c1_s2s3_time'),
    ct_c1_total_time: document.getElementById('ct_c1_total_time'),
    
    ct_c1c2_s1s2_compare_pct: document.getElementById('ct_c1c2_s1s2_compare_pct'),
    ct_c1c2_s2s3_compare_pct: document.getElementById('ct_c1c2_s2s3_compare_pct'),
    ct_c1c2_total_compare_pct: document.getElementById('ct_c1c2_total_compare_pct'),
    
    ct_c2_s1s2_time: document.getElementById('ct_c2_s1s2_time'),
    ct_c2_intra_pct_var: document.getElementById('ct_c2_intra_pct_var'),
    ct_c2_s2s3_time: document.getElementById('ct_c2_s2s3_time'),
    ct_c2_total_time: document.getElementById('ct_c2_total_time'),
    
    open_time_duration_ms: document.getElementById('open_time_duration_ms'),
    slit_width_mm: document.getElementById('slit_width_mm'),
    exp_var_pct: document.getElementById('exp_var_pct'),
    
    raw_s1: document.getElementById('raw_s1'),
    raw_s2: document.getElementById('raw_s2'),
    raw_s3: document.getElementById('raw_s3'),
    
    // Status elements
    esp32ConnectionStatus: document.getElementById('esp32-connection-status'),
    lastUpdate: document.getElementById('last-update'),
    // sensorModeDisplay: document.getElementById('current-sensor-mode') // This ID might change or be handled differently
};


// Helper function to set text content of an element
function setText(elementId, value, decimalPlaces = undefined, unit = '') {
    const element = DOM[elementId] || document.getElementById(elementId); // Try DOM cache first
    if (element) {
        if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
            element.textContent = '---';
        } else if (typeof value === 'number' && decimalPlaces !== undefined) {
            element.textContent = value.toFixed(decimalPlaces) + unit;
        } else {
            element.textContent = value + unit;
        }
    } else {
        // console.warn(`Element with ID ${elementId} not found for setText.`);
    }
}

// Helper function to get text content from an element
function getText(elementId, defaultValue = '---') {
    const element = DOM[elementId] || document.getElementById(elementId);
    return element ? element.textContent : defaultValue;
}


// Helper function to format raw timestamps based on selected unit
function formatRawTimestamp(timestamp_us, unit) {
    if (timestamp_us === null || timestamp_us === undefined || timestamp_us === 0) return '---';
    let value;
    switch (unit) {
        case 'ms':
            value = (timestamp_us / 1000.0).toFixed(2);
            break;
        case 's':
            value = (timestamp_us / 1000000.0).toFixed(4);
            break;
        case 'us':
        default:
            value = Math.round(timestamp_us); // Keep as integer for µs
            break;
    }
    return value; // Unit suffix is handled by the table header or context
}


// Tab navigation
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Deactivate all tabs and hide all content
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // Activate clicked tab and show its content
            button.classList.add('active');
            document.getElementById(button.dataset.tabId + "Content").classList.add('active');
        });
    });
}

// Ensure this file defines updateSystemStatus if not defined elsewhere (e.g. main.js or data-updater.js)
// This is a common utility.
if (typeof updateSystemStatus === 'undefined') {
    window.updateSystemStatus = function(message) {
        const statusEl = document.getElementById('systemStatus'); // Ensure this ID matches your HTML
        if (statusEl) {
            statusEl.textContent = message;
        }
        console.log("Status (ui-helpers.js fallback):", message);
    };
}
