// Global DOM Elements (cached for performance)
const DOM = {
    configPanel: document.getElementById('configPanel'),
    toggleConfigButton: document.getElementById('toggleConfigButton'),
    comPortSelector: document.getElementById('comPortSelector'),
    sensorModeSelector: document.getElementById('sensorModeSelector'), // Added
    totalSensorDistanceConfigInput: document.getElementById('totalSensorDistanceConfig'),
    calibrationTargetDistanceConfigInput: document.getElementById('calibrationTargetDistanceConfig'),
    timeScalingFactorDisplay: document.getElementById('timeScalingFactorDisplay'),
    timestampUnitSelector: document.getElementById('timestampUnitSelector'),
    errorDisplay: document.getElementById('error-display'),
    // Add more common elements here if needed
};

function setText(id, value, precision, unit = '') {
    var el = document.getElementById(id);
    if (el) {
        if (value === null || typeof value === 'undefined' || value === "inf" || (typeof value === 'string' && (value.toLowerCase() === 'nan' || value.toLowerCase() === 'n/a'))) {
            el.textContent = 'N/A';
            // Note: 'current-mode-display' id is removed, so specific handling for it is no longer needed here.
        } else if (typeof value === 'number' && precision !== undefined) {
            el.textContent = value.toFixed(precision) + unit;
        } else {
            el.textContent = value.toString() + unit;
        }
    }
}

function showTab(tabIdToShow) {
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
        content.classList.remove('active');
    });
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.classList.remove('active');
    });
    document.getElementById(tabIdToShow + 'Content').classList.add('active');
    document.querySelector(`.tab-button[data-tab-id="${tabIdToShow}"]`).classList.add('active');
}

function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            showTab(this.dataset.tabId);
        });
    });
}

// initializeModeTabs() function is removed as it's no longer needed.