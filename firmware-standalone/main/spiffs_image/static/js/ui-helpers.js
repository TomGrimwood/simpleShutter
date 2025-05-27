// ui-helpers.js (formerly t.js) - Refined

// Centralized DOM element references
const DOM = {
    configPanel: document.getElementById('configPanel'),
    toggleConfigButton: document.getElementById('toggleConfigButton'),
    configPanelContent: document.getElementById('configPanelContent'), // Added for collapse
    // comPortSelector: document.getElementById('comPortSelector'), // Removed, not used in ESP32 version
    sensorModeSelector: document.getElementById('sensorModeSelector'),
    totalSensorDistanceConfigInput: document.getElementById('totalSensorDistanceConfig'),
    calibrationTargetDistanceConfigInput: document.getElementById('calibrationTargetDistanceConfig'),
    timeScalingFactorDisplay: document.getElementById('timeScalingFactorDisplay'),
    timestampUnitSelector: document.getElementById('timestampUnitSelector'),
    errorDisplay: document.getElementById('error-display'),
    systemStatus: document.getElementById('systemStatus'), // Added

    // Main Table Data Cells
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
    ct_c2_intra_pct_var: document.getElementById('ct_c2_intra_pct_var'), // Check if this ID exists in HTML (it does)
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
};


// Helper function to set text content of an element (Improved from reference)
function setText(elementId, value, decimalPlaces = undefined, unit = '') {
    const element = DOM[elementId] || document.getElementById(elementId);
    if (element) {
        if (value === null || typeof value === 'undefined' ||
            (typeof value === 'number' && (isNaN(value) || !isFinite(value))) ||
            (typeof value === 'string' && (value.toLowerCase() === 'nan' || value.toLowerCase() === 'n/a' || value.toLowerCase() === '---' || value.toLowerCase() === 'inf'))) {
            element.textContent = '---';
        } else if (typeof value === 'number' && decimalPlaces !== undefined) {
            element.textContent = value.toFixed(decimalPlaces) + unit;
        } else {
            element.textContent = String(value) + unit;
        }
    } else {
        // console.warn(`Element with ID ${elementId} not found for setText.`);
    }
}

// Helper function to get text content from an element
function getText(elementId, defaultValue = '---') {
    const element = DOM[elementId] || document.getElementById(elementId);
    if (element && element.textContent && element.textContent.trim() !== '') {
        return element.textContent.trim();
    }
    return defaultValue;
}


// Helper function to format raw timestamps based on selected unit (Improved precision from reference)
function formatRawTimestamp(timestamp_us, unit) {
    if (timestamp_us === null || typeof timestamp_us === 'undefined' || timestamp_us === 0) return '---';
    const num_us = Number(timestamp_us);
    if (isNaN(num_us)) return '---';

    let value;
    switch (unit) {
        case 'ms':
            value = (num_us / 1000.0).toFixed(3); // Reference uses 3 for ms
            break;
        case 's':
            value = (num_us / 1000000.0).toFixed(6); // Reference uses 6 for s
            break;
        case 'us':
        default:
            value = Math.round(num_us); // Keep as integer for µs
            break;
    }
    return value;
}


// Tab navigation
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            button.classList.add('active');
            const tabContentElement = document.getElementById(button.dataset.tabId + "Content");
            if (tabContentElement) {
                tabContentElement.classList.add('active');
            } else {
                console.error("Tab content not found for ID: " + button.dataset.tabId + "Content");
            }
        });
    });
}

// Primary definition for updateSystemStatus
function updateSystemStatus(message) {
    if (DOM.systemStatus) {
        DOM.systemStatus.textContent = message;
    } else {
        console.log("System Status (ui-helpers.js):", message, "(DOM.systemStatus not found)");
    }
}
// Make it global if not already for wider access, though direct calls from main.js are better
window.updateSystemStatus = updateSystemStatus;